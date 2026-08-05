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
import { SCRIPT_COMPONENT, TRIGGER_AREA } from './allowed-components'

export const INERT_COMPONENT = 'inspector::Inert'

const TRANSFORM = 'Transform'
const MESH_COLLIDER = 'MeshCollider'
const VISIBILITY = 'VisibilityComponent'

// Behaviour, collision and zone triggers: the three ways an entity can still act
// on the game after it stops being drawn.
const SUPPRESSED: readonly string[] = [SCRIPT_COMPONENT, MESH_COLLIDER, TRIGGER_AREA]

export type AuthoredData = Record<string, Record<string, unknown>>

const HIDDEN = { visible: false }

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
    for (const [name, value] of Object.entries(components)) {
      if (SUPPRESSED.includes(name)) continue
      // rewritten in place so the component keeps its slot in the entity's key
      // order — the composite's per-component blocks are built by iteration
      projected[name] = name === VISIBILITY ? { ...HIDDEN } : value
    }
    if (projected[VISIBILITY] === undefined) projected[VISIBILITY] = { ...HIDDEN }
    out[id] = projected
  }
  return out
}
