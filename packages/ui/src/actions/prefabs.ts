// Prefabs: placing them into the scene, saving a selection as one, and managing
// the cross-scene library (save/delete/import/rename).
import { componentKey, setComponentExpanded, state, topLevelSelected, type Snapshot } from '@scene/state'
import { writeComponent } from '@scene/inspector'
import { NAME_COMPONENT, entityName } from '@scene/custom-components'
import { TRIGGER_AREA } from '@scene/allowed-components'
import { rootLocalForWorld } from '@scene/world-pos'
import { sendToScene } from '../engine/bus'
import { dataLayerListFiles, dataLayerReadFile } from '../engine/datalayer'
import { dropPosition, uniqueEntityName } from '../assets'
import { prefabSlug, resolvePrefabSource } from '../ai/request-format'
import { writeScriptParamValues } from '../script/params'
import { revealInTree } from '../panels/reveal'
import { SPAWNER_SLUG } from '../prefabs/builtin-refs'
import { CREATE_SPAWNABLE_GESTURE } from '../prefabs/copy'
import {
  CUSTOM_ASSET_COMPONENT,
  SCRIPT_COMPONENT,
  TRANSFORM_COMPONENT,
  isRecord
} from '../prefabs/format'
import { instancesOf, sceneInstances } from '../prefabs/placement'
import { instantiatePrefab } from '../prefabs/instantiate'
import { updatePrefabCopy } from '../prefabs/update'
import { blockedBySdk } from '../prefabs/sdk-gate'
import {
  createPrefabFromSelection,
  deletePrefabFolder,
  renamePrefabFolder
} from '../prefabs/storage'
import {
  commitPrefabImport,
  copyLibraryPrefabIntoProject,
  deleteLibraryPrefab,
  libraryAvailable,
  savePrefabToLibrary
} from '../prefabs/library'
import {
  announceCreated,
  prefabStore,
  refreshLibrary,
  refreshPrefabs,
  revealLibraryPrefab,
  revealPrefab
} from '../panels/prefab-store'
import { flushPendingSave } from '../core/autosave'
import { pushHistory, snapshotValue, withHistorySuppressed, type HistoryEntry } from '../core/history'
import { regenerateSpawnables } from '../prefabs/generate'
import { log } from '../log'
import { run } from './run'
import { uiDeleteEntityRecursive } from './entities'
import { applySpawnedOnly } from './spawned-only'
import { syncSelectionToScene, ensureTransformTool, focusPlaced } from './selection'

function withNotes(headline: string, notes: string[]): string {
  return notes.length === 0 ? headline : `${headline} — ${notes.join('; ')}`
}

// An explicit placement, for callers that already know where the prefab goes —
// today the assistant's turn-end request executor (ai/requests.ts). Position is
// WORLD metres, the frame the AI scene roster reports; anything omitted keeps
// the ordinary behaviour (camera drop point, the prefab's own size and name).
export interface PrefabPlacement {
  position?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  name?: string
}

// Size and name overrides land as ordinary component writes on the placed root,
// so they undo, autosave and mirror exactly like a gizmo drag or an inline
// rename would. A prefab root is parented to 0, so its local scale IS its world
// size — no conversion, unlike the position.
async function applyPlacement(rootId: string, placement: PrefabPlacement): Promise<void> {
  if (placement.scale !== undefined) {
    const transform = state.snapshot[rootId]?.[TRANSFORM_COMPONENT]
    const base = typeof transform === 'object' && transform !== null ? transform : {}
    await writeComponent(rootId, TRANSFORM_COMPONENT, JSON.stringify({ ...base, scale: placement.scale }))
  }
  // The prefab already named it, and that name is in the snapshot — asking for
  // the name it just got would otherwise collide with itself and land as "… 2".
  const named = (state.snapshot[rootId]?.[NAME_COMPONENT] as { value?: string } | undefined)?.value
  if (placement.name !== undefined && placement.name !== named) {
    await writeComponent(rootId, NAME_COMPONENT, JSON.stringify({ value: uniqueEntityName(placement.name) }))
  }
}

