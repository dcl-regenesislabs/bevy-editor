import { describe, it, expect } from 'vitest'
import { Vector3 } from '@dcl/sdk/math'
import { pickHandleKind, type HandleKind, type PickConfig, type Ray } from './gizmo-pick'

// Mirrors gizmo.ts's PICK_CFG (SHAFT_LENGTH 1.0 + TIP_LENGTH 0.26, PLANE_OFFSET
// 0.42, RING_RADIUS 0.92, CUBE_SIZE 0.16). These tests pin the property that
// regressed: aiming AT a handle hits it (and aiming beside it does not).
const CFG: PickConfig = {
  armLength: 1.26,
  planeOffset: 0.42,
  ringRadius: 0.92,
  axisTol: 0.34,
  planeHalf: 0.22 * 1.15,
  ringTol: 0.16,
  centerTol: 0.16 * 1.7
}

const C = Vector3.create(0, 0, 0)
const ray = (origin: Vector3, dir: Vector3): Ray => ({ origin, dir })

const TRANSLATE: HandleKind[] = [
  { op: 'translate-axis', axis: 'x' }, // 0
  { op: 'translate-axis', axis: 'y' }, // 1
  { op: 'translate-axis', axis: 'z' }, // 2
  { op: 'translate-plane', normal: 'x' }, // 3
  { op: 'translate-plane', normal: 'y' }, // 4
  { op: 'translate-plane', normal: 'z' } // 5
]
const ROTATE: HandleKind[] = [
  { op: 'rotate', axis: 'x' },
  { op: 'rotate', axis: 'y' },
  { op: 'rotate', axis: 'z' }
]
const SCALE: HandleKind[] = [
  { op: 'scale-axis', axis: 'x' }, // 0
  { op: 'scale-axis', axis: 'y' }, // 1
  { op: 'scale-axis', axis: 'z' }, // 2
  { op: 'scale-uniform' } // 3
]

describe('pickHandleKind — translate', () => {
  it('aiming down ONTO the X arm hits the X axis handle', () => {
    // ray straight down through (0.6, 0, 0), which sits on the X arm
    const i = pickHandleKind(TRANSLATE, C, 1, ray(Vector3.create(0.6, 5, 0), Vector3.create(0, -1, 0)), CFG)
    expect(TRANSLATE[i]).toEqual({ op: 'translate-axis', axis: 'x' })
  })

  it('aiming just BESIDE the arm (1m off in z) hits nothing', () => {
    const i = pickHandleKind(TRANSLATE, C, 1, ray(Vector3.create(0.6, 5, 1), Vector3.create(0, -1, 0)), CFG)
    expect(i).toBe(-1)
  })

  it('aiming at the XY plane square hits the plane handle (normal z)', () => {
    const i = pickHandleKind(TRANSLATE, C, 1, ray(Vector3.create(0.42, 0.42, 5), Vector3.create(0, 0, -1)), CFG)
    expect(TRANSLATE[i]).toEqual({ op: 'translate-plane', normal: 'z' })
  })

  it('where a plane square overlaps the axis behind it, the PLANE wins (priority)', () => {
    // (0.3, 0.2, 0) is inside the z-plane square AND within the X arm tolerance
    const i = pickHandleKind(TRANSLATE, C, 1, ray(Vector3.create(0.3, 0.2, 5), Vector3.create(0, 0, -1)), CFG)
    expect(TRANSLATE[i]).toEqual({ op: 'translate-plane', normal: 'z' })
  })

  it('works away from the origin (center offset)', () => {
    const off = Vector3.create(10, 5, -3)
    const onArm = Vector3.create(10.6, 10, -3) // above the X arm at the offset center
    const i = pickHandleKind(TRANSLATE, off, 1, ray(onArm, Vector3.create(0, -1, 0)), CFG)
    expect(TRANSLATE[i]).toEqual({ op: 'translate-axis', axis: 'x' })
  })

  it('scales the grab area with the gizmo scale', () => {
    // at scale 2 the X arm reaches to x=2.52; a point at x=2 is still on it
    const i = pickHandleKind(TRANSLATE, C, 2, ray(Vector3.create(2, 5, 0), Vector3.create(0, -1, 0)), CFG)
    expect(TRANSLATE[i]).toEqual({ op: 'translate-axis', axis: 'x' })
  })
})

describe('pickHandleKind — rotate', () => {
  it('aiming at the X ring circumference hits the X ring', () => {
    const i = pickHandleKind(ROTATE, C, 1, ray(Vector3.create(5, 0.92, 0), Vector3.create(-1, 0, 0)), CFG)
    expect(ROTATE[i]).toEqual({ op: 'rotate', axis: 'x' })
  })

  it('aiming at the center (inside all rings) hits nothing', () => {
    const i = pickHandleKind(ROTATE, C, 1, ray(Vector3.create(5, 0, 0), Vector3.create(-1, 0, 0)), CFG)
    expect(i).toBe(-1)
  })
})

describe('pickHandleKind — scale', () => {
  it('aiming at the center hits the uniform-scale handle', () => {
    const i = pickHandleKind(SCALE, C, 1, ray(Vector3.create(0, 5, 0), Vector3.create(0, -1, 0)), CFG)
    expect(SCALE[i]).toEqual({ op: 'scale-uniform' })
  })

  it('aiming along the X stalk (away from center) hits the X scale handle', () => {
    const i = pickHandleKind(SCALE, C, 1, ray(Vector3.create(0.6, 5, 0), Vector3.create(0, -1, 0)), CFG)
    expect(SCALE[i]).toEqual({ op: 'scale-axis', axis: 'x' })
  })
})
