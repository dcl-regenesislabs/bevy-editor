// Which script row on a placed item carries its "how do you drive this" line.
//
// The line belongs to the prefab, not to the entity: a creator's own reaction
// script sitting on the same item has nothing to do with it. So it is pinned to
// the ONE row that came out of the prefab folder — every prefab script is
// installed under `<folder>/scripts/`, which is what placement substitutes
// `{assetPath}` for — and rendered under that row's params, where the creator
// was already reading hold seconds and font size and finding no answer.
//
// No prefab script on the entity means the item was gutted: it now does nothing
// at all, and a line about driving it would be describing something that is not
// there. Nothing renders.
import type { PrefabData, PrefabDrivenBy } from '../../prefabs/format'

export interface DriveHint {
  drive: PrefabDrivenBy
  /** the script row the hint renders under */
  path: string
}

export function driveHint(
  prefabs: ReadonlyArray<{ folder: string; data: PrefabData }>,
  assetId: string | null,
  paths: readonly string[]
): DriveHint | null {
  if (assetId === null) return null
  const entry = prefabs.find((p) => p.data.id === assetId)
  const drive = entry?.data.drivenBy
  if (entry === undefined || drive === undefined) return null
  const path = paths.find((p) => p.startsWith(`${entry.folder}/`))
  return path === undefined ? null : { drive, path }
}
