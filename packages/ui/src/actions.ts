// Action layer for the React UI: invokes the scene's logic modules directly
// (they talk to the engine via console commands) and mirrors viewport-relevant
// state (selection, tool, flags) to the scene over the bus so gizmos stay in
// sync. Every action bumps the store so React re-renders.
import {
  state,
  selectionClick,
  setActiveAction,
  clearSelection,
  selectEntityInTree
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
  clearParentOfSelection,
  pauseScene,
  playScene,
  stepScene,
  saveCompositeDirect,
  createEntities
} from '../../scene/src/inspector'
import { NAME_COMPONENT } from '../../scene/src/custom-components'
import { buildFromSchema, type ComponentSchema } from '../../scene/src/schema'
import { type EditorTool, type CameraMode } from '../../scene/src/bridge-protocol'
import { sendToScene } from './bus'
import { bump } from './store'
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
  bump()
}

export function uiClearSelection(): void {
  clearSelection()
  syncSelectionToScene()
  bump()
}

export function uiSetTool(tool: EditorTool): void {
  setActiveAction(tool)
  void sendToScene({ type: 'set-tool', tool: state.activeAction as EditorTool })
  bump()
}

export function uiSetCamera(mode: CameraMode, axis?: string): void {
  state.camMode = mode === 'off' ? 'none' : mode
  void sendToScene({ type: 'set-camera', mode, axis })
  bump()
}

export function uiFocusEntity(id: string): void {
  state.camMode = 'target' // focus enters orbit mode scene-side
  void sendToScene({ type: 'focus', entity: id })
  bump()
}

// wrap an async logic call: bump immediately (optimistic local state), bump again
// after. Mutations reach the scene via the component-written/entity-deleted bus
// observers (set in boot); 'refresh' additionally re-syncs running scenes.
async function run(task: Promise<unknown>, notifyScene = true): Promise<void> {
  bump()
  try {
    await task
  } finally {
    if (notifyScene && !state.frozen) void sendToScene({ type: 'refresh' })
    bump()
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
    state.editStatus.set(key, built.error)
    bump()
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
  bump()
}
export const uiAddEntity = async (name: string, parent: number): Promise<void> => {
  await run(addEntity(name, parent))
  syncSelectionToScene()
  ensureTransformTool()
}
// Duplicate an entity: clone its authored components (editor tooling state
// excluded), nudge it +1m on X, and select the copy. Children are not cloned.
setDuplicateAction((id) => uiDuplicateEntity(id))
export const uiDuplicateEntity = async (id: string): Promise<void> => {
  const comps = state.snapshot[id]
  if (comps === undefined) return
  const spec: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(comps)) {
    if (name.startsWith('inspector::')) continue
    spec[name] = JSON.parse(JSON.stringify(value))
  }
  const t = (spec.Transform ?? {}) as { position?: { x: number; y: number; z: number } }
  if (t.position !== undefined) t.position = { ...t.position, x: t.position.x + 1 }
  spec.Transform = {
    position: t.position ?? { x: 0, y: 0, z: 0 },
    rotation: (t as { rotation?: unknown }).rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    scale: (t as { scale?: unknown }).scale ?? { x: 1, y: 1, z: 1 },
    parent: (t as { parent?: number }).parent ?? 0
  }
  const baseName = (comps[NAME_COMPONENT] as { value?: string } | undefined)?.value ?? 'Entity'
  spec[NAME_COMPONENT] = { value: `${baseName} copy` }
  await run(
    createEntities([spec]).then((ids) => {
      if (ids.length > 0) {
        const eid = String(ids[0])
        state.selected = new Set([eid])
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
  bump()
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
    bump()
  }
}
export const uiImportAsset = async (assetId: string, _name: string): Promise<void> => {
  const asset = modelById(assetId)
  if (asset === undefined) return
  state.assetBusy = true
  bump()
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
    bump()
  }
}
// List the project's local model files (gltf/glb already in scene content).
export const uiLoadLocalModels = async (): Promise<string[]> => {
  return await loadLocalModels()
}
// Place a model that's already in the project content into the scene.
export const uiPlaceLocalModel = async (rel: string): Promise<void> => {
  state.assetBusy = true
  bump()
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
    bump()
  }
}
// Upload a local GLB/GLTF from disk (browser or electron) and place it.
export const uiUploadModel = async (file: File): Promise<void> => {
  state.assetBusy = true
  bump()
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
    bump()
  }
}
