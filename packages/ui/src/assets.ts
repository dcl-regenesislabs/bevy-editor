// OpenDCL model catalog (https://models.dclregenesislabs.xyz) — 5.7k+ plain
// GLB models, one file per asset, no smart-item wiring. Import flow:
//   1. fetch the GLB from the catalog CDN
//   2. write it into the scene project (models/…) through the dev server's
//      data-layer (so it persists and the dev server can serve it)
//   3. /register_content tells the engine to map the new file into the live
//      scene's content map (renders without a reload)
//   4. create the entity (Transform + GltfContainer + Name) — the composite
//      auto-saves like any other edit
import { cmd } from './engine/cmd'
import { sceneRpc } from './engine/bus'
import { CONTENT_POLL_ATTEMPTS, CONTENT_POLL_INTERVAL_MS } from './config'
import { createEntities } from '@scene/inspector'
import { state, setSelected } from '@scene/state'
import { revealInTree } from './panels/reveal'
import { NAME_COMPONENT } from '@scene/custom-components'
import { dataLayerSaveFileBytes, dataLayerAvailable, dataLayerListFiles } from './engine/datalayer'
import { IGNORED_DIRS } from './script/project-files'
import { referencedNames } from './script/references'
import { gltfExternalUris } from './gltf-refs'

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
//
// A name a SCRIPT still names counts as taken even when no entity carries it. Delete
// every "Trigger Zone" and the reactions that referenced one keep the string; reusing
// the name would silently re-bind them to the next entity to get it (see
// script/references.ts).
//
// `alsoTaken` covers names handed out but not yet in the snapshot — a batch that
// creates 30 entities in one call would otherwise name every one of them the same.
export function uniqueEntityName(base: string, alsoTaken?: ReadonlySet<string>): string {
  const taken = referencedNames(state.snapshot)
  if (alsoTaken !== undefined) for (const n of alsoTaken) taken.add(n)
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

// Make a just-written file resolvable by the live scene without a reload. The
// patched engine had /register_content for this; stock main instead exposes
// /scene_content, which REFRESHES the engine's content map from the dev server
// (picking up files written outside the editor) and returns the file list. Poll
// it until our file appears: that both forces the refresh (so GltfContainer.src
// resolves) and confirms the dev server is serving it before the engine's single
// load attempt. Bounded by config; a miss just means the model may need a reload.
export async function ensureContentMapped(rel: string): Promise<void> {
  const target = rel.toLowerCase()
  for (let i = 0; i < CONTENT_POLL_ATTEMPTS; i++) {
    try {
      const files = await cmd.sceneContent()
      if (files.some((f) => f.toLowerCase() === target)) return
    } catch {
      /* engine briefly busy — retry */
    }
    await new Promise((r) => setTimeout(r, CONTENT_POLL_INTERVAL_MS))
  }
}

// Download a catalog asset into the project and register it with the live
// scene's content map — no entity is created. Returns the project-relative path.
export async function importCatalogFile(asset: ModelAsset): Promise<string> {
  if (dataLayerAvailable() !== true) {
    throw new Error('model import needs the scene server running with --data-layer')
  }
  const rel = modelRelPath(asset)
  const res = await fetch(opendclUrl(asset.url) as string)
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  await dataLayerSaveFileBytes(rel, bytes)
  await ensureContentMapped(rel)
  return rel
}

// One model entity at `position`, selected and revealed. Returns its id — the
// caller records that as a single undo step (actions/assets.ts); null means the
// engine allocated nothing, so there is nothing to undo.
async function createModelEntity(
  rel: string,
  name: string,
  position: { x: number; y: number; z: number }
): Promise<string | null> {
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
      [NAME_COMPONENT]: { value: uniqueEntityName(name) }
    }
  ])
  if (ids.length === 0) return null
  const eid = String(ids[0])
  setSelected([eid])
  state.activeEntity = eid
  revealInTree(eid)
  return eid
}

export async function importModel(
  asset: ModelAsset,
  position: { x: number; y: number; z: number }
): Promise<string | null> {
  const rel = await importCatalogFile(asset)
  return await createModelEntity(rel, asset.name, position)
}

// --- local models (project content) ---
// The scene folder's own files, read off disk through the data layer (the same
// path space saveFile/getFile use). Not the engine's content map: that is keyed
// by the scene's base parcel, so it can answer with a deployed scene's files.
const MODEL_EXT = /\.(glb|gltf)$/i
export async function projectFiles(): Promise<string[]> {
  return await dataLayerListFiles(IGNORED_DIRS)
}
export async function loadLocalModels(): Promise<string[]> {
  try {
    return (await projectFiles()).filter((p) => MODEL_EXT.test(p)).sort()
  } catch {
    return []
  }
}

// Place a model that's already in the project content at `position`.
export async function placeLocalModel(
  rel: string,
  name: string,
  position: { x: number; y: number; z: number }
): Promise<string | null> {
  return await createModelEntity(rel, name, position)
}

const sanitizeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9._-]/g, '-')
const fileBytes = async (f: File): Promise<Uint8Array> => new Uint8Array(await f.arrayBuffer())

// Refs the project content doesn't already satisfy — an earlier upload or
// authored content covers a ref just as well as the current pick. When the
// listing is unavailable, keep the warning rather than swallow it.
async function unsatisfiedRefs(uris: Set<string>): Promise<string[]> {
  if (uris.size === 0) return []
  try {
    const content = new Set((await projectFiles()).map((p) => p.toLowerCase()))
    return [...uris].filter((uri) => !content.has(`models/${uri}`.toLowerCase())).sort()
  } catch {
    return [...uris].sort()
  }
}

// Which files the picked models reference that neither the picked set nor the
// project content satisfies. Checked BEFORE anything is written, so the UI can
// warn while the user can still cancel and re-pick with the textures included.
export async function missingModelRefs(files: File[]): Promise<string[]> {
  const picked = new Set(files.map((f) => f.name.toLowerCase()))
  const missing = new Set<string>()
  for (const f of files) {
    if (!MODEL_EXT.test(f.name)) continue
    for (const uri of gltfExternalUris(f.name, await fileBytes(f))) {
      const basename = uri.split('/').pop() ?? uri
      if (!picked.has(basename.toLowerCase())) missing.add(uri)
    }
  }
  return await unsatisfiedRefs(missing)
}

// Upload local model files from disk (HTML Files — works in both the browser
// and the electron renderer): persist them via the data-layer, register them
// with the live scene, then place the first model. Non-model files are saved at
// the exact relative path the model references (that's how renderers resolve
// them); returns the placed model's name, the entity it landed on (so the caller
// can record one undo step) plus any referenced files that are still missing, so
// the UI can tell the creator before an explorer 404s.
export async function uploadModel(
  files: File[],
  position: { x: number; y: number; z: number }
): Promise<{ name: string; missing: string[]; entityId: string | null }> {
  if (dataLayerAvailable() !== true) {
    throw new Error('upload needs the scene server running with --data-layer')
  }
  const models = files.filter((f) => MODEL_EXT.test(f.name))
  if (models.length === 0) {
    throw new Error('select a .glb or .gltf (plus any textures/buffers it references)')
  }
  const primary = models[0]

  // what the models reference, keyed by basename so picked files (which arrive
  // without folders) can be matched back to the referenced path
  const wantedByBasename = new Map<string, string>()
  const missing = new Set<string>()
  const loaded: Array<{ file: File; bytes: Uint8Array }> = []
  for (const model of models) {
    const bytes = await fileBytes(model)
    loaded.push({ file: model, bytes })
    for (const uri of gltfExternalUris(model.name, bytes)) {
      const basename = uri.split('/').pop()
      if (basename !== undefined) wantedByBasename.set(basename.toLowerCase(), uri)
      missing.add(uri)
    }
  }

  for (const f of files) {
    if (MODEL_EXT.test(f.name)) continue
    const uri = wantedByBasename.get(f.name.toLowerCase())
    // referenced files keep the model's spelling — a sanitized name would no
    // longer match the uri inside the model
    const rel = uri !== undefined ? `models/${uri}` : `models/${sanitizeName(f.name)}`
    await dataLayerSaveFileBytes(rel, await fileBytes(f))
    if (uri !== undefined) missing.delete(uri)
  }

  for (const { file, bytes } of loaded) {
    await dataLayerSaveFileBytes(`models/${sanitizeName(file.name)}`, bytes)
  }

  const placeRel = `models/${sanitizeName(primary.name)}`
  await ensureContentMapped(placeRel)
  const stillMissing = await unsatisfiedRefs(missing)
  const entityId = await placeLocalModel(placeRel, primary.name.replace(MODEL_EXT, ''), position)
  return { name: primary.name, missing: stillMissing, entityId }
}

// Fallback drop position: the centre of the parcel the editor was opened at
// (?position=x,y), at ground level. Used when the camera-aware drop can't be
// computed (camera/world-origin not ready, or the scene didn't answer).
export function defaultDropPosition(): { x: number; y: number; z: number } {
  const raw = new URLSearchParams(window.location.search).get('position') ?? '0,0'
  const [px, py] = raw.split(',').map((n) => parseInt(n, 10))
  return {
    x: (Number.isFinite(px) ? px : 0) * 16 + 8,
    y: 0,
    z: (Number.isFinite(py) ? py : 0) * 16 + 8
  }
}

// Where a freshly-imported model should land: in front of the editor camera on
// the ground (the scene owns the camera, so it computes the local position).
// Falls back to the parcel centre if the camera isn't ready or the rpc fails.
export async function dropPosition(): Promise<{ x: number; y: number; z: number }> {
  try {
    const p = await sceneRpc<{ x: number; y: number; z: number } | null>('cameraDrop')
    if (p !== null && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
      return p
    }
  } catch {
    /* camera not ready / rpc timeout — use the parcel-centre fallback below */
  }
  return defaultDropPosition()
}
