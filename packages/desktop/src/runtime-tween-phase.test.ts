import { describe, expect, it } from 'vitest'
import {
  clampSeek,
  pathLegs,
  cycleMsOfLegs,
  easeQuadInOut,
  easedAt,
  legPhaseAt,
  progressForEased,
  shuttleLegs
} from '../runtime-modules/pure/tweenPhase'

// The whole point of this module is that two peers reading the same clock get
// the same answer, and that no answer can move a deck far enough in one frame
// for the engine to stop carrying its riders.

describe('shuttleLegs', () => {
  it('is out, wait, back, wait', () => {
    expect(shuttleLegs(4000, 1000)).toEqual([
      { durationMs: 4000, moving: true, from: 0, to: 1 },
      { durationMs: 1000, moving: false, from: 1, to: 1 },
      { durationMs: 4000, moving: true, from: 1, to: 0 },
      { durationMs: 1000, moving: false, from: 0, to: 0 }
    ])
  })

  it('drops the waits entirely when there is no dwell', () => {
    const legs = shuttleLegs(4000, 0)
    expect(legs).toHaveLength(2)
    expect(legs.every((leg) => leg.moving)).toBe(true)
  })

  it('never produces a zero-length trip', () => {
    expect(shuttleLegs(0, 0)[0].durationMs).toBe(1)
    expect(shuttleLegs(-5, -5)[0].durationMs).toBe(1)
  })
})

describe('legPhaseAt', () => {
  const legs = shuttleLegs(4000, 1000)
  const cycle = cycleMsOfLegs(legs)

  it('measures a 10s cycle', () => {
    expect(cycle).toBe(10_000)
  })

  it('is anchored to the epoch, so the same clock gives the same phase', () => {
    // Two peers, same server time, arbitrary absolute instant.
    const now = 1_786_920_451_224
    expect(legPhaseAt(legs, now)).toEqual(legPhaseAt(legs, now))
    // And a peer that joins a full cycle later sees the identical phase.
    expect(legPhaseAt(legs, now)?.progress).toBeCloseTo(legPhaseAt(legs, now + cycle)!.progress, 10)
    expect(legPhaseAt(legs, now)?.index).toBe(legPhaseAt(legs, now + cycle)?.index)
  })

  it('walks the cycle', () => {
    expect(legPhaseAt(legs, 0)).toMatchObject({ index: 0, progress: 0 })
    expect(legPhaseAt(legs, 2000)).toMatchObject({ index: 0, progress: 0.5 })
    expect(legPhaseAt(legs, 4500)).toMatchObject({ index: 1, progress: 0.5 })
    expect(legPhaseAt(legs, 7000)).toMatchObject({ index: 2, progress: 0.5 })
    expect(legPhaseAt(legs, 9500)).toMatchObject({ index: 3, progress: 0.5 })
  })

  it('reports the leg start so a caller can tell one leg from the next', () => {
    expect(legPhaseAt(legs, 2000)?.startedAtMs).toBe(0)
    expect(legPhaseAt(legs, 7000)?.startedAtMs).toBe(5000)
    expect(legPhaseAt(legs, 12_000)?.startedAtMs).toBe(10_000)
  })

  it('stays in phase for a client whose clock sits behind the epoch', () => {
    // -2000 lands 8000ms into the cycle: the return trip, three quarters through.
    expect(legPhaseAt(legs, -2000)).toMatchObject({ index: 2, progress: 0.75 })
    expect(legPhaseAt(legs, -10_000)).toMatchObject({ index: 0, progress: 0 })
  })

  it('refuses a table it cannot describe rather than guessing', () => {
    expect(legPhaseAt([], 1000)).toBeNull()
    expect(legPhaseAt([{ durationMs: 0, moving: true, from: 0, to: 1 }], 1000)).toBeNull()
    expect(legPhaseAt(legs, Number.NaN)).toBeNull()
  })

  it('skips zero-length legs instead of parking on them', () => {
    const withEmpty = [
      { durationMs: 0, moving: false, from: 0, to: 0 },
      { durationMs: 1000, moving: true, from: 0, to: 1 }
    ]
    expect(legPhaseAt(withEmpty, 500)).toMatchObject({ index: 1, progress: 0.5 })
  })
})

