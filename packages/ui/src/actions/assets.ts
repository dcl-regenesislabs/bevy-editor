// Model catalog and imports: the Assets panel's mutation surface. Every path
// that lands geometry in the scene ends the same way — resync, re-select, and
// hand the new entity to the move gizmo.
import { state } from '@scene/state'
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
