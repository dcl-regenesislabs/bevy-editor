// OpenDCL model catalog (https://models.dclregenesislabs.xyz) — 5.7k+ plain
// GLB models, one file per asset, no smart-item wiring. Import flow:
//   1. fetch the GLB from the catalog CDN
//   2. write it into the scene project (models/…) through the dev server's
//      data-layer (so it persists and the dev server can serve it)
//   3. /register_content tells the engine to map the new file into the live
//      scene's content map (renders without a reload)
//   4. create the entity (Transform + GltfContainer + Name) — the composite
//      auto-saves like any other edit
import { cmd } from './cmd'
import { createEntities } from '../../scene/src/inspector'
import { state, selectEntityInTree } from '../../scene/src/state'
import { NAME_COMPONENT } from '../../scene/src/custom-components'
import { dataLayerSaveFileBytes, dataLayerAvailable, dataLayerRealm } from './datalayer'

const OPENDCL_ORIGIN = 'https://models.dclregenesislabs.xyz'
const CATALOG_URL = `${OPENDCL_ORIGIN}/catalog/asset-catalog.json`

// The catalog CDN lacks CORS/CORP headers, which strict crossOriginIsolated
// pages (the electron host) refuse. The host's local server proxies it at
// /opendcl/*; when that's present every catalog URL is rewritten through it,
// otherwise we fetch directly (works in lenient browsers).
let proxyBase: string | null | undefined
async function resolveProxy(): Promise<string | null> {
  if (proxyBase !== undefined) return proxyBase
  try {
    const r = await fetch('/opendcl/ping')
    proxyBase = r.ok ? '/opendcl' : null
  } catch {
    proxyBase = null
  }
  return proxyBase
}

export function opendclUrl(u: string | undefined): string | undefined {
  if (u === undefined) return undefined
  if (proxyBase === '/opendcl' && u.startsWith(OPENDCL_ORIGIN)) {
    return u.replace(OPENDCL_ORIGIN, proxyBase)
  }
  return u
}

export type ModelAsset = {
  id: string
  name: string
  filename: string
  url: string
  collection: string
  category: string
  tags: string[]
  description?: string
  thumbnailUrl?: string
}

let assets: ModelAsset[] | null = null
let dupFilenames: Set<string> = new Set()
let loadPromise: Promise<ModelAsset[]> | null = null

export async function loadModelCatalog(): Promise<ModelAsset[]> {
  if (assets !== null) return assets
  if (loadPromise === null) {
    loadPromise = (async () => {
      await resolveProxy()
      const res = await fetch(opendclUrl(CATALOG_URL) as string)
      if (!res.ok) throw new Error(`model catalog fetch failed: ${res.status}`)
      const json = (await res.json()) as { assets?: ModelAsset[] }
      const list = json.assets ?? []
      const seen = new Set<string>()
      dupFilenames = new Set()
      for (const a of list) {
        if (seen.has(a.filename)) dupFilenames.add(a.filename)
        seen.add(a.filename)
      }
      assets = list
      return list
    })().catch((e) => {
      loadPromise = null
      throw e
    })
  }
  return loadPromise
}

export function modelById(id: string): ModelAsset | undefined {
  return assets?.find((a) => a.id === id)
}

// Entity names must be unique — getEntitiesWithName / the inspector key on them.
// If `base` is taken, append " 2", " 3", … until free.
function uniqueEntityName(base: string): string {
  const taken = new Set<string>()
  for (const id of Object.keys(state.snapshot)) {
    const n = (state.snapshot[id]?.[NAME_COMPONENT] as { value?: string } | undefined)?.value
    if (typeof n === 'string') taken.add(n)
  }
  if (!taken.has(base)) return base
  for (let i = 2; i < 10000; i++) {
    const cand = `${base} ${i}`
    if (!taken.has(cand)) return cand
  }
  return `${base} ${Date.now()}`
}

// models/<filename>, disambiguated with a short content-id suffix when the
// catalog has several assets sharing a filename
export function modelRelPath(a: ModelAsset): string {
  if (!dupFilenames.has(a.filename)) return `models/${a.filename}`
  const dot = a.filename.lastIndexOf('.')
  const base = dot > 0 ? a.filename.slice(0, dot) : a.filename
  const ext = dot > 0 ? a.filename.slice(dot) : ''
  return `models/${base}-${a.id.slice(-8)}${ext}`
}