// Place a project prefab folder at the camera drop point. Same flow as importing
// a model: the new root ends up selected, focused and under the move gizmo.
// `resolve` names the folder to place, so a library prefab can copy itself into
// the project first without repeating any of this.
// Answers with the placed root's entity id (null if nothing was placed), so a
// caller can follow the placement up without re-deriving what landed.
const placePrefab = async (
  resolve: () => Promise<{ folder: string; notes: string[] }>,
  placement?: PrefabPlacement
): Promise<string | null> => {
  state.assetBusy = true
  let rootId: string | null = null
  try {
    const { folder, notes } = await resolve()
    // a server-aware prefab in a scene without the auth-server SDK bundles fine
    // and throws at runtime — offer the install instead (prefabs/sdk-gate.ts)
    if (await blockedBySdk(folder)) return null
    const asked = placement?.position
    const drop =
      asked === undefined ? await dropPosition() : (rootLocalForWorld(state.snapshot, asked) ?? asked)
    const placed = await instantiatePrefab(folder, drop)
    rootId = placed.rootId
    if (rootId !== null && placement !== undefined) await applyPlacement(rootId, placement)
    // Only for camera drops: an explicit position is the caller's (the assistant is
    // instructed to set y so the volume reaches the ground — lifting again would
    // double it).
    if (rootId !== null && asked === undefined) await liftOntoGround(rootId)
    focusPlaced()
    notes.push(...placed.warnings)
    if (placed.permissionsAdded.length > 0) {
      notes.push(`added scene permissions: ${placed.permissionsAdded.join(', ')}`)
    }
    state.saveStatus = withNotes(`Placed ${placed.data.name}`, notes)
    // A script's server half only exists once the dev server rebuilds the
    // bundle — flushing the composite save starts that cycle right away
    // instead of at the next autosave tick (Play's waitForFreshBuild covers
    // the gap if the creator gets there first).
    if (placed.hasScripts) {
      await flushPendingSave()
      state.saveStatus = withNotes(`Placed ${placed.data.name}`, [...notes, 'rebuilding in the background — ready on next Play'])
    }
  } catch (e) {
    state.saveStatus = `place failed: ${String(e)}`
  } finally {
    state.assetBusy = false
    void sendToScene({ type: 'resync' })
    syncSelectionToScene()
    ensureTransformTool()
  }
  return rootId
}

export const uiPlacePrefab = async (
  folder: string,
  placement?: PrefabPlacement
): Promise<string | null> => placePrefab(async () => ({ folder, notes: [] }), placement)

// What the create gesture answers in one submit: "When spawned" leaves what you
// built in the scene, marked so the built game skips it — the tree shows it in
// the "When spawned" folder, editable exactly like anything else, and your game
// spawns copies from the folder while it plays.
export interface CreatePrefabOptions {
  spawnedOnly?: boolean
}

// Save the selection as a prefab and turn the selected root into an instance of it
// (inspector::CustomAsset). The entities stay exactly where they are — nothing is
// deleted and re-created, so undo keeps working. With `spawnable`, the same
// gesture also flips Spawnable on and resolves where the captured copy sits, so a
// creator answers "what is this for" once instead of hunting two more surfaces.
export const uiCreatePrefabFromSelection = async (
  name: string,
  options: CreatePrefabOptions = {}
): Promise<void> => {
  const roots = topLevelSelected(state.snapshot)
  if (roots.length === 0) {
    state.saveStatus = 'select an entity to save as a prefab'
    return
  }
  state.assetBusy = true
  try {
    const created = await createPrefabFromSelection(name)
    // Marking without an instance identity would remove entities from the
    // running game that no check can ever attribute to a prefab — so the mark
    // is single-root only, exactly like the instance stamp, and the two writes
    // are ONE history entry: half-undoing this gesture describes no state a
    // creator asked for.
    const spawnedOnly = options.spawnedOnly === true && roots.length === 1
    if (roots.length === 1) {
      const batch: HistoryEntry[] = []
      await withHistorySuppressed(async () => {
        const before = snapshotValue(roots[0], CUSTOM_ASSET_COMPONENT)
        await writeComponent(roots[0], CUSTOM_ASSET_COMPONENT, JSON.stringify({ assetId: created.data.id }))
        batch.push({
          entityId: roots[0],
          name: CUSTOM_ASSET_COMPONENT,
          before,
          after: { assetId: created.data.id }
        })
        if (spawnedOnly) await applySpawnedOnly(roots[0], true, batch)
      })
      pushHistory(batch)
      state.assetBusy = true
    }
    await refreshPrefabs()
    const notes = [`in ${created.folder}`, ...created.warnings]
    if (roots.length > 1) notes.push('the selection has several roots, so none was marked as an instance')
    // every prefab goes straight to the cross-scene library — a project deleted from
    // the terminal must not take the only copy with it (web build: project-only)
    if (libraryAvailable()) {
      try {
        await savePrefabToLibrary(created.folder)
        await refreshLibrary()
        notes.push('also saved to your library')
      } catch (e) {
        notes.push(`could not add it to your library: ${String(e)}`)
      }
    }
    state.saveStatus = withNotes(`Created ${created.data.name} — find it in the Prefabs tab`, notes)
    // Both after the refresh: the card has to exist before the flash lands on it.
    announceCreated({
      folder: created.folder,
      name: created.data.name,
      placement: spawnedOnly ? 'unplaced' : 'editorAndPlay'
    })
    revealPrefab(created.folder)
  } catch (e) {
    state.saveStatus = `could not save the prefab: ${String(e)}`
  } finally {
    state.assetBusy = false
  }
}

