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
// on the game after it stops being drawn. A GLB is the fourth — it carries its
// own collision in GltfContainer's masks, not in MeshCollider — so that one is
// neutralised rather than dropped (the geometry is the whole point of an anchor).
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
    return { ...(value as Record<string, unknown>), ...NO_COLLISION }
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
    for (const [name, value] of Object.entries(components)) {
      if (name === INERT_BACKUP_COMPONENT) continue // a stale backup never survives a re-project
      const next = projectComponent(name, value)
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
    }
    if (Object.keys(backup).length > 0) projected[INERT_BACKUP_COMPONENT] = { value: JSON.stringify(backup) }
    out[id] = projected
  }
  return out
}

// The inverse, applied to a snapshot read back from the scene's CRDT. Mutates in
// place like the other snapshot decoders, and always removes the backup itself —
// an entity that is no longer inert must not keep one, and capture must never see
// it.
export function restoreInert(snapshot: AuthoredData): void {
  for (const components of Object.values(snapshot)) {
    const carried = components[INERT_BACKUP_COMPONENT]
    if (carried === undefined) continue
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
      if (value === null) delete components[name]
      else components[name] = value
    }
  }
}
