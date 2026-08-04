// Which project prefab copies nothing in the scene uses any more.
//
// Placing a built-in copies its whole folder into `custom/<slug>/` — data,
// composite AND resources — so the scene owns what it renders. Deleting the last
// instance leaves that copy behind, and it is dead weight the creator never asked
// for. Only BUILT-IN copies are offered for removal: the editor still ships the
// original, so the copy can always come back. A prefab made here, imported or
// pulled from GitHub is the only copy there is and is never offered.
//
// Pure (no data-layer, no browser globals) so the panel and the tests share it.
import { prefabAssetId } from './provenance'
import type { PrefabEntry } from '../panels/prefab-store'

/** Authored instances per prefab id, from the scene snapshot. */
export function instanceCounts(snapshot: Record<string, Record<string, unknown>>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const components of Object.values(snapshot)) {
    const assetId = prefabAssetId(components)
    if (assetId !== null) counts.set(assetId, (counts.get(assetId) ?? 0) + 1)
  }
  return counts
}

/**
 * Project copies of built-in prefabs with no instance left in the scene.
 *
 * Counts AUTHORED entities only — a script that places one at runtime by slug
 * leaves no trace in the snapshot, which is why removal stays a deliberate act
 * the creator confirms, never something a delete does on its own.
 */
export function unusedBuiltinCopies(
  items: PrefabEntry[],
  snapshot: Record<string, Record<string, unknown>>
): PrefabEntry[] {
  const counts = instanceCounts(snapshot)
  return items.filter(
    (item) => item.data.origin?.source === 'builtin' && (counts.get(item.data.id) ?? 0) === 0
  )
}
