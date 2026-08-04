import { describe, it, expect } from 'vitest'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { pointInObb, pointInEllipsoid, zonesContaining, zoneLabel } from './zone-inside'
import { NAME_COMPONENT } from '../custom-components'
import type { Snapshot } from '../state'

// The HUD chip's containment is derived, not reported by the engine (see
// zone-inside.ts), so this maths IS the answer the creator reads while walking
// into a zone. These pin it under rotation and non-uniform scale.
const C = Vector3.Zero()
const ID = Quaternion.Identity()

const snap = (entities: Record<string, unknown>): Snapshot => entities as Snapshot
const origin0 = { '5': { Transform: { position: { x: 0, y: 0, z: 0 } } } }
const zone = (
  name: string,
  pos: { x: number; y: number; z: number },
  scale: { x: number; y: number; z: number },
  mesh = 0
): Record<string, unknown> => ({
  Transform: { position: pos, scale },
  [NAME_COMPONENT]: { value: name },
  TriggerArea: { mesh, collisionMask: 8 }
})

describe('pointInObb', () => {
  it('contains the centre and rejects a point past a face', () => {
    const box = Vector3.create(4, 3, 4)
    expect(pointInObb(C, C, ID, box)).toBe(true)
    expect(pointInObb(Vector3.create(1.9, 0, 0), C, ID, box)).toBe(true)
    expect(pointInObb(Vector3.create(2.1, 0, 0), C, ID, box)).toBe(false)
    expect(pointInObb(Vector3.create(0, 1.6, 0), C, ID, box)).toBe(false)
  })

  it('respects non-uniform scale on each axis independently', () => {
    const wide = Vector3.create(10, 1, 1)
    expect(pointInObb(Vector3.create(4.9, 0, 0), C, ID, wide)).toBe(true)
    expect(pointInObb(Vector3.create(0, 0, 0.6), C, ID, wide)).toBe(false)
  })

  it('rotation carries the volume with it: 90° about Y swaps the wide axis', () => {
    const wide = Vector3.create(10, 1, 1)
    const yaw = Quaternion.fromEulerDegrees(0, 90, 0)
    expect(pointInObb(Vector3.create(4, 0, 0), C, yaw, wide)).toBe(false)
    expect(pointInObb(Vector3.create(0, 0, 4), C, yaw, wide)).toBe(true)
  })

  it('a 45° box reaches √2 along its diagonal and no further', () => {
    const yaw = Quaternion.fromEulerDegrees(0, 45, 0)
    const box = Vector3.create(2, 2, 2)
    expect(pointInObb(Vector3.create(1.3, 0, 0), C, yaw, box)).toBe(true)
    expect(pointInObb(Vector3.create(1.5, 0, 0), C, yaw, box)).toBe(false)
  })

  it('negative scale mirrors the volume, leaving the same shape', () => {
    expect(pointInObb(Vector3.create(1.9, 0, 0), C, ID, Vector3.create(-4, 3, 4))).toBe(true)
    expect(pointInObb(Vector3.create(2.1, 0, 0), C, ID, Vector3.create(-4, 3, 4))).toBe(false)
  })

  it('a flattened volume has no inside', () => {
    expect(pointInObb(C, C, ID, Vector3.create(4, 0, 4))).toBe(false)
  })

  it('follows the volume away from the origin', () => {
    const at = Vector3.create(10, 0, -3)
    const box = Vector3.create(2, 2, 2)
    expect(pointInObb(Vector3.create(10, 0, -3), at, ID, box)).toBe(true)
    expect(pointInObb(C, at, ID, box)).toBe(false)
  })
})

describe('pointInEllipsoid', () => {
  it('is a true ellipsoid under non-uniform scale, not a bounding box', () => {
    const s = Vector3.create(10, 2, 2)
    expect(pointInEllipsoid(Vector3.create(4.9, 0, 0), C, ID, s)).toBe(true)
    // inside the box corner (x<5, y<1) but outside the ellipsoid
    expect(pointInEllipsoid(Vector3.create(4.9, 0.9, 0), C, ID, s)).toBe(false)
  })

  it('rotates with the entity', () => {
    const s = Vector3.create(10, 2, 2)
    const yaw = Quaternion.fromEulerDegrees(0, 90, 0)
    expect(pointInEllipsoid(Vector3.create(4, 0, 0), C, yaw, s)).toBe(false)
    expect(pointInEllipsoid(Vector3.create(0, 0, 4), C, yaw, s)).toBe(true)
  })
})

