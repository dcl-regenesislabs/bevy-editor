import { describe, it, expect } from 'vitest'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { rayObb, rayEllipsoid, pickZone } from './zone-pick'
import type { Snapshot } from '../state'

// Zones carry no collider (see zone-pick.ts), so this maths IS the hit test —
// these pin that a ray aimed at a zone hits it under rotation and non-uniform
// scale, misses beside it, and that the nearest zone wins.
const C = Vector3.Zero()
const ID = Quaternion.Identity()
const down = Vector3.create(0, -1, 0)
const fwd = Vector3.create(0, 0, 1)

const snap = (entities: Record<string, unknown>): Snapshot => entities as Snapshot
const origin0 = { '5': { Transform: { position: { x: 0, y: 0, z: 0 } } } }
const zone = (
  pos: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
  mesh = 0
): Record<string, unknown> => ({
  Transform: { position: pos, scale },
  Name: { value: 'zone' },
  TriggerArea: { mesh, collisionMask: 8 }
})

describe('rayObb', () => {
  it('hits an axis-aligned box at the near face', () => {
    const t = rayObb(Vector3.create(0, 10, 0), down, C, ID, Vector3.create(4, 3, 4))
    expect(t).toBeCloseTo(8.5, 6) // top face at y = 1.5
  })

  it('misses beside the box', () => {
    expect(rayObb(Vector3.create(3, 10, 0), down, C, ID, Vector3.create(4, 3, 4))).toBeNull()
  })

  it('respects non-uniform scale: a 10 m wide box catches a ray 4 m off-centre', () => {
    const wide = Vector3.create(10, 1, 1)
    expect(rayObb(Vector3.create(4, 10, 0), down, C, ID, wide)).toBeCloseTo(9.5, 6)
    expect(rayObb(Vector3.create(6, 10, 0), down, C, ID, wide)).toBeNull()
  })

  it('rotation moves the volume with it: 90° about Y swaps the wide axis', () => {
    const wide = Vector3.create(10, 1, 1)
    const yaw = Quaternion.fromEulerDegrees(0, 90, 0)
    expect(rayObb(Vector3.create(4, 10, 0), down, C, yaw, wide)).toBeNull()
    expect(rayObb(Vector3.create(0, 10, 4), down, C, yaw, wide)).toBeCloseTo(9.5, 6)
  })

  it('a 45° box is hit on its corner region but not past it', () => {
    const yaw = Quaternion.fromEulerDegrees(0, 45, 0)
    const box = Vector3.create(2, 2, 2)
    // the rotated square reaches √2 along +x, so 1.3 is inside and 1.5 is out
    expect(rayObb(Vector3.create(1.3, 10, 0), down, C, yaw, box)).not.toBeNull()
    expect(rayObb(Vector3.create(1.5, 10, 0), down, C, yaw, box)).toBeNull()
  })

  it('follows the volume away from the origin', () => {
    const at = Vector3.create(10, 0, -3)
    expect(rayObb(Vector3.create(10, 10, -3), down, at, ID, Vector3.create(2, 2, 2))).toBeCloseTo(9, 6)
    expect(rayObb(Vector3.create(0, 10, 0), down, at, ID, Vector3.create(2, 2, 2))).toBeNull()
  })

  it('misses backwards (the volume is behind the ray)', () => {
    expect(rayObb(Vector3.create(0, 10, 0), Vector3.create(0, 1, 0), C, ID, Vector3.create(4, 4, 4))).toBeNull()
  })

  it('misses from INSIDE, so standing in a zone does not eat every click', () => {
    expect(rayObb(C, down, C, ID, Vector3.create(8, 8, 8))).toBeNull()
  })

  it('a zero-size volume is not pickable', () => {
    expect(rayObb(Vector3.create(0, 10, 0), down, C, ID, Vector3.create(0, 0, 0))).toBeNull()
  })
})

describe('rayEllipsoid', () => {
  it('hits a unit-scaled sphere at radius 0.5', () => {
    const t = rayEllipsoid(Vector3.create(0, 10, 0), down, C, ID, Vector3.One())
    expect(t).toBeCloseTo(9.5, 6)
  })

  it('misses outside the radius where the enclosing box would hit', () => {
    const s = Vector3.create(4, 4, 4)
    expect(rayObb(Vector3.create(1.9, 10, 1.9), down, C, ID, s)).not.toBeNull()
    expect(rayEllipsoid(Vector3.create(1.9, 10, 1.9), down, C, ID, s)).toBeNull()
  })

  it('is an ellipsoid under non-uniform scale', () => {
    const s = Vector3.create(10, 2, 2)
    expect(rayEllipsoid(Vector3.create(4, 10, 0), down, C, ID, s)).not.toBeNull()
    expect(rayEllipsoid(Vector3.create(0, 10, 4), down, C, ID, s)).toBeNull()
  })

  it('misses from inside', () => {
    expect(rayEllipsoid(C, down, C, ID, Vector3.create(8, 8, 8))).toBeNull()
  })
})

describe('pickZone', () => {
  const two = snap({
    ...origin0,
    '512': zone({ x: 0, y: 0, z: 4 }, { x: 2, y: 2, z: 2 }),
    '513': zone({ x: 0, y: 0, z: 12 }, { x: 2, y: 2, z: 2 })
  })

  it('returns the nearest zone along the ray', () => {
    const hit = pickZone(C, fwd, two)
    expect(hit?.id).toBe('512')
    expect(hit?.t).toBeCloseTo(3, 6)
  })

  it('returns the far zone once the near one is out of the way', () => {
    const hit = pickZone(Vector3.create(0, 0, 8), fwd, two)
    expect(hit?.id).toBe('513')
  })

  it('returns null when nothing is under the ray', () => {
    expect(pickZone(Vector3.create(50, 0, 0), fwd, two)).toBeNull()
  })

  it('ignores entities without a TriggerArea', () => {
    const s = snap({ ...origin0, '512': { Transform: { position: { x: 0, y: 0, z: 4 }, scale: { x: 2, y: 2, z: 2 } } } })
    expect(pickZone(C, fwd, s)).toBeNull()
  })

  it('picks a sphere zone by its mesh type, not its bounding box', () => {
    const s = snap({ ...origin0, '512': zone({ x: 0, y: 0, z: 4 }, { x: 4, y: 4, z: 4 }, 1) })
    expect(pickZone(C, fwd, s)?.id).toBe('512')
    // inside the box corner, outside the sphere
    expect(pickZone(Vector3.create(1.9, 1.9, 0), fwd, s)).toBeNull()
  })

  it('composes the parent transform', () => {
    const s = snap({
      ...origin0,
      '512': { Transform: { position: { x: 0, y: 0, z: 20 } } },
      '513': { ...zone({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }), Transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, parent: 512 } }
    })
    expect(pickZone(C, fwd, s)?.t).toBeCloseTo(19, 6)
  })

  it('skips zones the caller rejects', () => {
    expect(pickZone(C, fwd, two, (id) => id !== '512')?.id).toBe('513')
  })

  it('skips reserved entities below 512', () => {
    const s = snap({ ...origin0, '10': zone({ x: 0, y: 0, z: 4 }, { x: 2, y: 2, z: 2 }) })
    expect(pickZone(C, fwd, s)).toBeNull()
  })
})