// Place a library (or built-in) prefab: its folder is copied into the project
// first — a scene must carry its own prefabs to stay deployable — and then the
// project copy is instantiated like any other.
export const uiPlaceLibraryPrefab = async (
  ref: string,
  placement?: PrefabPlacement
): Promise<string | null> =>
  placePrefab(async () => {
    const copied = await copyLibraryPrefabIntoProject(ref)
    if (!copied.reused) {
      await refreshPrefabs()
      return { folder: copied.folder, notes: [`copied into ${copied.folder}`] }
    }
    if (!copied.outdatedReuse) return { folder: copied.folder, notes: [] }

    // Clicking BUILT-IN and getting an old copy is a lie: the project already had
    // one, so placement silently reused it however stale. Refresh it first — but
    // never over an edit, so this is the unforced update, which reports the files
    // it would overwrite instead of overwriting them.
    const notes: string[] = []
    if (copied.copyId === undefined) return { folder: copied.folder, notes }
    try {
      const result = await updatePrefabCopy(copied.copyId, { force: false })
      if (result.updated) {
        await refreshPrefabs()
        notes.push('updated your copy to the built-in version first')
      } else if (!result.verified) {
        // no origin manifest: the copy predates hash tracking, so every file
        // "differs" and claiming the creator edited them would be a guess
        notes.push('placed your older copy — update it from the Prefabs tab to take the new version')
      } else {
        const n = result.modified.length
        notes.push(
          `placed your older copy — ${n} file${n === 1 ? '' : 's'} you edited would be overwritten; update it from the Prefabs tab`
        )
      }
    } catch (e) {
      log.warn('could not refresh the reused prefab copy', e)
      notes.push('a newer version of this prefab exists — update it from the Prefabs tab')
    }
    return { folder: copied.folder, notes }
  }, placement)

// A TriggerArea's Transform IS its volume, and the box is centred on the entity —
// so dropping one on the ground buries its bottom half. Lift a placed volume root
// by half its height so the zone the creator sees is the zone they can walk into.
// A no-op for every other prefab.
const liftOntoGround = async (entityId: string): Promise<void> => {
  if (state.snapshot[entityId]?.[TRIGGER_AREA] === undefined) return
  const transform = state.snapshot[entityId]?.[TRANSFORM_COMPONENT]
  if (!isRecord(transform)) return
  const { position, scale } = transform
  if (!isRecord(position) || !isRecord(scale)) return
  if (typeof position.y !== 'number' || typeof scale.y !== 'number') return
  await writeComponent(
    entityId,
    TRANSFORM_COMPONENT,
    JSON.stringify({ ...transform, position: { ...position, y: position.y + scale.y / 2 } })
  )
}

// --- the right-click Spawner gesture ---

// The two `when` values this gesture picks between. They are the Spawner script's
// own enum members (packages/desktop/prefabs/spawner/scripts/spawner.ts) — the
// param is a dropdown of exactly these strings, so a typo here writes a value the
// script will never match and the Spawner silently never fires.
const WHEN_CLICKED = 'when clicked'
const WHEN_PLAYER_ENTERS = 'when a player enters'

const ORIGIN_TRANSFORM = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 }
}

// placePrefab already said what the placement itself had to report — the folder
// it copied in, the rebuild it started. This gesture re-headlines that line, so
// those clauses have to be carried across rather than quietly replaced.
function carriedNotes(status: string): string[] {
  const separator = status.indexOf(' — ')
  return separator === -1 ? [] : [status.slice(separator + 3)]
}

