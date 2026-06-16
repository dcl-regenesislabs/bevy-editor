import { describe, it, expect } from 'vitest'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import {
  computeWorldPositions,
  worldTransformOf,
  worldToLocalPosition,
  rootLocalForWorld
} from './world-pos'
import type { Snapshot } from './state'

// Entity 5 is the reserved WORLD_ORIGIN; world position = composed-local − origin5.
const snap = (entities: Record<string, unknown>): Snapshot => entities as Snapshot
const origin0 = { '5': { Transform: { position: { x: 0, y: 0, z: 0 } } } }

describe('computeWorldPositions', () => {
  it('returns null when entity 5 (world origin) is absent', () => {
    expect(computeWorldPositions(snap({ '512': { Transform: { position: { x: 1, y: 0, z: 0 } } } }))).toBeNull()
  })

  it('places a root entity at its local position when origin is at zero', () => {
    const w = computeWorldPositions(snap({ ...origin0, '512': { Transform: { position: { x: 1, y: 2, z: 3 } }, Name: { value: 'a' } } }))
    expect(w?.get('512')).toEqual(Vector3.create(1, 2, 3))
  })

  it('subtracts a non-zero world origin', () => {
    const w = computeWorldPositions(snap({ '5': { Transform: { position: { x: 10, y: 0, z: 0 } } }, '512': { Transform: { position: { x: 12, y: 0, z: 0 } } } }))
    expect(w?.get('512')).toEqual(Vector3.create(2, 0, 0))
  })

  it('composes a child through its parent translation', () => {
    const w = computeWorldPositions(snap({
      ...origin0,
      '512': { Transform: { position: { x: 5, y: 0, z: 0 } } },
      '513': { Transform: { position: { x: 1, y: 0, z: 0 }, parent: 512 } }
    }))
    expect(w?.get('513')).toEqual(Vector3.create(6, 0, 0))
  })

  it('does not hang on a parent cycle (guarded), returning a finite result', () => {
    const w = computeWorldPositions(snap({
      ...origin0,
      '512': { Transform: { position: { x: 1, y: 0, z: 0 }, parent: 513 } },
      '513': { Transform: { position: { x: 1, y: 0, z: 0 }, parent: 512 } }
    }))
    expect(w).not.toBeNull()
    for (const v of w!.values()) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true)
    }
  })
})

describe('world <-> local round trip', () => {
  it('worldToLocalPosition inverts worldTransformOf for a parented entity', () => {
    const s = snap({
      '5': { Transform: { position: { x: 2, y: 0, z: 0 } } },
      '512': { Transform: { position: { x: 5, y: 1, z: 0 } } },
      '513': { Transform: { position: { x: 3, y: 0, z: 0 }, parent: 512 } }
    })
    const world = worldTransformOf(s, '513')
    expect(world).not.toBeNull()
    const local = worldToLocalPosition(s, '513', world!.position)
    // round trips back to the stored local position
    expect(local!.x).toBeCloseTo(3)
    expect(local!.y).toBeCloseTo(0)
    expect(local!.z).toBeCloseTo(0)
  })

  it('rootLocalForWorld is the parent-0 inverse: local = world + origin', () => {
    const s = snap({ '5': { Transform: { position: { x: 10, y: 0, z: -5 } } } })
    expect(rootLocalForWorld(s, Vector3.create(0, 0, 0))).toEqual({ x: 10, y: 0, z: -5 })
    expect(rootLocalForWorld(s, Vector3.create(4, 1, 4))).toEqual({ x: 14, y: 1, z: -1 })
  })

  it('rootLocalForWorld returns null without a world origin', () => {
    expect(rootLocalForWorld(snap({}), Vector3.create(0, 0, 0))).toBeNull()
  })
})

describe('worldTransformOf rotation', () => {
  it('composes parent rotation into the child world rotation', () => {
    const q = Quaternion.fromEulerDegrees(0, 90, 0)
    const s = snap({
      ...origin0,
      '512': { Transform: { position: { x: 0, y: 0, z: 0 }, rotation: q } },
      '513': { Transform: { position: { x: 0, y: 0, z: 0 }, parent: 512 } }
    })
    const wt = worldTransformOf(s, '513')
    expect(wt).not.toBeNull()
    // child has identity local rotation, so world rotation == parent's
    expect(wt!.rotation.y).toBeCloseTo(q.y)
    expect(wt!.rotation.w).toBeCloseTo(q.w)
  })
})
