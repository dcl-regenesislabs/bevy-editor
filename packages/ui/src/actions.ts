// Action layer for the React UI: invokes the scene's logic modules directly
// (they talk to the engine via console commands) and mirrors viewport-relevant
// state (selection, tool, flags) to the scene over the bus so gizmos stay in
// sync. Every action bumps the store so React re-renders.
import {
  state,
  selectionClick,
  setActiveAction,
  clearSelection,
  selectEntityInTree,
  setSelected,
  setEditStatus,
  topLevelSelected
} from '../../scene/src/state'
import {
  setComponentValue,
  applyStructuredEdits,
  addComponent,
  deleteComponent,
  addEntity,
  deleteEntity,
  deleteEntityRecursive,
  deleteEntityReparent,
  reparentSelectionToActive,
  reparentEntitiesTo,
  clearParentOfSelection,
  pauseScene,
  playScene,
  stepScene,
  saveCompositeDirect,
  duplicateEntityTree,
  writeComponent,
  captureEntityTree,
  instantiateEntityTree,
  type EntityClip
} from '../../scene/src/inspector'
import { buildFromSchema, type ComponentSchema } from '../../scene/src/schema'
import { type EditorTool, type CameraMode } from '../../scene/src/bridge-protocol'
import { sendToScene } from './bus'
import { launchParam } from './launch-params'
import {
  loadModelCatalog,
  modelById,
  importModel,
  dropPosition,
  loadLocalModels,
  placeLocalModel,
  uploadModel,
  missingModelRefs
} from './assets'
import { cmd } from './cmd'
import { CUSTOM_ASSET_COMPONENT } from './prefabs/format'
import { instantiatePrefab } from './prefabs/instantiate'
import {
  createPrefabFromSelection,
  deletePrefabFolder,
  renamePrefabFolder
} from './prefabs/storage'
import {
  commitPrefabImport,
  copyLibraryPrefabIntoProject,
  deleteLibraryPrefab,
  libraryAvailable,
  savePrefabToLibrary
} from './prefabs/library'
import {
  refreshLibrary,
  refreshPrefabs,
  revealLibraryPrefab,
  revealPrefab
} from './panels/prefab-store'
import { setDuplicateAction, setClipboardActions } from './history'
import { PICK_LAYER } from '../../scene/src/viewport/pick-layer'

// every collision layer except the editor's own pick overlay
const ALL_LAYERS_BUT_PICK = ~PICK_LAYER >>> 0
import { flushPendingSave } from './autosave'
import { buildInFlight, lastBuildDoneAt, lastSceneReloadAt, noteForcedReload, wireSceneHealth } from './features/editor/scene-health'
import { refreshAuthoredIds } from './panels/authored-ids'

// A fresh entity wants its gizmo: hop from the select tool to move so the
// just-created/imported model can be placed immediately.
function ensureTransformTool(): void {
  if (state.activeAction === 'select') uiSetTool('translate')
}

function syncSelectionToScene(): void {
  void sendToScene({
    type: 'set-selection',
    selected: [...state.selected],
    active: state.activeEntity
  })
}

export function uiSelectEntity(id: string, additive: boolean, toggle: boolean): void {
  selectionClick(id, additive, toggle)
  syncSelectionToScene()
}

export function uiClearSelection(): void {
  clearSelection()
  syncSelectionToScene()
}

export function uiSetTool(tool: EditorTool): void {
  setActiveAction(tool)
  void sendToScene({ type: 'set-tool', tool: state.activeAction as EditorTool })
}

export function uiSetCamera(mode: CameraMode, axis?: string): void {
  state.camMode = mode === 'off' ? 'none' : mode
  void sendToScene({ type: 'set-camera', mode, axis })
}

export function uiFocusEntity(id: string): void {
  state.camMode = 'target' // focus enters orbit mode scene-side
  void sendToScene({ type: 'focus', entity: id })
}

// Await an async logic call, then (for a running scene) ask it to re-sync. The
// optimistic local-state writes inside `task` re-render the UI on their own (the
// reactive store auto-notifies). Mutations reach the scene via the
// component-written/entity-deleted bus observers (set in boot); 'refresh'
// additionally re-syncs running scenes.
async function run(task: Promise<unknown>, notifyScene = true): Promise<void> {
  try {
    await task
  } finally {
    if (notifyScene && !state.frozen) void sendToScene({ type: 'refresh' })
  }
}

