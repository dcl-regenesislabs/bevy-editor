// Read/merge-write the editable subset of a project's scene.json. The pure
// halves (extract / validate / apply) are Electron-free so they can be
// unit-tested; the fs wrappers at the bottom are what main.ts wires to IPC.
import fs from 'node:fs'
import path from 'node:path'
import type { SceneSettings, SpawnPointSetting } from '@dcl-editor/contract'

export const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

// scene.json as parsed — everything optional, everything else preserved
interface RawSceneJson {
  display?: { title?: string; description?: string; navmapThumbnail?: string; [k: string]: unknown }
  contact?: { name?: string; email?: string; [k: string]: unknown }
  scene?: { parcels?: string[]; base?: string; [k: string]: unknown }
  spawnPoints?: RawSpawnPoint[]
  [k: string]: unknown
}
interface RawSpawnPoint {
  name?: string
  default?: boolean
  position?: { x?: number | number[]; y?: number | number[]; z?: number | number[] }
  // per spec cameraTarget is plain floats, but tolerate the array form some
  // tools emit for position — better a midpoint than NaN in the UI
  cameraTarget?: { x?: number | number[]; y?: number | number[]; z?: number | number[] }
}

// an axis range [min,max] becomes its midpoint — the editor edits one spot
function axis(v: number | number[] | undefined): number {
  if (Array.isArray(v)) return v.length === 0 ? 0 : (Math.min(...v) + Math.max(...v)) / 2
  return typeof v === 'number' ? v : 0
}

export function extractSettings(raw: RawSceneJson): Omit<SceneSettings, 'thumbnail'> {
  return {
    title: raw.display?.title ?? '',
    description: raw.display?.description ?? '',
    thumbnailPath: raw.display?.navmapThumbnail ?? null,
    contactName: raw.contact?.name ?? '',
    contactEmail: raw.contact?.email ?? '',
    parcels: Array.isArray(raw.scene?.parcels) ? [...raw.scene.parcels] : [],
    base: raw.scene?.base ?? '',
    spawnPoints: (raw.spawnPoints ?? []).map((p, i) => ({
      name: p.name ?? `Spawn Point ${i + 1}`,
      default: p.default === true,
      position: { x: axis(p.position?.x), y: axis(p.position?.y), z: axis(p.position?.z) },
      ...(p.cameraTarget !== undefined
        ? { cameraTarget: { x: axis(p.cameraTarget.x), y: axis(p.cameraTarget.y), z: axis(p.cameraTarget.z) } }
        : {})
    }))
  }
}

const PARCEL_RE = /^-?\d+,-?\d+$/

export function validateSettings(s: SceneSettings): string | null {
  if (s.title.trim() === '') return 'The scene needs a name'
  if (s.parcels.length === 0) return 'The scene needs at least one parcel'
  const bad = s.parcels.find((p) => !PARCEL_RE.test(p))
  if (bad !== undefined) return `"${bad}" is not a valid parcel — use "x,y"`
  if (new Set(s.parcels).size !== s.parcels.length) return 'Duplicate parcels'
  if (!s.parcels.includes(s.base)) return 'The base parcel must be one of the scene’s parcels'
  for (const sp of s.spawnPoints) {
    if (sp.name.trim() === '') return 'Every spawn point needs a name'
    for (const v of [sp.position.x, sp.position.y, sp.position.z]) {
      if (!Number.isFinite(v)) return `Spawn point "${sp.name}" has an invalid position`
    }
    if (sp.cameraTarget !== undefined) {
      for (const v of [sp.cameraTarget.x, sp.cameraTarget.y, sp.cameraTarget.z]) {
        if (!Number.isFinite(v)) return `Spawn point "${sp.name}" has an invalid camera target`
      }
    }
  }
  return null
}

// Merge the settings into the parsed scene.json, keeping every field the
// editor doesn't model (top-level, and unknown keys inside display/contact/
// scene). Returns a new object; `raw` is not mutated.
export function applySettings(raw: RawSceneJson, s: SceneSettings): RawSceneJson {
  const spawnPoints = s.spawnPoints.map((p: SpawnPointSetting) => ({
    name: p.name.trim(),
    default: p.default,
    position: { x: p.position.x, y: p.position.y, z: p.position.z },
    ...(p.cameraTarget !== undefined ? { cameraTarget: { ...p.cameraTarget } } : {})
  }))
  return {
    ...raw,
    display: {
      ...(raw.display ?? {}),
      title: s.title.trim(),
      description: s.description.trim(),
      ...(s.thumbnailPath !== null ? { navmapThumbnail: s.thumbnailPath } : {})
    },
    contact: { ...(raw.contact ?? {}), name: s.contactName.trim(), email: s.contactEmail.trim() },
    scene: { ...(raw.scene ?? {}), parcels: [...s.parcels], base: s.base },
    spawnPoints
  }
}

// ---- fs wrappers (main-process only) ----

export function thumbnailDataUrl(dir: string, rel: string | null): string | null {
  if (rel === null || rel === '') return null
  const p = path.join(dir, rel)
  try {
    if (!fs.existsSync(p) || fs.statSync(p).size > 4_000_000) return null
    const mime = IMG_MIME[path.extname(p).toLowerCase()] ?? 'image/png'
    return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`
  } catch {
    return null
  }
}

export function loadSceneSettings(dir: string): SceneSettings {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'scene.json'), 'utf8')) as RawSceneJson
  const s = extractSettings(raw)
  return { ...s, thumbnail: thumbnailDataUrl(dir, s.thumbnailPath) }
}

// Resolves an error message (invalid input) or null on success.
export function saveSceneSettings(dir: string, s: SceneSettings): string | null {
  const err = validateSettings(s)
  if (err !== null) return err
  const file = path.join(dir, 'scene.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RawSceneJson
  fs.writeFileSync(file, JSON.stringify(applySettings(raw, s), null, 2) + '\n')
  return null
}

// Copy a picked image into the project (assets/images/) and return its
// project-relative path + preview. The copy keeps scene.json portable — a
// navmapThumbnail pointing outside the folder would break on deploy.
export function importThumbnail(dir: string, srcPath: string): { path: string; dataUrl: string } {
  const ext = path.extname(srcPath).toLowerCase()
  if (IMG_MIME[ext] === undefined) throw new Error('not a supported image (png, jpg, gif, webp)')
  const destDir = path.join(dir, 'assets', 'images')
  fs.mkdirSync(destDir, { recursive: true })
  const rel = path.posix.join('assets', 'images', `scene-thumbnail${ext}`)
  fs.copyFileSync(srcPath, path.join(dir, rel))
  const dataUrl = thumbnailDataUrl(dir, rel)
  if (dataUrl === null) throw new Error('could not read the copied image')
  return { path: rel, dataUrl }
}
