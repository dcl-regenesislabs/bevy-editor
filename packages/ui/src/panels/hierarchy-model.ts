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
import { state, parentOf, isUiEntity, isRuntimeEntity, type Forest, type Snapshot } from '../../../scene/src/state'
import { entityName } from '../../../scene/src/custom-components'
import { log } from '../log'

// SDK7 reserves the first block of ids for the engine and the player. Entity ids
// are version-packed — (index & 0xffff) | (version << 16) — so a recycled id is
// >= 65536 and never falls below this bound by accident.
export const RESERVED_ENTITIES = 512

export interface HierarchyModel {
  forest: Forest
  isCode: (id: string) => boolean
  isEngine: (id: string) => boolean
  staticRoots: string[]
  codeRoots: string[]
  engineRoots: string[]
  /** top-level entities with nothing inspectable on them — see `isInert` */
  unknownRoots: string[]
  /** authored parent -> its code-spawned children, rendered in an inline bucket */
  codeChildren: Map<string, string[]>
  counts: { static: number; code: number; engine: number; unknown: number }
}

// A component id the engine sent us as a bare number: a component the scene
// defined itself (engine.defineComponent) whose schema the editor has no way to
// read. Decoding leaves these in place rather than dropping them.
const UNRESOLVED_COMPONENT = /^\d+$/

