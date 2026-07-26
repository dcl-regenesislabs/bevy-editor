import { describe, it, expect } from 'vitest'
import { outOfBoundsEntities } from './out-of-bounds'
import type { Snapshot } from './state'

// computeWorldPositions returns absolute DCL world coordinates (entity 5, the
// WORLD_ORIGIN, carries the scene's base-parcel offset), so parcel (px, py)
// covers x ∈ [px*16, px*16+16] and z ∈ [py*16, py*16+16].
const at = (x: number, z: number): Record<string, unknown> => ({
  Transform: { position: { x, y: 0, z } }
})
// origin at zero → world position == the authored local position
const scene = (entities: Record<string, unknown>): Snapshot =>
  ({ '5': at(0, 0), ...entities }) as Snapshot

const ONE_PARCEL = [{ x: 0, y: 0 }]

describe('outOfBoundsEntities', () => {
  it('accepts an entity inside the parcel', () => {
    expect(outOfBoundsEntities(scene({ '512': at(8, 8) }), ONE_PARCEL).has('512')).toBe(false)
  })

  it('flags one past the far edge', () => {
    expect(outOfBoundsEntities(scene({ '512': at(30, 8) }), ONE_PARCEL).has('512')).toBe(true)
  })

  it('flags one behind the origin', () => {
    expect(outOfBoundsEntities(scene({ '512': at(-8, 8) }), ONE_PARCEL).has('512')).toBe(true)
  })

  // the engine still renders geometry within ~2m of the edge, so warning there
  // would cry wolf on anything deliberately placed flush against the boundary
  it('tolerates the engine’s out-of-bounds margin', () => {
    expect(outOfBoundsEntities(scene({ '512': at(17, 8) }), ONE_PARCEL).has('512')).toBe(false)
    expect(outOfBoundsEntities(scene({ '512': at(19, 8) }), ONE_PARCEL).has('512')).toBe(true)
  })

  it('accepts anywhere across a multi-parcel layout', () => {
    const parcels = [
      { x: 0, y: 0 },
      { x: 1, y: 0 }
    ]
    const oob = outOfBoundsEntities(scene({ '512': at(24, 8), '513': at(40, 8) }), parcels)
    expect(oob.has('512')).toBe(false) // second parcel
    expect(oob.has('513')).toBe(true) // past both
  })

  it('claims nothing when the layout or the world frame is unknown', () => {
    expect(outOfBoundsEntities(scene({ '512': at(999, 999) }), undefined).size).toBe(0)
    expect(outOfBoundsEntities(scene({ '512': at(999, 999) }), []).size).toBe(0)
    // no entity 5 → no world frame to resolve against
    expect(outOfBoundsEntities({ '512': at(999, 999) } as Snapshot, ONE_PARCEL).size).toBe(0)
  })
})
