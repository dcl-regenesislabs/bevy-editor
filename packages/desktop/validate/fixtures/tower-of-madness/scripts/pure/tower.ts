// The tower plan: which chunk kind stands on which floor, as arithmetic on the
// round's seed and nothing else.
//
// Eleven prefab pools have to agree on ONE stack, and game.layout hands each
// pool its own rng stream (they must differ, or two layouts in one round would
// share draws). So the plan is a hand-written pure function of round.seed and
// the streams go unused — the one place this game had to work around the API.
//
// Fixed draw count, sliced after: the number of floors is itself a draw, so
// drawing exactly MAX_FLOORS picks every round keeps the draw ORDER independent
// of the count. Change that and two screens on the same seed build two towers.

export const CHUNK_KINDS = 10
/** Floor-to-floor height of one chunk, in metres. */
export const CHUNK_HEIGHT = 6
/** Where the tower stands: the middle of the plinth. */
export const BASE_X = 24
export const BASE_Z = 24
/** The plinth's top surface — the first chunk's floor. */
export const BASE_Y = 2
export const MIN_FLOORS = 3
export const MAX_FLOORS = 8

/** Which chunk kind stands on each floor, bottom first. */
export function towerFor(seed: number): number[] {
  let s = seed >>> 0
  const next = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const floors = MIN_FLOORS + Math.floor(next() * (MAX_FLOORS - MIN_FLOORS + 1))
  const picks: number[] = []
  for (let i = 0; i < MAX_FLOORS; i++) picks.push(Math.floor(next() * CHUNK_KINDS))
  return picks.slice(0, floors)
}

/** The world height of a floor, counting from 0 at the plinth. */
export function floorY(floor: number): number {
  return BASE_Y + CHUNK_HEIGHT * floor
}

/** Where the summit chunk sits — and the height a finisher must reach. */
export function topFor(seed: number): number {
  return floorY(towerFor(seed).length)
}