// Nothing here for a creator: no protobuf component to inspect, no children to
// hold structure — just a Transform, and maybe a custom component we can't read.
// Real scenes are full of them (247 of Genesis Plaza's 1333 entities are anchors
// a script parents things to), and listed inline they bury every row that means
// something under a wall of identical, unclickable ones.
function isInert(snapshot: Snapshot, id: string, childCount: number): boolean {
  if (childCount > 0) return false
  const keys = Object.keys(snapshot[id] ?? {})
  return keys.every((k) => k === 'Transform' || UNRESOLVED_COMPONENT.test(k))
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

// Only the reserved block — root, player, camera. UI is NOT engine: the scene's
// own code builds it, so it belongs in the code group.
export function isEngineEntity(snapshot: Snapshot, id: string): boolean {
  const n = Number(id)
  if (!Number.isFinite(n)) return true
  return n < RESERVED_ENTITIES
}

// Editor bookkeeping (inspector::Nodes, inspector::TransformConfig). Never scene
// content — an entity carrying nothing but these is our own metadata, and listing
// it as an entity the creator made is just noise.
function isEditorInternal(snapshot: Snapshot, id: string): boolean {
  const keys = Object.keys(snapshot[id] ?? {})
  return keys.length > 0 && keys.every((k) => k.startsWith('inspector::'))
}

// The composite's own tree of authored entities, carried on entity 0 and written
// by buildComposite (composite.ts:142-152). This is main.composite telling us
// exactly what it wrote, present synchronously in the snapshot — unlike
// /crdt_initial, which is an async fetch that can and does come back empty, in
// which case every authored entity silently reads as code.
export function authoredIds(snapshot: Snapshot): Set<string> | null {
  const nodes = (snapshot['0']?.['inspector::Nodes'] as { value?: unknown } | undefined)?.value
  if (!Array.isArray(nodes)) return null
  const out = new Set<string>()
  for (const n of nodes) {
    const e = (n as { entity?: unknown } | null)?.entity
    if (typeof e === 'number') out.add(String(e))
  }
  // An empty tree is no signal at all — treating it as "nothing is authored"
  // is exactly the failure this function exists to avoid.
  return out.size > 0 ? out : null
}

// The one namespace only an authoring tool ever writes. The scene's own code has
// no definition for inspector::*, so carrying one is proof the entity came out of
// main.composite — which is what makes a scene classify correctly even when
// /crdt_initial returns empty AND entity 0's node tree never reaches us.
// Deliberately NOT asset-packs::, which is a runtime library that stamps its own
// components on entities while the scene plays.
function hasAuthoringMetadata(snapshot: Snapshot, id: string): boolean {
  return Object.keys(snapshot[id] ?? {}).some((k) => k.startsWith('inspector::'))
}

// Static <=> in main.composite. No single signal has proven reliable, so take the
// union — a code-spawned entity satisfies none of them:
//  1. UI is never authorable (allowed-components.ts:5), and wins over everything.
//  2. Created by the editor this session.
//  3. Carries editor metadata (inspector::*).
//  4. Listed in the composite's inspector::Nodes tree on entity 0.
//  5. Present in the /crdt_initial baseline.
export function isCodeEntity(
  snapshot: Snapshot,
  id: string,
  baseline: Snapshot | null,
  authored: Set<string> | null
): boolean {
  if (underUi(snapshot, id)) return true
  if (state.createdEntities.has(id)) return false
  if (hasAuthoringMetadata(snapshot, id)) return false
  if (authored !== null && authored.has(id)) return false
  if (authored !== null) return true
  return isRuntimeEntity(id, baseline)
}

export function buildHierarchyModel(
  snapshot: Snapshot,
  baseline: Snapshot | null,
  showEngine: boolean,
  fromComposite: Set<string> | null = null
): HierarchyModel {
  // entity '0' always carries inspector::Nodes, so it is never scene content.
  // Component-less ids are bookkeeping. With a null baseline nothing is known to
  // be code yet, so fall back to today's named-only keep-set rather than guessing
  // a split that a late /crdt_initial would then invert.
  // main.composite on disk wins; the in-snapshot node tree is the fallback.
  const authored = fromComposite ?? authoredIds(snapshot)
  // Provenance is unknown only when no signal at all has arrived; then fall back
  // to the named-only tree rather than guessing.
  const known = authored !== null || baseline !== null
  const kept = Object.keys(snapshot).filter((id) => {
    if (id === '0') return false
    if (Object.keys(snapshot[id] ?? {}).length === 0) return false
    if (isEditorInternal(snapshot, id)) return false
    // Visibility and classification are separate questions. Engine ids and the
    // scene's UI stay hidden by default because a busy HUD is hundreds of rows —
    // but when shown, UI is classified as CODE, not as a group of its own.
    if (!showEngine && (isEngineEntity(snapshot, id) || underUi(snapshot, id))) return false
    // While the baseline is pending nothing is known to be authored, so fall back
    // to the named-only tree rather than showing a split that would then invert.
    if (!known) return entityName(snapshot, id) !== undefined
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

  const code = (id: string): boolean => isCodeEntity(snapshot, id, baseline, authored)
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

  // Provenance has been wrong several ways on real scenes; run with ?editorDebug
  // to see which signal actually fired.
  log.debug('hierarchy provenance', {
    entity0: Object.keys(snapshot['0'] ?? {}),
    fromComposite: fromComposite === null ? null : [...fromComposite],
    nodeTree: authored === null ? null : [...authored],
    baselineSize: baseline === null ? null : Object.keys(baseline).length,
    withInspectorMeta: kept.filter((id) => hasAuthoringMetadata(snapshot, id)).length,
    kept: kept.length,
    static: kept.filter((id) => !code(id) && !engine(id)).length,
    code: kept.filter((id) => code(id) && !engine(id)).length
  })

  const engineRoots = roots.filter((id) => engine(id))
  const rest = roots.filter((id) => !engine(id))
  // Only top-level ones get bucketed. Nested, an inert entity is part of its
  // parent's structure and its Transform is relative to it — hoisting it out
  // would move a row away from the only thing that gives it meaning.
  const inert = (id: string): boolean =>
    isInert(snapshot, id, (children.get(id) ?? []).length + (codeChildren.get(id) ?? []).length)
  const unknownRoots = rest.filter(inert)
  const bucketed = new Set(unknownRoots)
  const content = rest.filter((id) => !bucketed.has(id))
  return {
    forest: { roots, children },
    isCode: code,
    isEngine: (id: string) => isEngineEntity(snapshot, id),
    staticRoots: content.filter((id) => !code(id)),
    codeRoots: content.filter((id) => code(id)),
    engineRoots,
    unknownRoots,
    codeChildren,
    counts: {
      static: kept.filter((id) => !code(id) && !engine(id) && !bucketed.has(id)).length,
      code: kept.filter((id) => code(id) && !engine(id) && !bucketed.has(id)).length,
      engine: kept.filter(engine).length,
      unknown: unknownRoots.length
    }
  }
}

// Memoised on identity — the store is replace-on-write, so a new object means new
// content. Today's codeSpawned redoes an O(64) ancestor walk per candidate on
// every render with no memo at all.
let cache: { s: Snapshot; b: Snapshot | null; e: boolean; a: Set<string> | null; m: HierarchyModel } | null = null
export function hierarchyModel(
  s: Snapshot,
  b: Snapshot | null,
  e: boolean,
  a: Set<string> | null = null
): HierarchyModel {
  if (cache !== null && cache.s === s && cache.b === b && cache.e === e && cache.a === a) return cache.m
  const m = buildHierarchyModel(s, b, e, a)
  cache = { s, b, e, a, m }
  return m
}
