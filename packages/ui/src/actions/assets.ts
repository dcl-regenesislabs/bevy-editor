// Model catalog and imports: the Assets panel's mutation surface. Every path
// that lands geometry in the scene ends the same way — resync, re-select, and
// hand the new entity to the move gizmo.
//
// Undo is recorded HERE, not in assets.ts: the creation's own component writes
// are suppressed and the finished entity becomes one `create` step, so ⌘Z takes
// the model away instead of stripping its components and leaving a husk behind.
import { state } from '@scene/state'
import { pushEntityCreate, withHistorySuppressed } from '../core/history'
import {
  loadModelCatalog,
  modelById,
  importModel,
  dropPosition,
  loadLocalModels,
  placeLocalModel,
  uploadModel,
  missingModelRefs
} from '../assets'
import { sendToScene } from '../engine/bus'
import { syncSelectionToScene, ensureTransformTool, focusPlaced } from './selection'

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
    const position = await dropPosition()
    const created = await withHistorySuppressed(async () => await importModel(asset, position))
    if (created !== null) pushEntityCreate([created])
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
    const position = await dropPosition()
    const created = await withHistorySuppressed(
      async () => await placeLocalModel(rel, name, position)
    )
    if (created !== null) pushEntityCreate([created])
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

// Upload local model files from disk (browser or electron) and place the model.
export const uiUploadModel = async (files: File[]): Promise<void> => {
  state.assetBusy = true
  try {
    const position = await dropPosition()
    const { name, missing, entityId } = await withHistorySuppressed(
      async () => await uploadModel(files, position)
    )
    if (entityId !== null) pushEntityCreate([entityId])
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
