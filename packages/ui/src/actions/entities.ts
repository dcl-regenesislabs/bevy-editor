// Entity lifecycle: create, duplicate, clipboard, delete and reparent.
import { state, setSelected } from '@scene/state'
import {
  addEntity,
  deleteEntity,
  deleteEntityRecursive,
  deleteEntityReparent,
  reparentSelectionToActive,
  reparentEntitiesTo,
  clearParentOfSelection,
  duplicateEntityTree,
  captureEntityTree,
  captureEntityDelete,
  instantiateEntityTree,
  type DeleteMode,
  type EntityClip
} from '@scene/inspector'
import { dropPosition } from '../assets'
import { revealInTree } from '../panels/reveal'
import {
  setDuplicateAction,
  setClipboardActions,
  pushEntityDelete,
  withHistorySuppressed
} from '../core/history'
import { run } from './run'
import { syncSelectionToScene, ensureTransformTool } from './selection'

// A scene-root entity lands at the camera drop point, like an imported model or a
// prefab does — at the origin it was easy to create one and never find it. A CHILD
// keeps the parent's origin: its Transform is local, so 0,0,0 puts it on its
// parent, which is where the hierarchy's "New child entity" should place it.
export const uiAddEntity = async (name: string, parent: number): Promise<void> => {
  const position = parent === 0 ? await dropPosition() : undefined
  await run(addEntity(name, parent, position))
  syncSelectionToScene()
  ensureTransformTool()
}

// history.ts can't import these (it is imported here, so the edge would cycle).
// Loading this module wires them; boot.ts imports it, so that always happens.
setDuplicateAction((id) => uiDuplicateEntity(id))
setClipboardActions((id) => uiCopyEntity(id), () => uiPasteEntity())

// Duplicate an entity and its whole subtree: clone every authored component
// (editor tooling state excluded), remap internal parent refs, nudge the copy
// +1m on X, and select the new root.
export const uiDuplicateEntity = async (id: string): Promise<void> => {
  await run(
    duplicateEntityTree(id).then((eid) => {
      if (eid !== null) {
        setSelected([eid])
        state.activeEntity = eid
        revealInTree(eid)
      }
    })
  )
  syncSelectionToScene()
  ensureTransformTool()
}

// One entity subtree on the editor's own clipboard. Deep-cloned at copy time, so
// pasting still works after the source is edited or deleted. Deliberately not the
// OS clipboard: the payload is engine ids + component values, meaningless outside
// this scene, and hijacking ⌘C would break copying text out of the panels.
let clipboard: EntityClip | null = null

export const uiCopyEntity = (id: string): void => {
  clipboard = captureEntityTree(id)
  state.saveStatus = clipboard === null ? 'nothing to copy' : 'copied'
}

export const uiPasteEntity = async (): Promise<void> => {
  if (clipboard === null) return
  await run(
    instantiateEntityTree(clipboard).then((eid) => {
      if (eid !== null) {
        setSelected([eid])
        state.activeEntity = eid
        revealInTree(eid)
      }
    })
  )
  syncSelectionToScene()
  ensureTransformTool()
}

// Deleting an entity is ONE undo step. The subtree is captured first (the delete
// is about to take the state it's read from), and the delete itself runs with
// history off — "delete, keep children" rewrites every child's Transform, and
// those writes would otherwise pile up as undo steps of their own in front of the
// restore, so one ⌘Z would put the entity back and leave its children flattened.
async function runDelete(id: string, mode: DeleteMode, task: () => Promise<void>): Promise<void> {
  const restore = captureEntityDelete(id, mode)
  await withHistorySuppressed(() => run(task()))
  if (restore !== null) pushEntityDelete(restore)
}

export const uiDeleteEntity = async (id: string): Promise<void> => {
  await runDelete(id, 'entity', () => deleteEntity(id))
}

export const uiDeleteEntityRecursive = async (id: string): Promise<void> => {
  await runDelete(id, 'subtree', () => deleteEntityRecursive(id))
}

export const uiDeleteEntityReparent = async (id: string): Promise<void> => {
  await runDelete(id, 'keep-children', () => deleteEntityReparent(id))
}

// The Delete key: recursive, top-level roots only. Serialized — each delete does
// its own optimistic write + snapshot reload, and firing them concurrently lets a
// late reload resurrect an already-deleted entity. Deleting a parent takes its
// subtree with it (leaving children behind orphans them flat into the scene
// root), and a child whose selected ancestor just went must not be deleted twice.
export const uiDeleteSelected = async (ids: string[]): Promise<void> => {
  for (const id of ids) await uiDeleteEntityRecursive(id)
}

export const uiReparentToActive = async (): Promise<void> => {
  await run(reparentSelectionToActive())
}

// Drag-and-drop reparent in the hierarchy: move `ids` under `newParent`
// ('0' = scene root / unparent), keeping world placement. Selects what moved.
export const uiReparentEntities = async (ids: string[], newParent: string): Promise<void> => {
  await run(
    reparentEntitiesTo(ids, newParent).then((moved) => {
      if (moved.length > 0) {
        setSelected(moved)
        state.activeEntity = moved[moved.length - 1]
      }
    })
  )
  syncSelectionToScene()
}

export const uiClearParent = async (): Promise<void> => {
  await run(clearParentOfSelection())
}