async function spawnerSource(): Promise<{ kind: 'library'; ref: string } | { kind: 'project'; folder: string } | null> {
  await refreshLibrary()
  return resolvePrefabSource(
    SPAWNER_SLUG,
    prefabStore.items.map((item) => item.folder),
    prefabStore.library.map((entry) => entry.ref)
  )
}

/**
 * Add a Spawner to whatever was right-clicked: placed as a child of it, sitting
 * exactly on it, already answering "what makes a copy appear" from what that
 * thing is — a trigger area spawns when a player walks in, anything else when a
 * player clicks it.
 *
 * Everything after the placement is ONE undo step. The gesture is a dozen writes
 * and a creator who presses ⌘Z means "I didn't want that", not "take the parent
 * off but keep the settings" — so the whole configured half comes off at once and
 * leaves a plain, freshly placed Spawner.
 *
 * Answers with the placed root's entity id, or null if nothing was placed.
 */
export const uiAddSpawnerFor = async (entityId: string): Promise<string | null> => {
  const target = state.snapshot[entityId]
  if (target === undefined) return null
  const targetName = entityName(state.snapshot, entityId)
  const isZone = target[TRIGGER_AREA] !== undefined
  // Read BEFORE the placement: the Spawner copies its own folder into the project
  // on the way in, so counting afterwards always finds at least one prefab.
  const hasSomethingToSpawn = prefabStore.items.some((item) => prefabSlug(item.folder) !== SPAWNER_SLUG)

  const source = await spawnerSource()
  if (source === null) {
    state.saveStatus = 'the Spawner prefab is not available in this build'
    return null
  }
  const rootId =
    source.kind === 'library' ? await uiPlaceLibraryPrefab(source.ref) : await uiPlacePrefab(source.folder)
  if (rootId === null) return null
  const placedNotes = carriedNotes(state.saveStatus)

  const problems: string[] = []
  const batch: HistoryEntry[] = []
  await withHistorySuppressed(async () => {
    const nameBefore = snapshotValue(rootId, NAME_COMPONENT)
    const named = { value: uniqueEntityName(`${targetName ?? 'Entity'} Spawner`) }
    await writeComponent(rootId, NAME_COMPONENT, JSON.stringify(named))
    batch.push({ entityId: rootId, name: NAME_COMPONENT, before: nameBefore, after: named })

    // NOT reparentEntitiesTo: that one PRESERVES world placement, which is the
    // opposite of what this gesture means. The Spawner belongs on the thing it
    // was added to, not at the camera drop point it happened to land on.
    const transformBefore = snapshotValue(rootId, TRANSFORM_COMPONENT)
    const transform = { ...ORIGIN_TRANSFORM, parent: Number(entityId) }
    await writeComponent(rootId, TRANSFORM_COMPONENT, JSON.stringify(transform))
    batch.push({ entityId: rootId, name: TRANSFORM_COMPONENT, before: transformBefore, after: transform })

    const scriptBefore = snapshotValue(rootId, SCRIPT_COMPONENT)
    // Placement IS the wiring: the script reads its parent to find the button or
    // the zone, so the only setting the gesture writes is the trigger itself.
    await writeScriptParamValues(rootId, { when: isZone ? WHEN_PLAYER_ENTERS : WHEN_CLICKED }, problems)
    const scriptAfter = snapshotValue(rootId, SCRIPT_COMPONENT)
    if (scriptAfter !== undefined) {
      batch.push({ entityId: rootId, name: SCRIPT_COMPONENT, before: scriptBefore, after: scriptAfter })
    }
  })
  pushHistory(batch)

  // placePrefab focused the drop point; the Spawner is not there any more.
  focusPlaced()
  revealInTree(rootId)
  // Every inspector card but Transform starts collapsed, so the one setting this
  // gesture cannot fill in — WHAT appears — would be hidden behind a header the
  // creator has no reason to suspect. The gesture ends on the dropdown it left open.
  setComponentExpanded(componentKey(rootId, SCRIPT_COMPONENT), true)

  const notes = [...placedNotes, ...problems]
  // The picker the creator is about to open renders as flat text, not a dropdown,
  // when the project holds nothing to spawn — so say what to do before they meet it.
  if (!hasSomethingToSpawn) {
    notes.push(
      `nothing to spawn yet — build the thing in the scene, then ${CREATE_SPAWNABLE_GESTURE}, and pick it in the Spawner’s settings`
    )
  }
  const where = targetName ?? 'that entity'
  state.saveStatus = withNotes(
    isZone
      ? `Added a Spawner to ${where} — it makes a copy when a player walks in`
      : `Added a Spawner to ${where} — it makes a copy when a player clicks`,
    notes
  )
  return rootId
}

