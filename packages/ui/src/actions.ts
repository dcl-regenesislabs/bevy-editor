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
  duplicateEntityTree
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
  uploadModel
} from './assets'
import { setDuplicateAction } from './history'
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
export const uiPause = async (): Promise<void> => {
  await run(pauseScene(), false)
}
export const uiPlay = async (): Promise<void> => {
  // persist edit-mode changes before the scene starts running — once playing,
  // edits become runtime-only (not saved), so this is the last authored save
  await flushPendingSave()
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
    void sendToScene({ type: 'refresh' })
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
    void sendToScene({ type: 'refresh' })
    syncSelectionToScene()
    ensureTransformTool()
  }
}
// Upload a local GLB/GLTF from disk (browser or electron) and place it.
export const uiUploadModel = async (file: File): Promise<void> => {
  state.assetBusy = true
  try {
    await uploadModel(file, await dropPosition())
    if (state.activeEntity !== null) { state.camMode = 'free'; void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false }) }
    state.saveStatus = `Added ${file.name}`
  } catch (e) {
    state.saveStatus = `upload failed: ${String(e)}`
  } finally {
    state.assetBusy = false
    void sendToScene({ type: 'refresh' })
    syncSelectionToScene()
    ensureTransformTool()
  }
}
