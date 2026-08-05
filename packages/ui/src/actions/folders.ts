// Folders: organizing the tree without inventing a second hierarchy.
//
// A folder is a real entity — a Name, an identity Transform, and the presence
// marker `inspector::Folder`. Membership is ordinary Transform.parent, which is
// the one reference every existing mechanism already understands: drag-reparent
// keeps world placement, undo restores it, save round-trips it, duplicate
// copies it, reveal walks it. The alternative (editor-only folder metadata,
// Unreal-style) would need its own persistence, its own drag targets and its
// own reveal support, and would go stale across delete/undo because entity ids
// come back fresh — Transform.parent is the only membership the machinery
// remaps. At run time the folder is an empty named entity: nothing renders it,
// nothing collides with it, and the viewport can never click it.
//
// The primary gesture is group-from-selection (⌘G), the universal one across
// editors; an empty "New folder" is the secondary path. Both end in a
// preselected rename, because a folder's name is the whole reason it exists.
// Ungroup (⇧⌘G) is delete-keep-children, which already preserves world
// placement and undoes as one step.
import { state, setSelected, topLevelSelected, provenanceBaseline, type Snapshot } from '@scene/state'
import { createEntities, reparentEntitiesTo } from '@scene/inspector'
import { NAME_COMPONENT } from '@scene/custom-components'
import { revealAndRename } from '../panels/reveal'
import { hierarchyModel } from '../panels/hierarchy-model'
import { authoredFromComposite } from '../panels/authored-ids'
import { FOLDER_COMPONENT, INERT_COMPONENT } from '../prefabs/format'
import { pushHistory, snapshotValue, withHistorySuppressed, type HistoryEntry } from '../core/history'
import { run } from './run'
import { syncSelectionToScene } from './selection'
import { applySpawnedOnly } from './spawned-only'
import { uiDeleteEntityReparent } from './entities'

export { FOLDER_COMPONENT }

export function isFolderEntity(snapshot: Snapshot, id: string): boolean {
  return snapshot[id]?.[FOLDER_COMPONENT] !== undefined
}

function localParent(snapshot: Snapshot, id: string): string {
  const t = snapshot[id]?.Transform as { parent?: number } | undefined
  return String(t?.parent ?? 0)
}

// Where a group's folder goes: the parent every member already shares, or the
// scene root when they disagree. A code-made parent is never a target — the
// folder would be orphaned when the next run rebuilds it. Engine ids below 512
// (player, camera) are exempt from that rule: they are persistent attachment
// points the composite saves fine, and isCode only flags them because engine
// entities are never in the authored set — falling back to root would silently
// detach an avatar-attached group.
export function groupParent(snapshot: Snapshot, ids: string[], isCode: (id: string) => boolean): string {
  const parents = new Set(ids.map((id) => localParent(snapshot, id)))
  if (parents.size !== 1) return '0'
  const parent = [...parents][0]
  if (parent !== '0' && Number(parent) >= 512 && (isCode(parent) || !(parent in snapshot))) return '0'
  return parent
}

// The folder's Transform is always identity: a folder ORGANIZES, it does not
// place. Grouping siblings therefore never rewrites the members' locals — an
// identity frame under their own parent changes nothing, so ⌘G is purely a
// parent-pointer edit and the inspector shows the folder at 0,0,0 rather than
// a position the gesture invented. Moving the folder still moves the group;
// its gizmo just anchors at the parent's origin.
async function createFolderEntity(parent: string, spawnedOnly: boolean): Promise<string | null> {
  const spec: Record<string, unknown> = {
    Transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      parent: Number(parent)
    },
    [NAME_COMPONENT]: { value: 'Folder' },
    [FOLDER_COMPONENT]: {}
  }
  if (spawnedOnly) spec[INERT_COMPONENT] = {}
  const ids = await createEntities([spec])
  return ids.length > 0 ? String(ids[0]) : null
}

// Everything a fresh folder owns, as one undo batch: `before: undefined` means
// ⌘Z removes the components, and an entity carrying nothing disappears from the
// tree and is never saved — the same "creation is its component writes"
// semantics every other create gesture has.
function folderCreateEntries(folder: string): HistoryEntry[] {
  return ['Transform', NAME_COMPONENT, FOLDER_COMPONENT, INERT_COMPONENT]
    .filter((name) => snapshotValue(folder, name) !== undefined)
    .map((name) => ({ entityId: folder, name, before: undefined, after: snapshotValue(folder, name) }))
}

function takeSelection(folder: string): void {
  setSelected([folder])
  state.activeEntity = folder
  syncSelectionToScene()
  revealAndRename(folder)
}

// An empty folder under `parent` (0 = scene root), named in the same motion.
// Unlike other root creations it does NOT land at the camera drop point: a
// folder is found in the tree, not the viewport (it has nothing to click), and
// the reveal-and-rename takes the eye there anyway.
export const uiNewFolder = async (parent: number): Promise<void> => {
  let folder: string | null = null
  await withHistorySuppressed(() =>
    run(
      (async () => {
        folder = await createFolderEntity(String(parent), false)
      })()
    )
  )
  if (folder === null) return
  pushHistory(folderCreateEntries(folder))
  takeSelection(folder)
}

// Group the selection into a new identity folder, reparent the members under
// it keeping world placement (for siblings this leaves their locals untouched),
// and open the rename. ONE undo step — member Transforms and the folder's
// components in one batch, so ⌘Z puts everything back where it was and takes
// the folder with it.
export const uiGroupIntoFolder = async (): Promise<void> => {
  const snapshot = state.snapshot
  const model = hierarchyModel(snapshot, provenanceBaseline(), true, authoredFromComposite())
  const ids = topLevelSelected(snapshot).filter((id) => !model.isCode(id) && !model.isEngine(id))
  if (ids.length === 0) return
  const parent = groupParent(snapshot, ids, model.isCode)
  const spawnedOnly = ids.every((id) => snapshot[id]?.[INERT_COMPONENT] !== undefined)
  const before = new Map(ids.map((id) => [id, snapshotValue(id, 'Transform')]))
  let folder: string | null = null
  const reconciled: HistoryEntry[] = []
  await withHistorySuppressed(() =>
    run(
      (async () => {
        folder = await createFolderEntity(parent, spawnedOnly)
        if (folder === null) return
        await reparentEntitiesTo(ids, folder)
        // A mixed selection lands in a PLACED folder and the tree shows every
        // member under "From the start" — so make that true: clear the spawned
        // members' own markers instead of leaving the save-time projection
        // disagreeing with what the tree shows. All-spawned selections keep
        // their markers and the folder inherits one, so the group stays whole.
        if (!spawnedOnly) {
          for (const id of ids) await applySpawnedOnly(id, false, reconciled)
        }
      })()
    )
  )
  if (folder === null) return
  const moved: HistoryEntry[] = ids
    .map((id) => ({ entityId: id, name: 'Transform', before: before.get(id), after: snapshotValue(id, 'Transform') }))
    .filter((e) => JSON.stringify(e.before) !== JSON.stringify(e.after))
  pushHistory([...folderCreateEntries(folder), ...moved, ...reconciled])
  takeSelection(folder)
}

// The symmetric exit: contents move up a level keeping world placement, the
// folder goes. Delete-keep-children already does exactly that, as one undo step.
export const uiUngroupFolder = async (id: string): Promise<void> => {
  await uiDeleteEntityReparent(id)
}

export const uiUngroupSelection = async (): Promise<void> => {
  const ids = topLevelSelected(state.snapshot).filter((id) => isFolderEntity(state.snapshot, id))
  for (const id of ids) await uiUngroupFolder(id)
}
