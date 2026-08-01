// One model for the whole entity tree, replacing the old namedForest/codeSpawned
// pair. Those two disagreed: namedForest kept entities that have a Name, while
// codeSpawned kept entities missing from the provenance baseline. Anything
// authored-but-unnamed fell through both and was invisible even though the save
// writes it into main.composite; anything code-spawned-but-named rendered twice.
//
// `forest.children` holds ONLY real entity ids. The per-parent code buckets are a
// separate map, because every lookup in EntityRow (snapshot[id], prefabAssetId,
// outOfBoundsSet.has, matches, drag.over) is keyed by entity id and a synthetic
// bucket id would silently misrender in exactly the recursion path they share.
import { parentOf, isUiEntity, isRuntimeEntity, type Forest, type Snapshot } from '../../../scene/src/state'
import { entityName } from '../../../scene/src/custom-components'

// SDK7 reserves the first block of ids for the engine and the player. Entity ids
// are version-packed — (index & 0xffff) | (version << 16) — so a recycled id is
// >= 65536 and never falls below this bound by accident.
export const RESERVED_ENTITIES = 512

export interface HierarchyModel {
  forest: Forest
  isCode: (id: string) => boolean
  staticRoots: string[]
  codeRoots: string[]
  engineRoots: string[]
  /** authored parent -> its code-spawned children, rendered in an inline bucket */
  codeChildren: Map<string, string[]>
  counts: { static: number; code: number; engine: number }
}

// isUiEntity only inspects an entity's OWN components, so a UI node whose
// UiTransform hasn't synced yet — or any child under a UI root — reads as world
// content. Walk up: anything under the scene's UI is UI.
function underUi(snapshot: Snapshot, id: string): boolean {
  let cur: string | null = id
  for (let hops = 0; cur !== null && hops < 64; hops++) {
    if (isUiEntity(snapshot, cur)) return true
    cur = parentOf(snapshot, cur)
  }
  return false
}

export function isEngineEntity(snapshot: Snapshot, id: string): boolean {
  const n = Number(id)
  if (!Number.isFinite(n)) return true
  if (n < RESERVED_ENTITIES) return true
  return underUi(snapshot, id)
}

// Static <=> the id is a key of provenanceBaseline(), or this session created it.
// NOT "has a Name": Name is one more savable component, and the save writes
// authored-but-unnamed entities into main.composite regardless.
export function isCodeEntity(id: string, baseline: Snapshot | null): boolean {
  return isRuntimeEntity(id, baseline)
}

export function buildHierarchyModel(
  snapshot: Snapshot,
  baseline: Snapshot | null,
  showEngine: boolean
): HierarchyModel {
  // entity '0' always carries inspector::Nodes, so it is never scene content.
  // Component-less ids are bookkeeping. With a null baseline nothing is known to
  // be code yet, so fall back to today's named-only keep-set rather than guessing
  // a split that a late /crdt_initial would then invert.
  const kept = Object.keys(snapshot).filter((id) => {
    if (id === '0') return false
    if (Object.keys(snapshot[id] ?? {}).length === 0) return false
    if (!showEngine && isEngineEntity(snapshot, id)) return false
    if (baseline === null) return entityName(snapshot, id) !== undefined
    return true
  })
  const keptSet = new Set(kept)

  // Re-root past dropped ancestors — this is what keeps a code-spawned dot
  // attached to the authored Sit Spot it was parented to.
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const id of kept) {
    let p = parentOf(snapshot, id)
    while (p !== null && !keptSet.has(p)) p = parentOf(snapshot, p)
    if (p === null) roots.push(id)
    else children.set(p, [...(children.get(p) ?? []), id])
  }
  const byId = (a: string, b: string): number => Number(a) - Number(b)
  roots.sort(byId)
  for (const s of children.values()) s.sort(byId)

  const code = (id: string): boolean => isCodeEntity(id, baseline)
  const engine = (id: string): boolean => showEngine && isEngineEntity(snapshot, id)

  // Split each authored parent's children: code ones move to the bucket map.
  // A code parent keeps all of its children inline — code nests into code
  // natively, and the bucket would then be saying nothing new.
  const codeChildren = new Map<string, string[]>()
  for (const [parent, kids] of children) {
    if (code(parent) || engine(parent)) continue
    const bucket = kids.filter((k) => code(k))
    if (bucket.length === 0) continue
    children.set(
      parent,
      kids.filter((k) => !code(k))
    )
    codeChildren.set(parent, bucket)
  }

  const engineRoots = roots.filter((id) => engine(id))
  const rest = roots.filter((id) => !engine(id))
  return {
    forest: { roots, children },
    isCode: code,
    staticRoots: rest.filter((id) => !code(id)),
    codeRoots: rest.filter((id) => code(id)),
    engineRoots,
    codeChildren,
    counts: {
      static: kept.filter((id) => !code(id) && !engine(id)).length,
      code: kept.filter((id) => code(id) && !engine(id)).length,
      engine: kept.filter(engine).length
    }
  }
}

// Memoised on identity — the store is replace-on-write, so a new object means new
// content. Today's codeSpawned redoes an O(64) ancestor walk per candidate on
// every render with no memo at all.
let cache: { s: Snapshot; b: Snapshot | null; e: boolean; m: HierarchyModel } | null = null
export function hierarchyModel(s: Snapshot, b: Snapshot | null, e: boolean): HierarchyModel {
  if (cache !== null && cache.s === s && cache.b === b && cache.e === e) return cache.m
  const m = buildHierarchyModel(s, b, e)
  cache = { s, b, e, m }
  return m
}