describe('zonesContaining', () => {
  it('names the zone the avatar is standing in, and nothing else', () => {
    const s = snap({
      ...origin0,
      '512': zone('Front Hall', { x: 0, y: 1.5, z: 0 }, { x: 4, y: 3, z: 4 }),
      '513': zone('Arena', { x: 40, y: 1.5, z: 0 }, { x: 4, y: 3, z: 4 })
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual(['Front Hall'])
    expect(zonesContaining(s, Vector3.create(3, 0, 0))).toEqual([])
  })

  it('reports every overlapping zone', () => {
    const s = snap({
      ...origin0,
      '512': zone('Front Hall', { x: 0, y: 1.5, z: 0 }, { x: 8, y: 3, z: 8 }),
      '513': zone('Doorway', { x: 1, y: 1.5, z: 0 }, { x: 4, y: 3, z: 4 })
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual(['Front Hall', 'Doorway'])
  })

  it('names a zone once when two share it, the way zoneBus matches ids', () => {
    const s = snap({
      ...origin0,
      '512': zone('Front Hall', { x: 0, y: 1.5, z: 0 }, { x: 8, y: 3, z: 8 }),
      '513': zone(' front hall ', { x: 0, y: 1.5, z: 0 }, { x: 4, y: 3, z: 4 })
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual(['Front Hall'])
  })

  it('catches a zone the feet miss but the body is in', () => {
    const s = snap({
      ...origin0,
      // a waist-high band from y = 1 to y = 2: feet at 0 are below it
      '512': zone('Beam', { x: 0, y: 1.5, z: 0 }, { x: 4, y: 1, z: 4 })
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual(['Beam'])
    expect(zonesContaining(s, Vector3.create(0, 3, 0))).toEqual([])
  })

  it('follows a sphere zone and a rotated one', () => {
    const s = snap({
      ...origin0,
      '512': zone('Bubble', { x: 0, y: 1, z: 0 }, { x: 4, y: 4, z: 4 }, 1),
      '513': zone('Ramp', { x: 20, y: 1, z: 0 }, { x: 10, y: 1, z: 1 })
    })
    expect(zonesContaining(s, Vector3.create(1.5, 0, 0))).toEqual(['Bubble'])
    const yawed = snap({
      ...origin0,
      '513': {
        Transform: {
          position: { x: 20, y: 1, z: 0 },
          rotation: Quaternion.fromEulerDegrees(0, 90, 0),
          scale: { x: 10, y: 2, z: 1 }
        },
        [NAME_COMPONENT]: { value: 'Ramp' },
        TriggerArea: { mesh: 0, collisionMask: 8 }
      }
    })
    expect(zonesContaining(yawed, Vector3.create(24, 0, 0))).toEqual([])
    expect(zonesContaining(yawed, Vector3.create(20, 0, 4))).toEqual(['Ramp'])
  })

  it('skips reserved entities and entities without a TriggerArea', () => {
    const s = snap({
      ...origin0,
      '5': { Transform: { position: { x: 0, y: 0, z: 0 } }, TriggerArea: { mesh: 0 } },
      '512': { Transform: { position: { x: 0, y: 1, z: 0 } }, [NAME_COMPONENT]: { value: 'Plain' } }
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual([])
  })

  it('is empty when the world origin is missing (no frame to resolve)', () => {
    const s = snap({ '512': zone('Front Hall', { x: 0, y: 1.5, z: 0 }, { x: 4, y: 3, z: 4 }) })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual([])
  })

  it('resolves against the world origin, not raw scene-local coordinates', () => {
    const s = snap({
      '5': { Transform: { position: { x: 16, y: 0, z: 16 } } },
      '512': zone('Front Hall', { x: 16, y: 1.5, z: 16 }, { x: 4, y: 3, z: 4 })
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual(['Front Hall'])
    expect(zonesContaining(s, Vector3.create(16, 0, 16))).toEqual([])
  })

  it('falls back to the entity id when a zone has no name', () => {
    const s = snap({
      ...origin0,
      '512': { Transform: { position: { x: 0, y: 1.5, z: 0 }, scale: { x: 4, y: 3, z: 4 } }, TriggerArea: { mesh: 0 } }
    })
    expect(zonesContaining(s, Vector3.create(0, 0, 0))).toEqual(['Entity 512'])
    expect(zoneLabel(s, '512')).toBe('Entity 512')
  })
})
