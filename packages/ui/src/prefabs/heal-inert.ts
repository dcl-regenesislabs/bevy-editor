// Repairing spawn-projection artifacts that older sessions saved as authored.
//
// Before the echo guards existed, the projection's rewrites — visible:false,
// GltfContainer src '' with zeroed masks — could round-trip into main.composite
// as if the creator authored them, and a Save-over-prefab pressed during that
// window baked the same damage into the FOLDER. The result is an entity that
// stays invisible in the editor with no way back, and a prefab that can no
// longer supply the repair. The model file itself always survives in the
// folder, and '' is not authorable from the UI, so the artifact shapes are
// provably ours. Healing runs folder-first (so the folder is a trustworthy
// source again), then instances, once per pass, logging what changed. Root
// entity only — deeper poisoning still shows in the drift dialog, where
// Update from prefab rebuilds the whole subtree from the clean folder.
import { writeComponent, deleteComponent } from '@scene/inspector'
import { state } from '@scene/state'
import { log } from '../log'
import { prefabAssetId } from './provenance'
import { ASSET_PATH_TOKEN, INERT_COMPONENT, isRecord, substituteAssetPath, type PrefabComposite } from './format'
import { writeJsonFile } from './storage'

const GLTF = 'GltfContainer'
const VISIBILITY = 'VisibilityComponent'
// Components the projection drops from the built scene. When one exists in the
// folder but is missing on a spawn-only instance, the damaged era ate it — the
// creator has no gesture that removes a component and keeps the prefab's.
const DROPPED = ['MeshCollider', 'TriggerArea', 'PointerEvents'] as const

interface HealablePrefab {
  folder: string
  data: { id: string }
  composite: PrefabComposite
}

// The folder's own values carry {assetPath} markers; a scene entity must get
// the resolved path or the "heal" writes a token the engine cannot load.
function folderRootComponent(composite: PrefabComposite, name: string, folder: string): unknown {
  const component = composite.components.find((c) => c.name === `core::${name}`)
  const entry = component?.data['0']
  if (entry === undefined) return undefined
  const value = JSON.parse(JSON.stringify(entry.json)) as unknown
  substituteAssetPath(value, folder)
  return value
}

// '' is the projection's blank; a literal {assetPath} token is a folder value
// that leaked into the scene — both are unauthorable from the UI, both broken.
function brokenSrc(src: unknown): boolean {
  return src === '' || (typeof src === 'string' && src.includes(ASSET_PATH_TOKEN))
}

/**
 * A folder whose root model source is blank was saved over from a damaged copy.
 * The model file is still in the folder; point the composite back at it. Only
 * an unambiguous folder heals — two models and there is no honest guess.
 *
 * `{assetPath}/…` is NOT damage here: it is the folder's own storage form
 * (brokenSrc means poison only on a scene entity), so only a blank src marks a
 * broken folder — treating the token as broken re-wrote every healthy folder
 * on every open.
 */
async function healFolder(prefab: HealablePrefab, files: readonly string[]): Promise<boolean> {
  const component = prefab.composite.components.find((c) => c.name === `core::${GLTF}`)
  const entry = component?.data['0']
  if (entry === undefined || !isRecord(entry.json) || entry.json.src !== '') return false
  const models = files.filter(
    (f) => f.startsWith(`${prefab.folder}/`) && /\.(glb|gltf)$/i.test(f) && !f.slice(prefab.folder.length + 1).includes('/')
  )
  if (models.length !== 1) {
    if (models.length > 1) log.warn('folder heal skipped — more than one model', prefab.folder)
    return false
  }
  const repaired: Record<string, unknown> = {
    ...entry.json,
    src: `${ASSET_PATH_TOKEN}/${models[0].slice(prefab.folder.length + 1)}`
  }
  // zeroed masks are the projection's no-collision stamp, not a choice — drop
  // them so the engine's defaults apply rather than shipping a walk-through bed
  if (repaired.visibleMeshesCollisionMask === 0) delete repaired.visibleMeshesCollisionMask
  if (repaired.invisibleMeshesCollisionMask === 0) delete repaired.invisibleMeshesCollisionMask
  entry.json = repaired
  await writeJsonFile(`${prefab.folder}/composite.json`, {
    version: prefab.composite.version,
    components: prefab.composite.components
  })
  return true
}

export async function healInertArtifacts(
  prefabs: ReadonlyArray<HealablePrefab>,
  files: readonly string[] = []
): Promise<string[]> {
  const byId = new Map(prefabs.map((p) => [p.data.id, p]))
  const healed: string[] = []
  for (const prefab of prefabs) {
    try {
      if (await healFolder(prefab, files)) healed.push(`folder:${prefab.folder}`)
    } catch (e) {
      log.warn('folder heal failed', prefab.folder, e)
    }
  }
  for (const [entityId, components] of Object.entries(state.snapshot)) {
    const inert = components[INERT_COMPONENT] !== undefined
    const assetId = prefabAssetId(components)
    if (assetId === null) continue
    const prefab = byId.get(assetId)
    if (prefab === undefined) continue

    const gltf = components[GLTF]
    // a blank src is the projection's own artifact, so it only means damage on a
    // spawn-only entity — but a folder token is poison wherever it sits
    const damaged =
      isRecord(gltf) && (inert ? brokenSrc(gltf.src) : typeof gltf.src === 'string' && gltf.src.includes(ASSET_PATH_TOKEN))
    if (damaged) {
      const authored = folderRootComponent(prefab.composite, GLTF, prefab.folder)
      if (isRecord(authored) && typeof authored.src === 'string' && !brokenSrc(authored.src)) {
        await writeComponent(entityId, GLTF, JSON.stringify(authored))
        healed.push(`${entityId}:${GLTF}`)
      }
    }

    const visibility = components[VISIBILITY]
    if (
      inert &&
      isRecord(visibility) &&
      visibility.visible === false &&
      Object.keys(visibility).length === 1 &&
      folderRootComponent(prefab.composite, VISIBILITY, prefab.folder) === undefined
    ) {
      deleteComponent(entityId, VISIBILITY)
      healed.push(`${entityId}:${VISIBILITY}`)
    }

    if (inert) {
      for (const name of DROPPED) {
        if (components[name] !== undefined) continue
        const authored = folderRootComponent(prefab.composite, name, prefab.folder)
        if (authored === undefined) continue
        await writeComponent(entityId, name, JSON.stringify(authored))
        healed.push(`${entityId}:${name}`)
      }
    }
  }
  if (healed.length > 0) log.warn('healed spawn-projection artifacts', healed)
  return healed
}
