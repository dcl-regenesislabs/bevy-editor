// Model catalog and imports: the Assets panel's mutation surface. Every path
// that lands geometry in the scene ends the same way — resync, re-select, and
// hand the new entity to the move gizmo.
//
// Undo is recorded HERE, not in assets.ts: the creation's own component writes
// are suppressed and the finished entity becomes one `create` step, so ⌘Z takes
// the model away instead of stripping its components and leaving a husk behind.
import { state, setSelected } from '@scene/state'
import { createEntities } from '@scene/inspector'
import { NAME_COMPONENT } from '@scene/custom-components'
import { pushEntityCreate, withHistorySuppressed } from '../core/history'
import {
  loadModelCatalog,
  modelById,
  importCatalogFile,
  importModel,
  dropPosition,
  loadLocalModels,
  placeLocalModel,
  uploadModel,
  missingModelRefs,
  projectFiles,
  uniqueEntityName
} from '../assets'
import {
  entitySpec,
  resolveAsset,
  type AssetProblem,
  type AssetSettings,
  type AssetSources,
  type Placement,
  type ResolvedAsset
} from '../place-asset'
import { revealInTree } from '../panels/reveal'
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

// What the project and the catalog currently offer, as data resolveAsset can
// read. The catalog is fetched on demand: modelById never loads it by itself,
// and a caller that only names a project file shouldn't pay for the round trip.
export const uiAssetSources = async (opts?: { catalog?: boolean }): Promise<AssetSources> => {
  const files = await projectFiles().catch(() => [])
  const catalog = opts?.catalog === false ? [] : await loadModelCatalog().catch(() => [])
  return { projectFiles: files, catalog }
}

/** Resolve one name/path/URL the same way a placement will. Kept separate from
 * the placement so a caller can report the problem before it mutates anything. */
export const uiResolveAsset = async (
  query: string | undefined
): Promise<ResolvedAsset | AssetProblem> => {
  return resolveAsset(query, await uiAssetSources())
}

// Place one resolved asset as one or more authored entities — the path every
// "put this in the scene" gesture ends in, whoever asked. A catalog asset is
// downloaded ONCE however many copies land, the entities are created in a single
// call, and the whole gesture is one undo step.
//
// It deliberately does not resolve names, convert world coordinates or dedupe
// against a parent: those belong to the caller, which knows whether the numbers
// came from a creator's drag or an assistant's request.
export const uiPlaceAsset = async (
  resolved: ResolvedAsset,
  placements: Placement[],
  opts?: { name?: string; settings?: AssetSettings }
): Promise<string[]> => {
  if (placements.length === 0) return []
  state.assetBusy = true
  try {
    // the download decides the project path, so the ref is only final here
    const ready: ResolvedAsset =
      resolved.kind === 'model' && resolved.catalog !== null
        ? { ...resolved, ref: await importCatalogFile(resolved.catalog) }
        : resolved
    const base = opts?.name ?? ready.name
    const created = await withHistorySuppressed(async () => {
      // the batch is created in one call, so nothing is in the snapshot yet —
      // `handed` is what keeps 30 copies from all being called "Pine Tree"
      const handed = new Set<string>()
      const specs = placements.map((placement) => {
        const name = uniqueEntityName(base, handed)
        handed.add(name)
        return entitySpec(ready, placement, name, NAME_COMPONENT, opts?.settings)
      })
      return (await createEntities(specs)).map(String)
    })
    if (created.length === 0) return []
    pushEntityCreate(created)
    // the last one placed is the one the creator is looking at
    const last = created[created.length - 1]
    setSelected([last])
    state.activeEntity = last
    revealInTree(last)
    state.saveStatus = created.length === 1 ? `Placed ${base}` : `Placed ${created.length} × ${base}`
    return created
  } catch (e) {
    state.saveStatus = `place failed: ${String(e)}`
    return []
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