export const uiSetComponentValue = async (
  key: string,
  entityId: string,
  name: string,
  json: string
): Promise<void> => {
  await run(setComponentValue(key, entityId, name, json))
}
export const uiApplyStructuredEdits = async (
  key: string,
  entityId: string,
  name: string,
  value: unknown
): Promise<void> => {
  await run(applyStructuredEdits(key, entityId, name, value))
}
// schema-driven apply: rebuild the full component from schema + edits, then write
export const uiApplyFromSchema = async (
  key: string,
  entityId: string,
  name: string,
  schema: ComponentSchema,
  value: unknown
): Promise<void> => {
  const built = buildFromSchema(key, schema, value)
  if (!built.ok) {
    setEditStatus(key, built.error)
    return
  }
  await run(setComponentValue(key, entityId, name, built.json))
}
export const uiAddComponent = async (entityId: string, name: string): Promise<void> => {
  await run(addComponent(entityId, name))
}
export const uiDeleteComponent = (entityId: string, name: string): void => {
  deleteComponent(entityId, name)
  void sendToScene({ type: 'refresh' })
}
export const uiAddEntity = async (name: string, parent: number): Promise<void> => {
  await run(addEntity(name, parent))
  syncSelectionToScene()
  ensureTransformTool()
}
// Duplicate an entity and its whole subtree: clone every authored component
// (editor tooling state excluded), remap internal parent refs, nudge the copy
// +1m on X, and select the new root.
setDuplicateAction((id) => uiDuplicateEntity(id))
setClipboardActions((id) => uiCopyEntity(id), () => uiPasteEntity())
export const uiDuplicateEntity = async (id: string): Promise<void> => {
  await run(
    duplicateEntityTree(id).then((eid) => {
      if (eid !== null) {
        setSelected([eid])
        state.activeEntity = eid
        selectEntityInTree(state.snapshot, eid)
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
        selectEntityInTree(state.snapshot, eid)
      }
    })
  )
  syncSelectionToScene()
  ensureTransformTool()
}

// Creator Hub's lock / hide flags. We honour them (a locked entity can't be
// picked or dragged, a hidden one isn't drawn), so the editor has to be able to
// clear them too — otherwise a project made there arrives with entities that
// can never be touched again. Both are editor state, excluded from the composite.
// Draw scene.json's spawn points in the viewport. Nothing authors them in this
// editor yet, so a scene made here has none to show — it earns its keep on
// imported projects, where walling off the spawn point is easy to do by accident.
export const uiToggleSpawnAreas = (): void => {
  state.showSpawnAreas = !state.showSpawnAreas
  void sendToScene({ type: 'set-flags', showSpawnAreas: state.showSpawnAreas })
  // scene.json without spawnPoints is the common case — the overlay then has
  // nothing to draw, which used to read as the toggle being broken
  if (state.showSpawnAreas && !hasAuthoredSpawnPoints()) {
    state.saveStatus = 'no spawn points in scene.json — the ghost figure marks the default spot. Add your own in Scene settings'
  }
}

