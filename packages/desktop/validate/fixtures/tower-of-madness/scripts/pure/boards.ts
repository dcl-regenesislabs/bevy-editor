// The two boards, folded by hand.
//
// game.playerData cannot be enumerated, so an all-time board only exists as an
// aggregate the server keeps itself: fold this round's runs into what game.saved
// holds, keep the top ten, copy that into game.state so every player — and the
// Leaderboard prefabs — can read it. `p` and `time`/`pts` are field names the
// Leaderboard's reader already knows.

export interface Run {
  p: string
  time: number
}

export interface Score {
  p: string
  pts: number
}

const TOP = 10

/** Defensive read of a game.state key holding this round's finishers. */
export function asRuns(value: unknown): Run[] {
  if (!Array.isArray(value)) return []
  const out: Run[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.p !== 'string' || record.p === '') continue
    if (typeof record.time !== 'number' || !Number.isFinite(record.time)) continue
    out.push({ p: record.p, time: record.time })
  }
  return out
}

export function asScores(value: unknown): Score[] {
  if (!Array.isArray(value)) return []
  const out: Score[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (typeof record.p !== 'string' || record.p === '') continue
    if (typeof record.pts !== 'number' || !Number.isFinite(record.pts)) continue
    out.push({ p: record.p, pts: record.pts })
  }
  return out
}

/** Best time per wallet, fastest first. */
export function bestTimes(board: Run[], runs: Run[], n: number = TOP): Run[] {
  const best = new Map(board.map((run) => [run.p, run.time]))
  for (const run of runs) {
    const seen = best.get(run.p)
    best.set(run.p, seen === undefined ? run.time : Math.min(seen, run.time))
  }
  return [...best]
    .map(([p, time]) => ({ p, time }))
    .sort((a, b) => a.time - b.time)
    .slice(0, n)
}

/** Season points per wallet, highest first. Podium places first, then the rest. */
export function season(board: Score[], runs: Run[], podium: number[], base: number, n: number = TOP): Score[] {
  const total = new Map(board.map((score) => [score.p, score.pts]))
  runs.forEach((run, place) => {
    total.set(run.p, (total.get(run.p) ?? 0) + (podium[place] ?? base))
  })
  return [...total]
    .map(([p, pts]) => ({ p, pts }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, n)
}
