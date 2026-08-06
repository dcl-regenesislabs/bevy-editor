// The Level Slots pick math. It runs on the server (which draws) and on every
// client (which only reads the drawn index), so the rules that matter are the
// boundary ones: an index is never out of range, a slot never redraws the arena
// it is already showing, and only a slot whose pick moved is torn down.
import { describe, expect, it } from 'vitest'
import {
  changedSlots,
  isRotationPhase,
  normalizeRefs,
  pickSlots,
  refAt,
  rotationSeed,
  slotCountFor
} from '../prefabs/level-slots/scripts/pure/slotPick'

describe('picking an arena per slot', () => {
  it('picks nothing when there are no arenas and everything when there is one', () => {
    expect(pickSlots({ draws: [0.1, 0.9], arenaCount: 0 })).toEqual([-1, -1])
    expect(pickSlots({ draws: [0.1, 0.9], arenaCount: 1 })).toEqual([0, 0])
  })

  it('stays in range at both ends of the draw', () => {
    expect(pickSlots({ draws: [0, 0.999999], arenaCount: 4 })).toEqual([0, 3])
    // a draw outside [0,1) is a broken rng, not a reason to index past the end
    expect(pickSlots({ draws: [1, -0.5, Number.NaN], arenaCount: 3 })).toEqual([0, 0, 0])
  })

  it('never gives a slot the arena it is already showing', () => {
    for (let i = 0; i < 100; i++) {
      const picks = pickSlots({ draws: [i / 100], arenaCount: 3, previous: [1] })
      expect(picks[0]).not.toBe(1)
      expect(picks[0]).toBeGreaterThanOrEqual(0)
      expect(picks[0]).toBeLessThan(3)
    }
  })

  it('covers every other arena as the draw sweeps', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 100; i++) seen.add(pickSlots({ draws: [i / 100], arenaCount: 3, previous: [1] })[0])
    expect([...seen].sort()).toEqual([0, 2])
  })

  it('ignores a stale previous pick that no longer names an arena', () => {
    expect(pickSlots({ draws: [0], arenaCount: 2, previous: [7] })).toEqual([0])
  })
})

describe('reading the arenas param', () => {
  it('accepts an array, a comma-separated string, and neither', () => {
    expect(normalizeRefs(['a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeRefs(' a , b ')).toEqual(['a', 'b'])
    expect(normalizeRefs('')).toEqual([])
    expect(normalizeRefs(undefined)).toEqual([])
    expect(normalizeRefs(42)).toEqual([])
  })

  it('drops blanks, non-strings and duplicates', () => {
    expect(normalizeRefs(['a', '', 'a', 3, 'b'])).toEqual(['a', 'b'])
  })

  it('resolves a pick to a ref, and an empty slot to null', () => {
    expect(refAt(['a', 'b'], 1)).toBe('b')
    expect(refAt(['a', 'b'], -1)).toBeNull()
    expect(refAt(['a', 'b'], 2)).toBeNull()
  })
})

// Following the Round Loop's phases is what gives rotateLevels() a caller. The
// rule that matters is the negative one: never in the middle of a wave.
describe('rotating with the round', () => {
  it('redraws on the lobby and on intermissions, never inside a wave', () => {
    expect(isRotationPhase(0)).toBe(true)
    expect(isRotationPhase(1)).toBe(false)
    expect(isRotationPhase(2)).toBe(true)
    expect(isRotationPhase(3)).toBe(false)
  })

  it('refuses a phase that is not a phase', () => {
    expect(isRotationPhase(-2)).toBe(false)
    expect(isRotationPhase(Number.NaN)).toBe(false)
    expect(isRotationPhase(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('draws differently every phase and identically for the same one', () => {
    expect(rotationSeed(7, 2)).toBe(rotationSeed(7, 2))
    expect(rotationSeed(7, 2)).not.toBe(rotationSeed(7, 4))
    expect(rotationSeed(7, 2)).not.toBe(rotationSeed(8, 2))
    expect(Number.isInteger(rotationSeed(Number.NaN, Number.NaN))).toBe(true)
  })
})

describe('slot bookkeeping', () => {
  it('clamps the requested slot count to the anchors that exist', () => {
    expect(slotCountFor(3, 1)).toBe(1)
    expect(slotCountFor(1, 3)).toBe(1)
    expect(slotCountFor(0, 3)).toBe(1)
    expect(slotCountFor(2, 0)).toBe(0)
    expect(slotCountFor(Number.NaN, 3)).toBe(1)
  })

  it('reports only the slots whose pick moved, including ones that appeared', () => {
    expect(changedSlots([0, 1], [0, 1])).toEqual([])
    expect(changedSlots([0, 1], [0, 2])).toEqual([1])
    expect(changedSlots([], [0, 1])).toEqual([0, 1])
    expect(changedSlots([0, 1], [0])).toEqual([1])
  })
})