function hasAuthoredSpawnPoints(): boolean {
  try {
    const parsed: unknown = JSON.parse(launchParam('spawnPoints') ?? '[]')
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

// Snap gizmo drags to the grid. The scene owns the drag math, so the flag has to
// travel over the bus — the page's own copy of state is a separate module
// instance. Holding Shift while dragging inverts whatever this is set to.
export const uiToggleSnap = (): void => {
  state.snap = !state.snap
  void sendToScene({ type: 'set-flags', snap: state.snap })
}

// Show/hide the engine's collider debug volumes. Masked to exclude the editor's
// own pick layer (PICK_LAYER, written engine-only onto every renderable so
// clicking works) — otherwise every model in the scene sprouts a debug box.
export const uiToggleColliders = async (): Promise<void> => {
  const on = !state.showColliders
  state.showColliders = on
  await run(cmd.debugColliders(on ? ALL_LAYERS_BUT_PICK : 0))
}

export const uiSetEntityFlag = async (
  id: string,
  flag: 'inspector::Lock' | 'inspector::Hide',
  on: boolean
): Promise<void> => {
  await run(writeComponent(id, flag, JSON.stringify({ value: on })))
}

export const uiDeleteEntity = async (id: string): Promise<void> => {
  await run(deleteEntity(id))
}
export const uiDeleteEntityRecursive = async (id: string): Promise<void> => {
  await run(deleteEntityRecursive(id))
}
export const uiDeleteEntityReparent = async (id: string): Promise<void> => {
  await run(deleteEntityReparent(id))
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
// The editor camera active when Play was pressed, restored on Pause. Play hands
// control to the player camera: the pointer ray is cast from the ACTIVE camera
// and scene interactions default to a 10m camera-distance rule, so running the
// scene from a fly/orbit camera leaves every clickable out of range (and the
// avatar input-locked) — nothing like the real preview.
let prePlayCam: CameraMode | null = null
export const uiPause = async (): Promise<void> => {
  await run(pauseScene(), false)
  if (prePlayCam !== null) {
    uiSetCamera(prePlayCam)
    prePlayCam = null
  }
}
// A composite save kicks off a dev-server rebuild, and the running scene only
// gets the new bundle (with any just-placed scripts) when the engine reloads it.
// Unfreezing before that lands plays stale code — a prefab placed seconds ago
// silently does nothing on the first Play. Wait for the cycle, bounded so a
// missing dev server or a broken build can't wedge the button.
const BUILD_START_GRACE_MS = 4_000
const BUILD_TIMEOUT_MS = 30_000
const RELOAD_TIMEOUT_MS = 8_000
const RELOAD_SETTLE_MS = 700
const POLL_MS = 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollUntil(done: () => boolean, deadline: number): Promise<void> {
  while (!done() && Date.now() < deadline) await sleep(POLL_MS)
}

// Only wait when something actually changed: a save we just flushed, a build the
// watcher is running, or a finished build the engine has not picked up. With none
// of those, the running bundle is already current and Play is instant.
function needsRebuild(justSaved: boolean): boolean {
  return justSaved || buildInFlight() || lastBuildDoneAt() > lastSceneReloadAt()
}

async function waitForFreshBuild(justSaved: boolean): Promise<void> {
  wireSceneHealth()
  const stale = (): boolean => lastBuildDoneAt() > lastSceneReloadAt()
  if (!needsRebuild(justSaved)) return
  const t0 = Date.now()
  state.saveStatus = 'rebuilding the scene before play…'
  if (justSaved) await pollUntil(buildInFlight, t0 + BUILD_START_GRACE_MS)
  await pollUntil(() => !buildInFlight(), t0 + BUILD_TIMEOUT_MS)
  // the reload can precede the type-check summary — count any pickup since t0
  await pollUntil(() => lastSceneReloadAt() >= t0, Date.now() + RELOAD_TIMEOUT_MS)
  if (stale()) {
    // The dev server's hot-reload push can miss rebuilds during a burst (a
    // prefab placement copies several files → several rebuilds, one push) —
    // the engine then plays a stale bundle where the new scripts don't exist.
    // Force the engine to reload the scene with whatever the last build wrote.
    await cmd.reload().then(noteForcedReload).catch(() => {})
    await sleep(RELOAD_SETTLE_MS * 3)
  }
  // give the fresh instance a beat to spawn; playScene re-pins if the old one died
  if (lastSceneReloadAt() >= t0) await sleep(RELOAD_SETTLE_MS)
  state.saveStatus = ''
}

export const uiPlay = async (): Promise<void> => {
  // persist edit-mode changes before the scene starts running — once playing,
  // edits become runtime-only (not saved), so this is the last authored save
  const flushed = await flushPendingSave()
  await waitForFreshBuild(flushed.pending && flushed.ok)
  if (state.camMode !== 'none') {
    prePlayCam = state.camMode === 'free' ? 'free' : 'target'
    uiSetCamera('off')
  } else {
    prePlayCam = null
  }
  await run(playScene(), false)
}
export const uiStep = async (count = 1): Promise<void> => {
  await run(stepScene(count), false)
}
export const uiSave = async (): Promise<void> => {
  // failures land in state.saveStatus (shown as a toast)
  await run(saveCompositeDirect().catch(() => {}), false)
  // the composite just gained whatever was created this session — re-read the
  // authored set so those rows move out of "Made by your code"
  refreshAuthoredIds()
}
export const uiFetchCatalog = async (): Promise<void> => {
  state.assetBusy = true
  try {
    const models = await loadModelCatalog()
    state.assetCatalog = models.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      tags: m.tags,
      pack: m.collection,
      thumbnail: m.thumbnailUrl ?? null
    }))
  } finally {
    state.assetBusy = false
  }
}
// Whatever was just dropped lands at the parcel centre — fly the camera to it so
// it's actually visible (otherwise it lands off-screen and feels like nothing happened).
function focusPlaced(): void {
  if (state.activeEntity === null) return
  state.camMode = 'free'
  void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false })
}
export const uiImportAsset = async (assetId: string, _name: string): Promise<void> => {
  const asset = modelById(assetId)
  if (asset === undefined) return
  state.assetBusy = true
  try {
    await importModel(asset, await dropPosition())
    focusPlaced()
    state.saveStatus = `Imported ${asset.name}`
  } catch (e) {
    state.saveStatus = `import failed: ${String(e)}`
  } finally {
    state.assetBusy = false
    // resync, not refresh: registering new content can re-instance the scene,
    // which drops the editor's engine-only pick colliders — resync clears the
    // applied-markers so they get re-written (else click-select/gizmo go dead)
    void sendToScene({ type: 'resync' })
    syncSelectionToScene()
    ensureTransformTool()
  }
}
// List the project's local model files (gltf/glb already in scene content).
export const uiLoadLocalModels = async (): Promise<string[]> => {
  return await loadLocalModels()
}
// Place a model that's already in the project content into the scene.
export const uiPlaceLocalModel = async (rel: string): Promise<void> => {
  state.assetBusy = true
  try {
    const name = rel.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? rel
    await placeLocalModel(rel, name, await dropPosition())
    focusPlaced()
    state.saveStatus = `Placed ${name}`
  } catch (e) {
    state.saveStatus = `place failed: ${String(e)}`
  } finally {
    state.assetBusy = false
    void sendToScene({ type: 'resync' })
    syncSelectionToScene()
    ensureTransformTool()
  }
}
// Referenced files the picked set doesn't satisfy — checked before importing so
// the panel can warn first. Fail-open: the post-upload status warning backstops.
export const uiCheckModelRefs = async (files: File[]): Promise<string[]> => {
  try {
    return await missingModelRefs(files)
  } catch {
    return []
  }
}

