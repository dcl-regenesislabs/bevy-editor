// Client-side history for the ops dashboard: the admin API serves only the
// latest snapshot per scene, so charts accumulate here poll by poll — same
// approach as the old server-side dashboard, ~10 min at the 10s cadence.
import type { SceneRow } from './ops-data'

export const HISTORY_CAP = 60

export type SceneHistory = Map<string, SceneRow[]>

export function pushHistory(history: SceneHistory, rows: SceneRow[]): void {
  for (const row of rows) {
    const samples = history.get(row.sceneId) ?? []
    samples.push(row)
    if (samples.length > HISTORY_CAP) samples.shift()
    history.set(row.sceneId, samples)
  }
}

export function seriesOf(samples: SceneRow[], pick: (row: SceneRow) => number): Array<number | null> {
  return samples.map((row) => (row.active ? pick(row) : null))
}
