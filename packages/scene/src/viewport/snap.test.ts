import { describe, it, expect } from 'vitest'
import { snapNumber, snapVector, snapFactor, SNAP_POSITION, SNAP_SCALE } from './snap'

describe('snapNumber', () => {
  it('rounds to the nearest step', () => {
    expect(snapNumber(0.6, SNAP_POSITION)).toBe(0.5)
    expect(snapNumber(0.8, SNAP_POSITION)).toBe(1)
    expect(snapNumber(-0.6, SNAP_POSITION)).toBe(-0.5)
  })

  it('leaves the value alone when snapping is off (step 0)', () => {
    expect(snapNumber(0.6123, 0)).toBe(0.6123)
    expect(snapNumber(0.6123, -1)).toBe(0.6123)
  })

  it('rounds 15° rotation steps', () => {
    expect(snapNumber(7, 15)).toBe(0)
    expect(snapNumber(8, 15)).toBe(15)
    expect(snapNumber(-100, 15)).toBe(-105)
  })
})

describe('snapVector', () => {
  it('snaps each axis independently', () => {
    expect(snapVector({ x: 0.6, y: -0.2, z: 1.3 }, SNAP_POSITION)).toEqual({ x: 0.5, y: -0, z: 1.5 })
  })
})

describe('snapFactor', () => {
  it('rounds the multiplier', () => {
    expect(snapFactor(1.04)).toBeCloseTo(1)
    expect(snapFactor(1.16)).toBeCloseTo(1.2)
  })

  // multiplying by 0 is a one-way door: the entity's scale could never grow back
  it('never returns zero or a negative factor', () => {
    expect(snapFactor(0.01)).toBe(SNAP_SCALE)
    expect(snapFactor(-5)).toBe(SNAP_SCALE)
  })
})

// The point of snapping the delta rather than the result: a group keeps its
// internal spacing, which per-entity snapping would destroy.
describe('delta snapping preserves relative layout', () => {
  it('moves every entity by the same rounded amount', () => {
    const starts = [0, 1.3, 7.85]
    const delta = snapNumber(0.63, SNAP_POSITION) // 0.5
    const moved = starts.map((s) => s + delta)
    expect(moved).toEqual([0.5, 1.8, 8.35])
    // spacing is unchanged
    expect(moved[1] - moved[0]).toBeCloseTo(starts[1] - starts[0])
    expect(moved[2] - moved[1]).toBeCloseTo(starts[2] - starts[1])
  })
})
