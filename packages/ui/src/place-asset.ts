// Placing an asset as an AUTHORED entity: resolving what the creator (or the
// assistant) named to something placeable, and turning that into the components
// one entity carries.
//
// A model and a sound differ in exactly one respect — which components the new
// entity gets. Naming, transform, parenting, creation, undo and selection are
// identical, so there is one path and `componentsFor` is the only branch. Video,
// NFT shapes and light sources are each one more case here and no new path.
//
// Everything in this file is PURE: it takes the project's file list and the
// catalog as data and returns plain objects. Downloading a catalog asset,
// creating the entity and recording undo belong to actions/assets.ts. The
// ModelAsset import is type-only on purpose — this module pulls in no engine.
import { eulerToQuat, type V3 } from './lib/euler'
import type { ModelAsset } from './assets'

const MODEL_EXT = /\.(glb|gltf)$/i
const AUDIO_EXT = /\.(mp3|wav|ogg)$/i
const URL_PREFIX = /^https?:\/\//i

/** A model that must be downloaded first carries `catalog` and an empty `ref`;
 * actions/assets.ts fills the ref in with the project path the download landed
 * on (`{ ...resolved, ref }`) before building the spec. */
export type ResolvedAsset =
  | { kind: 'model'; name: string; ref: string; catalog: ModelAsset | null }
  | { kind: 'audio-file'; name: string; ref: string }
  | { kind: 'audio-url'; name: string; ref: string }
  | { kind: 'empty'; name: string }

export interface AssetSources {
  /** project-relative paths, as the data layer lists them */
  projectFiles: string[]
  catalog: ModelAsset[]
}

/** Why nothing could be placed, phrased for the creator (and for the notice the
 * assistant reads back). A resolution never guesses between two candidates. */
export interface AssetProblem {
  problem: string
}

export function isProblem(r: ResolvedAsset | AssetProblem): r is AssetProblem {
  return 'problem' in r
}

const baseName = (path: string): string => path.split('/').pop() ?? path
const stripExt = (name: string): string => name.replace(/\.[^.]+$/, '')

// Resolution order, most specific first: a path already in the project, then a
// catalog id, then a catalog name (exact before case-insensitive), then a URL.
// Anything ambiguous is a problem rather than a guess — placing the wrong model
// 30 times is worse than placing nothing and saying why.
export function resolveAsset(
  query: string | undefined,
  sources: AssetSources
): ResolvedAsset | AssetProblem {
  const q = query?.trim() ?? ''
  if (q === '') return { kind: 'empty', name: 'Entity' }

  const file = sources.projectFiles.find((p) => p.toLowerCase() === q.toLowerCase())
  if (file !== undefined) return fromProjectFile(file)

  if (URL_PREFIX.test(q)) {
    if (MODEL_EXT.test(q)) {
      return { problem: `"${q}" is a model URL — models come from the catalog, not a link` }
    }
    return { kind: 'audio-url', name: 'Audio Stream', ref: q }
  }

  const byId = sources.catalog.find((a) => a.id === q)
  if (byId !== undefined) return fromCatalog(byId)

  const exact = sources.catalog.filter((a) => a.name === q)
  if (exact.length === 1) return fromCatalog(exact[0])

  const loose = sources.catalog.filter((a) => a.name.toLowerCase() === q.toLowerCase())
  if (loose.length === 1) return fromCatalog(loose[0])
  const ambiguous = exact.length > 1 ? exact : loose
  if (ambiguous.length > 1) {
    return { problem: `"${q}" matches ${ambiguous.length} assets — name one exactly, or use its id` }
  }

  // A path-looking query that isn't in the project is its own mistake: the file
  // is missing, not the name wrong. Say which, so the fix is obvious.
  if (q.includes('/') || q.includes('.')) {
    return { problem: `there is no "${q}" in this project` }
  }
  return { problem: `there is no asset called "${q}"` }
}

function fromProjectFile(rel: string): ResolvedAsset | AssetProblem {
  const name = stripExt(baseName(rel))
  if (MODEL_EXT.test(rel)) return { kind: 'model', name, ref: rel, catalog: null }
  if (AUDIO_EXT.test(rel)) return { kind: 'audio-file', name, ref: rel }
  return { problem: `"${rel}" is not a model or an audio file, so it can't be placed` }
}

function fromCatalog(asset: ModelAsset): ResolvedAsset {
  return { kind: 'model', name: asset.name, ref: '', catalog: asset }
}

/** Component fields the request may set. Flat on purpose: these are the handful
 * a placement decides, not the whole component. */
export interface AssetSettings {
  playing?: boolean
  loop?: boolean
  volume?: number
}

// THE branch. Everything else about a placement is kind-independent.
export function componentsFor(
  resolved: ResolvedAsset,
  settings?: AssetSettings
): Record<string, unknown> {
  switch (resolved.kind) {
    case 'model':
      // visible meshes double as colliders (physics + pointer) — catalog models
      // ship without separate collider meshes
      return { GltfContainer: { src: resolved.ref, visibleMeshesCollisionMask: 3 } }
    case 'audio-file':
      return {
        AudioSource: {
          audioClipUrl: resolved.ref,
          playing: settings?.playing ?? true,
          loop: settings?.loop ?? false,
          volume: settings?.volume ?? 1
        }
      }
    case 'audio-url':
      return {
        AudioStream: {
          url: resolved.ref,
          playing: settings?.playing ?? true,
          volume: settings?.volume ?? 1
        }
      }
    case 'empty':
      // A grouping entity: a Transform and a Name, nothing else.
      return {}
  }
}

export interface Placement {
  /** parent-local metres; the caller converts world coordinates first */
  position?: V3
  /** euler DEGREES — what a creator reads in the inspector */
  rotation?: V3
  scale?: V3
  /** entity id, 0 = the scene root */
  parent?: number
}

const ORIGIN: V3 = { x: 0, y: 0, z: 0 }
const UNIT: V3 = { x: 1, y: 1, z: 1 }

/** One entity's components, in the shape `createEntities` takes. `name` is
 * already deduped by the caller (uniqueEntityName reads live state). */
export function entitySpec(
  resolved: ResolvedAsset,
  placement: Placement,
  name: string,
  nameComponent: string,
  settings?: AssetSettings
): Record<string, unknown> {
  return {
    Transform: {
      position: placement.position ?? ORIGIN,
      rotation: eulerToQuat(placement.rotation ?? ORIGIN),
      scale: placement.scale ?? UNIT,
      parent: placement.parent ?? 0
    },
    ...componentsFor(resolved, settings),
    [nameComponent]: { value: name }
  }
}
