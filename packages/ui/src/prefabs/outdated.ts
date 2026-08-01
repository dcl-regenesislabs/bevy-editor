// Which project prefab copies lag behind the built-in masters they were placed
// from. Pure: the store feeds it the project list and the builtin library list
// it already holds.
import { compareVersions, type PrefabChangelogEntry, type PrefabData } from './format'

export interface OutdatedPrefab {
  // the project copy's folder, "custom/<slug>"
  slug: string
  copyVersion: string
  masterVersion: string
  // master changelog entries newer than the copy, newest first
  notes: PrefabChangelogEntry[]
}

// a prefab folder this project owns (prefab-store's PrefabEntry, structurally) —
// named apart from library.ts's ProjectPrefabCopy, which is a copy *result*
export interface ProjectPrefabEntry {
  folder: string
  data: PrefabData
}

export function computeOutdated(
  copies: ProjectPrefabEntry[],
  masters: PrefabData[]
): Map<string, OutdatedPrefab> {
  const masterById = new Map(masters.map((m) => [m.id, m]))
  const outdated = new Map<string, OutdatedPrefab>()
  for (const copy of copies) {
    const master = masterById.get(copy.data.id)
    if (master === undefined) continue
    const copyVersion = copy.data.version ?? '0.0.0'
    const masterVersion = master.version ?? '0.0.0'
    if (compareVersions(masterVersion, copyVersion) <= 0) continue
    const notes = (master.changelog ?? [])
      .filter((entry) => compareVersions(entry.version, copyVersion) > 0)
      .sort((a, b) => compareVersions(b.version, a.version))
    outdated.set(copy.data.id, { slug: copy.folder, copyVersion, masterVersion, notes })
  }
  return outdated
}
