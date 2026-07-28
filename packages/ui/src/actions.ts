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
  setEditStatus
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
import { setDuplicateAction, setClipboardActions } from './history'
import { PICK_LAYER } from '../../scene/src/viewport/pick-layer'

// every collision layer except the editor's own pick overlay
const ALL_LAYERS_BUT_PICK = ~PICK_LAYER >>> 0
import { flushPendingSave } from './autosave'

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
export const uiPlay = async (): Promise<void> => {
  // persist edit-mode changes before the scene starts running — once playing,
  // edits become runtime-only (not saved), so this is the last authored save
  await flushPendingSave()
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
export const uiImportAsset = async (assetId: string, _name: string): Promise<void> => {
  const asset = modelById(assetId)
  if (asset === undefined) return
  state.assetBusy = true
  try {
    await importModel(asset, await dropPosition())
    // the model drops at the parcel centre — fly the camera to it so it's
    // actually visible (otherwise it lands off-screen and feels like nothing happened)
    if (state.activeEntity !== null) { state.camMode = 'free'; void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false }) }
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
    if (state.activeEntity !== null) { state.camMode = 'free'; void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false }) }
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
// Upload local model files from disk (browser or electron) and place the model.
export const uiUploadModel = async (files: File[]): Promise<void> => {
  state.assetBusy = true
  try {
    const { name, missing } = await uploadModel(files, await dropPosition())
    if (state.activeEntity !== null) { state.camMode = 'free'; void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false }) }
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