// Import a catalog model: persist the GLB, register it with the live scene,
// and create the entity at `position`.
export async function importModel(
  asset: ModelAsset,
  position: { x: number; y: number; z: number }
): Promise<void> {
  if (dataLayerAvailable() !== true) {
    throw new Error('model import needs the scene server running with --data-layer')
  }
  const rel = modelRelPath(asset)
  const res = await fetch(opendclUrl(asset.url) as string)
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  await dataLayerSaveFileBytes(rel, bytes)
  const reply = await cmd.registerContent(rel)
  // confirm the dev server serves the file before the renderer's first (and
  // only) load attempt — a premature 404 sticks until a reload
  if (reply.hash !== undefined) {
    const realm = dataLayerRealm() ?? ''
    const url = `${realm}/content/contents/${reply.hash}`
    for (let i = 0; i < 40; i++) {
      try {
        const head = await fetch(url, { method: 'HEAD' })
        if (head.ok) break
      } catch {
        /* dev server briefly busy — retry */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  const ids = await createEntities([
    {
      Transform: {
        position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        parent: 0
      },
      // visible meshes double as colliders (physics + pointer) — catalog
      // models ship without separate collider meshes
      GltfContainer: { src: rel, visibleMeshesCollisionMask: 3 },
      [NAME_COMPONENT]: { value: uniqueEntityName(asset.name) }
    }
  ])
  if (ids.length > 0) {
    const eid = String(ids[0])
    state.selected = new Set([eid])
    state.activeEntity = eid
    selectEntityInTree(state.snapshot, eid)
  }
}

// --- local models (project content) ---
// The scene's own content files (gltf/glb already in the project), via the
// engine's /scene_content command — works the same in-world and in electron.
const MODEL_EXT = /\.(glb|gltf)$/i
export async function loadLocalModels(): Promise<string[]> {
  try {
    const paths = await cmd.sceneContent()
    return paths.filter((p) => MODEL_EXT.test(p)).sort()
  } catch {
    return []
  }
}

// Place a model that's already in the project content at `position`.
export async function placeLocalModel(
  rel: string,
  name: string,
  position: { x: number; y: number; z: number }
): Promise<void> {
  const ids = await createEntities([
    {
      Transform: {
        position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        parent: 0
      },
      GltfContainer: { src: rel, visibleMeshesCollisionMask: 3 },
      [NAME_COMPONENT]: { value: uniqueEntityName(name) }
    }
  ])
  if (ids.length > 0) {
    const eid = String(ids[0])
    state.selected = new Set([eid])
    state.activeEntity = eid
    selectEntityInTree(state.snapshot, eid)
  }
}

// Upload a local GLB/GLTF from disk (HTML File — works in both the browser and
// the electron renderer): persist it via the data-layer, register it with the
// live scene, then place it. Returns the content-relative path.
export async function uploadModel(
  file: File,
  position: { x: number; y: number; z: number }
): Promise<string> {
  if (dataLayerAvailable() !== true) {
    throw new Error('upload needs the scene server running with --data-layer')
  }
  const safe = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')
  const rel = `models/${safe}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  await dataLayerSaveFileBytes(rel, bytes)
  const reply = await cmd.registerContent(rel)
  if (reply.hash !== undefined) {
    const realm = dataLayerRealm() ?? ''
    const url = `${realm}/content/contents/${reply.hash}`
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(url, { method: 'HEAD' })).ok) break
      } catch {
        /* dev server briefly busy — retry */
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  await placeLocalModel(rel, file.name.replace(MODEL_EXT, ''), position)
  return rel
}

// Default drop position: the centre of the parcel the editor was opened at
// (?position=x,y), at ground level.
export function defaultDropPosition(): { x: number; y: number; z: number } {
  const raw = new URLSearchParams(window.location.search).get('position') ?? '0,0'
  const [px, py] = raw.split(',').map((n) => parseInt(n, 10))
  return {
    x: (Number.isFinite(px) ? px : 0) * 16 + 8,
    y: 0,
    z: (Number.isFinite(py) ? py : 0) * 16 + 8
  }
}
