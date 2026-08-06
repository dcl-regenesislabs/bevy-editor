// The save-time projection behind Placement = "Editing only".
//
// An anchor marked `inspector::Inert` is a placed entity the creator edits
// against but that must not exist in the running game. Nothing about the
// authored data is mutated to achieve that: the marker is editor state, the live
// snapshot keeps the anchor's Script rows, colliders and visibility exactly as
// authored, and only the composite being written is projected. That is what
// makes "Save over prefab" on a ghost recapture clean content by construction —
// capture reads the snapshot, and `inspector::*` never travels with a prefab.
//
// The projection covers the marked entity AND its whole Transform subtree: a
// ghost whose child still ran a script (or still had a collider) would be half
// present, which is the one outcome nobody could reason about.
//
// main.composite is the ONLY persistent store of authored data, so the
// projection cannot simply drop what it suppresses: reopening the project
// re-derives the snapshot from that file, and a lossy write would delete the
// creator's scripts and colliders for good. Everything the projection removes or
// rewrites is therefore carried alongside it in `inspector::InertBackup`, and
// `restoreInert` puts it back on the way in (pullSnapshot, next to the other
// snapshot decoders). The backup is inert by construction — a string nothing
// reads at run time.
import { SCRIPT_COMPONENT, TRIGGER_AREA } from './allowed-components'

export const INERT_COMPONENT = 'inspector::Inert'
export const INERT_BACKUP_COMPONENT = 'inspector::InertBackup'

const TRANSFORM = 'Transform'
const MESH_COLLIDER = 'MeshCollider'
const VISIBILITY = 'VisibilityComponent'
const GLTF_CONTAINER = 'GltfContainer'

// Behaviour, collision and zone triggers: the three ways an entity can still act
// on the game after it stops being drawn. A GLB is the fourth — and hiding it is
// not enough: the renderer downloads and parses a GltfContainer regardless of
// visibility, so a spawn-only anchor would make every player pay for a model the
// opening frame never shows. The src is blanked (the authored value rides in the
// backup); '' is the same value the spawner's release-reset writes, a known-safe
// state, and clones never read this entity anyway — they come from the bundle's
// snapshots.
const SUPPRESSED: readonly string[] = [SCRIPT_COMPONENT, MESH_COLLIDER, TRIGGER_AREA]

export type AuthoredData = Record<string, Record<string, unknown>>

const HIDDEN = { visible: false }
// Both masks matter: meshes named *_collider fall back to the invisible mask, and
// the renderer skips inserting a collider only when the resolved bits are 0.
const NO_COLLISION = { visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 }

function parentOf(components: Record<string, unknown>): string | null {
  const transform = components[TRANSFORM]
  if (typeof transform !== 'object' || transform === null) return null
  const parent = (transform as { parent?: unknown }).parent
  return typeof parent === 'number' ? String(parent) : null
}

// Every entity that is marked, or descends from one. Walked over the child map
// rather than up each entity's ancestors so a Transform.parent cycle (which the
// editor can't author but a hand-edited composite can carry) terminates.
export function inertSubtree(authored: AuthoredData): Set<string> {
  const marked = new Set<string>()
  const children = new Map<string, string[]>()
  for (const [id, components] of Object.entries(authored)) {
    if (components[INERT_COMPONENT] !== undefined) marked.add(id)
    const parent = parentOf(components)
    if (parent === null) continue
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [id])
    else siblings.push(id)
  }
  const queue = [...marked]
  while (queue.length > 0) {
    const id = queue.pop() as string
    for (const child of children.get(id) ?? []) {
      if (marked.has(child)) continue
      marked.add(child)
      queue.push(child)
    }
  }
  return marked
}

// What the built scene sees instead of the authored value, or `undefined` when
// the component is dropped outright.
function projectComponent(name: string, value: unknown): unknown {
  if (SUPPRESSED.includes(name)) return undefined
  if (name === VISIBILITY) return { ...HIDDEN }
  if (name === GLTF_CONTAINER && typeof value === 'object' && value !== null) {
    return { ...(value as Record<string, unknown>), src: '', ...NO_COLLISION }
  }
  return value
}

