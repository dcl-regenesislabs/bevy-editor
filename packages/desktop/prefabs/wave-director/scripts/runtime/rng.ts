import { createRng, type Rng } from './pure/rng'

// Seeded RNG for reconstructed gameplay. The server broadcasts ONE seed (in the
// phase tuple) and every client regenerates identical layouts, spawn plans and
// pick orders from it — never stream what can be reconstructed.
//
// THE DRAW-ORDER CONTRACT (the invariant that makes reconstruction work).
// A stream is only reproducible if every peer takes the SAME draws in the SAME
// order. Nothing enforces this at runtime: a client that draws once more than
// the server desynchronises everything after it, silently. So:
//
//   1. One stream per (seed, purpose). Never share a stream between two
//      independent decisions — `createRng(seed)` for the wave plan and
//      `createRng(seed ^ 0x9e3779b9)` for arena picks, not one stream for both.
//      A seed derived from the phase tuple (`seed`, `phase`) reseeds per phase
//      and makes each phase independently reproducible.
//   2. Fixed count, fixed order. The number of draws must depend ONLY on values
//      every peer shares: the plan tuple and the phase-pinned GameConfig.
//      Never on player count, local time, frame rate, viewport or user input.
//   3. Draw before you branch. Take every draw an item needs, then decide with
//      the values. `if (cond) rng()` is the classic desync: the branch differs
//      per peer and every later draw shifts.
//   4. Iterate in index order. `seededSequence` is the canonical shape — count
//      draws, `i` ascending. Do not iterate a Map, a Set or `Object.keys` of
//      anything a peer could have inserted into in a different order.
//   5. Append, never insert. Adding a draw in the middle of an existing plan
//      re-rolls all history. Add new draws at the END and bump the GameConfig
//      version, which is pinned into the plan tuple, so old and new peers can
//      at least detect the mismatch.
//
// Helpers live in pure/rng.ts and are re-exported here so a prefab script has
// one import.

export type { Rng } from './pure/rng'
export { createRng, rngRange, rngInt, rngPick } from './pure/rng'

/**
 * The canonical reconstructible sequence: exactly `count` entries, index order,
 * one fresh stream per call. `draw` receives the stream and the index and must
 * consume the same number of draws for a given `i` on every peer (rule 2).
 */
export function seededSequence(seed: number, count: number, draw: (rng: Rng, i: number) => number): number[] {
  const rng = createRng(seed)
  const values: number[] = []
  const total = Math.max(0, Math.trunc(count))
  for (let i = 0; i < total; i++) values.push(draw(rng, i))
  return values
}
