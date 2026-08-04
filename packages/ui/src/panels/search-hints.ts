// Cross-panel search hints. A filter that matches nothing here usually means the
// thing is one panel over (Prefabs vs Assets), and the creator has no way to know
// that without typing it again — so an empty result says how many matches the
// sibling panel holds, and links there.
//
// Counts only: each panel keeps its own filter, so no shared search state exists
// and none is built here. Only lists already in memory are counted — the catalog
// is skipped entirely until a visit has loaded it, rather than fetched for a hint.
// That also decides what Prefabs can offer: the catalog, but not the local models,
// which live in the Assets panel's own state and aren't worth mounting for a count.
import { state } from '@scene/state'
import { prefabStore } from './prefab-store'
import type { PrefabData } from '../prefabs/format'

type CatalogAsset = (typeof state.assetCatalog)[number]

export interface SearchHint {
  label: string
  onClick: () => void
}

/** `filter` is already lower-cased by the caller, as in every panel's filter. */
export function prefabMatches(data: PrefabData, id: string, filter: string): boolean {
  if (filter === '') return true
  return (
    data.name.toLowerCase().includes(filter) ||
    id.toLowerCase().includes(filter) ||
    data.tags.some((t) => t.toLowerCase().includes(filter))
  )
}

export function catalogMatches(asset: CatalogAsset, filter: string): boolean {
  if (filter === '') return true
  return (
    asset.name.toLowerCase().includes(filter) ||
    asset.category.toLowerCase().includes(filter) ||
    asset.pack.toLowerCase().includes(filter) ||
    asset.tags.some((t) => t.toLowerCase().includes(filter))
  )
}

export function countPrefabMatches(filter: string): number {
  if (filter === '') return 0
  return (
    prefabStore.items.filter((p) => prefabMatches(p.data, p.folder, filter)).length +
    prefabStore.library.filter((p) => prefabMatches(p.data, p.ref, filter)).length
  )
}

export function countCatalogMatches(filter: string): number {
  if (filter === '') return 0
  return state.assetCatalog.filter((a) => catalogMatches(a, filter)).length
}

/** No hint at all when the sibling panel has nothing — an empty link is noise. */
export function matchHint(count: number, where: string, go: () => void): SearchHint[] {
  if (count === 0) return []
  return [{ label: `${count} match${count === 1 ? '' : 'es'} in ${where}`, onClick: go }]
}