// Copy a project prefab out into the cross-scene library, so the next scene can
// use it. The project keeps its own copy untouched.
export const uiSavePrefabToLibrary = async (folder: string): Promise<void> => {
  try {
    const entry = await savePrefabToLibrary(folder)
    await refreshLibrary()
    revealLibraryPrefab(entry.ref)
    state.saveStatus = `${entry.data.name} is in your library`
  } catch (e) {
    state.saveStatus = `could not add to the library: ${String(e)}`
  }
}

export const uiDeleteLibraryPrefab = async (ref: string): Promise<void> => {
  try {
    await deleteLibraryPrefab(ref)
    await refreshLibrary()
    state.saveStatus = 'Removed from your library'
  } catch (e) {
    state.saveStatus = `could not remove it: ${String(e)}`
  }
}

// Finish a staged import: main moves the downloaded folder into the library and
// we surface it. The user has already seen the scripts it carries.
export const uiCommitPrefabImport = async (token: string): Promise<void> => {
  try {
    const entry = await commitPrefabImport(token)
    await refreshLibrary()
    revealLibraryPrefab(entry.ref)
    state.saveStatus = `Imported ${entry.data.name} into your library`
  } catch (e) {
    state.saveStatus = `import failed: ${String(e)}`
  }
}

// The registry compiles out of the folders and aliases derive from data.name,
// so rename and delete both invalidate it. A rename touches only data.json —
// no composite write, no autosave — and a deleted UNPLACED folder dirties
// nothing at all, so without this the registry keeps a dangling import and the
// project stops compiling in generated code the creator never wrote.
async function regenerateAfter(verb: string): Promise<void> {
  try {
    await regenerateSpawnables()
  } catch (e) {
    log.warn(`${verb}: regenerateSpawnables failed`, e)
  }
}

export const uiRenamePrefab = async (folder: string, name: string): Promise<void> => {
  try {
    const data = await renamePrefabFolder(folder, name)
    await refreshPrefabs()
    await regenerateAfter('rename')
    state.saveStatus = `Renamed to ${data.name}`
  } catch (e) {
    state.saveStatus = `rename failed: ${String(e)}`
  }
}

// Placed copies go with the folder: an instance whose folder is gone is a
// broken thing — its Script rows point at files that no longer exist, and a
// prefab with no model (Sit Spot) leaves an INVISIBLE orphan the creator can
// only perceive as a stray editor marker. Deleting means deleting.
// A creator's script can import from the folder being deleted — the zone card
// scaffolds reactions that do exactly that. Deleting anyway breaks the scene's
// build with an error the creator has to trace back; naming the scripts here
// is the difference between a choice and an ambush.
// The scan is advisory: with no data layer to read from (early boot, tests)
// the delete itself must still go through, just without the warning.
async function scriptsImportingFrom(folder: string): Promise<string[]> {
  let files: string[]
  try {
    files = await dataLayerListFiles()
  } catch {
    return []
  }
  const marker = `custom/${folder.split('/').pop() ?? ''}/`
  const hits: string[] = []
  for (const file of files) {
    if (!file.startsWith('src/scripts/') || !file.endsWith('.ts')) continue
    try {
      const text = await dataLayerReadFile(file)
      if (text.includes(marker)) hits.push(file)
    } catch {
      continue
    }
  }
  return hits
}

export const uiDeletePrefab = async (folder: string): Promise<void> => {
  try {
    const data = prefabStore.items.find((p) => p.folder === folder)?.data
    if (data !== undefined) {
      const placed = instancesOf(data, sceneInstances(state.snapshot as Snapshot))
      for (const instance of placed) await uiDeleteEntityRecursive(instance.entityId)
    }
    const stranded = await scriptsImportingFrom(folder)
    await deletePrefabFolder(folder)
    await refreshPrefabs()
    await regenerateAfter('delete')
    state.saveStatus =
      stranded.length === 0
        ? `Deleted ${folder}`
        : `Deleted ${folder} — ${stranded.map((f) => f.split('/').pop()).join(', ')} still import${stranded.length === 1 ? 's' : ''} from it and will break the build. Delete ${stranded.length === 1 ? 'that script' : 'those scripts'} too, or point ${stranded.length === 1 ? 'it' : 'them'} at another prefab.`
  } catch (e) {
    state.saveStatus = `delete failed: ${String(e)}`
  }
}
