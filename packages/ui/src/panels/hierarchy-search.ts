// The hierarchy's filter, resolved for the whole tree in one walk. A hit buried
// under a collapsed parent or a closed shelf is a hit the creator never sees, so
// `hit` marks the rows that matched (their label gets highlighted) and `keep`
// also marks their ancestors, which is what opens the path down to them. Nothing
// here touches the stored expand state: clearing the filter restores the tree.
import { entityName } from '@scene/custom-components'
import { describeEntity } from '@scene/entity-kind'
import type { Snapshot } from '@scene/state'
import type { HierarchyModel } from './hierarchy-model'

export type HierarchySearch = {
  /** what the creator typed — empty while no filter is active */
  query: string
  /** the row itself matched — its label gets the highlight */
  hit: (id: string) => boolean
  /** the row matched, or something under it did — it renders, and it opens */
  keep: (id: string) => boolean
  /** any of these is kept — what opens a collapsed parent or a closed shelf */
  keptAny: (ids: string[]) => boolean
}

// No filter: every row renders, none is highlighted, nothing is forced open.
export const NO_SEARCH: HierarchySearch = {
  query: '',
  hit: () => false,
  keep: () => true,
  keptAny: () => false
}

// Match the label the row actually shows — since rows display a derived label
// ("Chairwood_02"), matching only on Name would make most rows unfindable.
function rowMatches(snapshot: Snapshot, model: HierarchyModel, id: string, query: string): boolean {
  const q = query.toLowerCase()
  const name = entityName(snapshot, id)
  if (name !== undefined && name.toLowerCase().includes(q)) return true
  if (id.includes(query)) return true
  const kind = describeEntity(snapshot, id, (model.forest.children.get(id) ?? []).length > 0)
  return kind.primary.toLowerCase().includes(q)
}

export function hierarchySearch(query: string, snapshot: Snapshot, model: HierarchyModel): HierarchySearch {
  if (query === '') return NO_SEARCH
  const hit = new Set<string>()
  const keep = new Set<string>()
  const walk = (id: string): boolean => {
    let under = false
    for (const kid of [...(model.forest.children.get(id) ?? []), ...(model.codeChildren.get(id) ?? [])]) {
      if (walk(kid)) under = true
    }
    const self = rowMatches(snapshot, model, id, query)
    if (self) hit.add(id)
    if (self || under) keep.add(id)
    return self || under
  }
  for (const id of [...model.staticRoots, ...model.codeRoots, ...model.engineRoots, ...model.unknownRoots]) walk(id)
  return {
    query,
    hit: (id) => hit.has(id),
    keep: (id) => keep.has(id),
    keptAny: (ids) => ids.some((id) => keep.has(id))
  }
}