describe('easing', () => {
  it('matches the engine at the ends and the midpoint', () => {
    expect(easeQuadInOut(0)).toBe(0)
    expect(easeQuadInOut(0.5)).toBe(0.5)
    expect(easeQuadInOut(1)).toBe(1)
  })

  it('is monotonic, which is what makes the inverse safe', () => {
    let previous = -1
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const value = easeQuadInOut(t)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('inverts', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(progressForEased(easedAt(t, 'smooth'), 'smooth')).toBeCloseTo(t, 5)
      expect(progressForEased(easedAt(t, 'linear'), 'linear')).toBeCloseTo(t, 5)
    }
  })
})

describe('clampSeek', () => {
  // The engine carries a rider only while the deck moves under 5 units in one
  // frame; past that it skips the carry and leaves them in the air.
  it('passes a correction that is small enough through untouched', () => {
    // 0.02 of a 100-unit path is 2 units — inside the cap, so it lands exactly.
    expect(clampSeek(0.5, 0.52, 100, 4, 'linear')).toBeCloseTo(0.52, 6)
  })

  it('caps a correction that would outrun the carry', () => {
    const capped = clampSeek(0, 1, 100, 4, 'linear')
    expect(capped).toBeCloseTo(0.04, 6)
    expect(Math.abs(capped - 0) * 100).toBeLessThanOrEqual(4)
  })

  it('caps backwards corrections too', () => {
    expect(clampSeek(1, 0, 100, 4, 'linear')).toBeCloseTo(0.96, 6)
  })

  it('measures the cap on the eased path, not on raw progress', () => {
    // Mid-leg, the smooth curve moves ~2x faster than progress suggests, so an
    // eased-blind clamp would let through roughly double the real displacement.
    const capped = clampSeek(0.5, 1, 100, 4, 'smooth')
    const travelled = Math.abs(easedAt(capped, 'smooth') - easedAt(0.5, 'smooth')) * 100
    expect(travelled).toBeLessThanOrEqual(4.0001)
    expect(capped).toBeLessThan(0.54)
  })

  it('never reports a jump for a path with no length', () => {
    expect(clampSeek(0, 1, 0, 4, 'linear')).toBe(1)
  })
})

describe('pathLegs', () => {
  it('generalizes the shuttle: two stops back and forth is the classic cycle', () => {
    expect(pathLegs(2, 4000, 1000, 'back and forth')).toEqual(shuttleLegs(4000, 1000))
  })

  it('back and forth over three stops visits 0→1→2→1→0 with waits', () => {
    const legs = pathLegs(3, 1000, 500, 'back and forth')
    expect(legs.map((l) => (l.moving ? `${l.from}>${l.to}` : `@${l.to}`))).toEqual([
      '0>1', '@1', '1>2', '@2', '2>1', '@1', '1>0', '@0'
    ])
  })

  it('around closes the loop through the first stop', () => {
    const legs = pathLegs(3, 1000, 0, 'around')
    expect(legs.map((l) => `${l.from}>${l.to}`)).toEqual(['0>1', '1>2', '2>0'])
  })

  it('once ends at the last stop with no return legs', () => {
    const legs = pathLegs(3, 1000, 500, 'once')
    expect(legs.map((l) => (l.moving ? `${l.from}>${l.to}` : `@${l.to}`))).toEqual(['0>1', '@1', '1>2'])
  })
})

describe('legPhaseAt, non-cyclic (a called platform)', () => {
  const legs = pathLegs(2, 4000, 0, 'once')

  it('rests at the start before the anchor', () => {
    expect(legPhaseAt(legs, 900, 1000, { cyclic: false })).toMatchObject({ index: 0, progress: 0 })
  })

  it('plays the single run from the anchor', () => {
    expect(legPhaseAt(legs, 3000, 1000, { cyclic: false })).toMatchObject({ index: 0, progress: 0.5 })
  })

  it('parks at the end forever after', () => {
    expect(legPhaseAt(legs, 99_000, 1000, { cyclic: false })).toMatchObject({ index: 0, progress: 1 })
    expect(legPhaseAt(legs, 99_000_000, 1000, { cyclic: false })).toMatchObject({ progress: 1 })
  })

  it('a late joiner derives the same parked pose from the same fact', () => {
    const early = legPhaseAt(legs, 10_000, 1000, { cyclic: false })
    const late = legPhaseAt(legs, 9_999_999, 1000, { cyclic: false })
    expect(early?.index).toBe(late?.index)
    expect(early?.progress).toBe(late?.progress)
  })
})