// Returns a new object; `authored` is never mutated. state.savedBaseline is
// cached from the same data before the SDK conversion, so mutating in place here
// would make the next save diff against a scene that was never on disk.
export function projectInert(authored: AuthoredData): AuthoredData {
  const marked = inertSubtree(authored)
  if (marked.size === 0) return authored
  const out: AuthoredData = {}
  for (const [id, components] of Object.entries(authored)) {
    if (!marked.has(id)) {
      out[id] = components
      continue
    }
    const projected: Record<string, unknown> = {}
    // `null` means "this entity had none — delete it again on the way back".
    const backup: Record<string, unknown> = {}
    // If the live value is itself the projection's output — a blanked model, a
    // folder token — the restore was refused or never ran, and "backing it up"
    // would launder the damage into the authored record. Keep what the previous
    // backup said instead; the heal repairs the live value from the prefab.
    const previous = previousBackup(components[INERT_BACKUP_COMPONENT])
    for (const [name, value] of Object.entries(components)) {
      if (name === INERT_BACKUP_COMPONENT) continue // a stale backup never survives a re-project
      const next = projectComponent(name, value)
      const poisoned = isProjectionArtifact(name, value)
      if (poisoned) {
        if (previous !== null && name in previous && !isProjectionArtifact(name, previous[name])) {
          backup[name] = previous[name]
        }
        projected[name] = next === undefined ? value : next
        continue
      }
      if (next === undefined) {
        backup[name] = value
        continue
      }
      if (next !== value) backup[name] = value
      // rewritten in place so the component keeps its slot in the entity's key
      // order — the composite's per-component blocks are built by iteration
      projected[name] = next
    }
    if (components[VISIBILITY] === undefined) {
      projected[VISIBILITY] = { ...HIDDEN }
      backup[VISIBILITY] = null
    } else if (previous !== null && VISIBILITY in previous && backup[VISIBILITY] === undefined) {
      // a bare {visible:false} echo restored from a broken backup must not
      // replace what the last good backup knew about the authored visibility
      const live = components[VISIBILITY]
      const bare = isRecord(live) && live.visible === false && Object.keys(live).length === 1
      if (bare) backup[VISIBILITY] = previous[VISIBILITY]
    }
    if (Object.keys(backup).length > 0) projected[INERT_BACKUP_COMPONENT] = { value: JSON.stringify(backup) }
    out[id] = projected
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function previousBackup(carried: unknown): Record<string, unknown> | null {
  const text = isRecord(carried) ? carried.value : undefined
  if (typeof text !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The shapes only the projection produces — unauthorable from the UI. */
function isProjectionArtifact(name: string, value: unknown): boolean {
  if (name !== GLTF_CONTAINER || !isRecord(value)) return false
  const src = value.src
  return src === '' || (typeof src === 'string' && src.includes('{assetPath}'))
}

// The inverse, applied to a snapshot read back from the scene's CRDT. Mutates in
// place like the other snapshot decoders, and always removes the backup itself —
// an entity that is no longer inert must not keep one, and capture must never see
// it.
/**
 * What the restore put back, per entity: component name → authored value, or
 * null where the projection had added one that must go. The caller pushes these
 * to the ENGINE — restoring the snapshot alone leaves the viewport rendering
 * what the file said (an inert anchor stays invisible, its colliders stay off),
 * because the engine loaded that file directly.
 */
export type RestoredInert = Array<{ id: string; components: Record<string, unknown | null> }>

export function restoreInert(snapshot: AuthoredData): RestoredInert {
  const restored: RestoredInert = []
  for (const [id, components] of Object.entries(snapshot)) {
    const carried = components[INERT_BACKUP_COMPONENT]
    if (carried === undefined) continue
    const put: Record<string, unknown | null> = {}
    delete components[INERT_BACKUP_COMPONENT]
    const text = (carried as { value?: unknown }).value
    if (typeof text !== 'string') continue
    let backup: unknown
    try {
      backup = JSON.parse(text)
    } catch {
      continue // a hand-edited composite must not take the whole snapshot down
    }
    if (typeof backup !== 'object' || backup === null || Array.isArray(backup)) continue
    for (const [name, value] of Object.entries(backup as Record<string, unknown>)) {
      // a backup holding a folder token was poisoned by an earlier build;
      // restoring it would trade one unloadable value for another, and worse,
      // one that no longer looks broken. Left projected, the heal repairs it
      // from the prefab folder with the real path.
      if (value !== null && JSON.stringify(value).includes('{assetPath}')) continue
      if (value === null) delete components[name]
      else components[name] = value
      put[name] = value
    }
    restored.push({ id, components: put })
  }
  return restored
}