// --- prefabs ---

function withNotes(headline: string, notes: string[]): string {
  return notes.length === 0 ? headline : `${headline} — ${notes.join('; ')}`
}

// Place a project prefab folder at the camera drop point. Same flow as importing
// a model: the new root ends up selected, focused and under the move gizmo.
// `resolve` names the folder to place, so a library prefab can copy itself into
// the project first without repeating any of this.
const placePrefab = async (resolve: () => Promise<{ folder: string; notes: string[] }>): Promise<void> => {
  state.assetBusy = true
  try {
    const { folder, notes } = await resolve()
    const placed = await instantiatePrefab(folder, await dropPosition())
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
}

export const uiPlacePrefab = async (folder: string): Promise<void> =>
  placePrefab(async () => ({ folder, notes: [] }))

// Save the selection as a prefab and turn the selected root into an instance of it
// (inspector::CustomAsset). The entities stay exactly where they are — nothing is
// deleted and re-created, so undo keeps working.
export const uiCreatePrefabFromSelection = async (name: string): Promise<void> => {
  const roots = topLevelSelected(state.snapshot)
  if (roots.length === 0) {
    state.saveStatus = 'select an entity to save as a prefab'
    return
  }
  state.assetBusy = true
  try {
    const created = await createPrefabFromSelection(name)
    if (roots.length === 1) {
      await run(
        writeComponent(roots[0], CUSTOM_ASSET_COMPONENT, JSON.stringify({ assetId: created.data.id }))
      )
    }
    await refreshPrefabs()
    revealPrefab(created.folder)
    const notes = [...created.warnings]
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
    state.saveStatus = withNotes(
      `Saved ${created.data.name} — ${created.entityCount} entit${created.entityCount === 1 ? 'y' : 'ies'} in ${created.folder}`,
      notes
    )
  } catch (e) {
    state.saveStatus = `could not save the prefab: ${String(e)}`
  } finally {
    state.assetBusy = false
  }
}

// Place a library (or built-in) prefab: its folder is copied into the project
// first — a scene must carry its own prefabs to stay deployable — and then the
// project copy is instantiated like any other.
export const uiPlaceLibraryPrefab = async (ref: string): Promise<void> =>
  placePrefab(async () => {
    const copied = await copyLibraryPrefabIntoProject(ref)
    if (copied.reused) {
      const notes = copied.outdatedReuse
        ? ['a newer version of this prefab exists — update it from the Prefabs tab']
        : []
      return { folder: copied.folder, notes }
    }
    await refreshPrefabs()
    return { folder: copied.folder, notes: [`copied into ${copied.folder}`] }
  })

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

export const uiRenamePrefab = async (folder: string, name: string): Promise<void> => {
  try {
    const data = await renamePrefabFolder(folder, name)
    await refreshPrefabs()
    state.saveStatus = `Renamed to ${data.name}`
  } catch (e) {
    state.saveStatus = `rename failed: ${String(e)}`
  }
}

export const uiDeletePrefab = async (folder: string): Promise<void> => {
  try {
    await deletePrefabFolder(folder)
    await refreshPrefabs()
    state.saveStatus = `Deleted ${folder}`
  } catch (e) {
    state.saveStatus = `delete failed: ${String(e)}`
  }
}

// Upload local model files from disk (browser or electron) and place the model.
export const uiUploadModel = async (files: File[]): Promise<void> => {
  state.assetBusy = true
  try {
    const { name, missing } = await uploadModel(files, await dropPosition())
    focusPlaced()
    state.saveStatus =
      missing.length > 0
        ? `Added ${name} — it references files not in the project: ${missing.join(', ')}. Select them together with the model to include them.`
        : `Added ${name}`
  } catch (e) {
    state.saveStatus = `upload failed: ${String(e)}`
  } finally {
    state.assetBusy = false
    void sendToScene({ type: 'resync' })
    syncSelectionToScene()
    ensureTransformTool()
  }
}
