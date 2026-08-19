import { describe, expect, it } from 'vitest'
import { dragOffset, endPoseFor } from './record-math'

// The record state's whole contract is that sliding the entity to endPoseFor
// and reading dragOffset back returns the offset that produced the pose — for
// any local rotation and scale, since the param lives in the entity's frame.

const HALF = Math.SQRT1_2

describe('record-in-place offset math', () => {
  it('round-trips an offset through an unrotated entity', () => {
    const before = { position: { x: 4, y: 1, z: 4 } }
    const end = endPoseFor(before, { x: 0, y: 2, z: 8 })
    expect(end).toEqual({ x: 4, y: 3, z: 12 })
    expect(dragOffset(before, end)).toEqual({ x: 0, y: 2, z: 8 })
  })

  it('round-trips through a rotated entity, in its own frame', () => {
    const before = {
      position: { x: 10, y: 0, z: 10 },
      rotation: { x: 0, y: HALF, z: 0, w: HALF }
    }
    const end = endPoseFor(before, { x: 0, y: 0, z: 8 })
    expect(end.x).toBeCloseTo(18, 5)
    expect(end.z).toBeCloseTo(10, 5)
    const back = dragOffset(before, end)
    expect(back.x).toBeCloseTo(0, 3)
    expect(back.z).toBeCloseTo(8, 3)
  })

  it('ignores the entity scale — metres are metres however the model is sized', () => {
    const before = { position: { x: 0, y: 0, z: 0 }, scale: { x: 0.125, y: 0.125, z: 0.125 } }
    const end = endPoseFor(before, { x: 0, y: 0, z: 8 })
    expect(end.z).toBeCloseTo(8, 5)
    expect(dragOffset(before, end).z).toBeCloseTo(8, 5)
  })

  it('reads a freehand drag back as the entity-frame offset', () => {
    const before = {
      position: { x: 5, y: 0, z: 5 },
      rotation: { x: 0, y: 1, z: 0, w: 0 }
    }
    const offset = dragOffset(before, { x: 5, y: 0, z: -3 })
    expect(offset.z).toBeCloseTo(8, 3)
    expect(offset.x).toBeCloseTo(0, 3)
  })

  it('survives a zero scale', () => {
    const before = { position: { x: 0, y: 0, z: 0 }, scale: { x: 0, y: 0, z: 0 } }
    expect(dragOffset(before, { x: 1, y: 1, z: 1 })).toEqual({ x: 1, y: 1, z: 1 })
  })
})
