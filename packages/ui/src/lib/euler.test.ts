import { describe, it, expect } from 'vitest'
import { eulerToQuat, quatToEuler, type V3 } from './euler'

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps
const expectV3 = (got: V3, want: V3): void => {
  expect(close(got.x, want.x), `x: ${got.x} ≠ ${want.x}`).toBe(true)
  expect(close(got.y, want.y), `y: ${got.y} ≠ ${want.y}`).toBe(true)
  expect(close(got.z, want.z), `z: ${got.z} ≠ ${want.z}`).toBe(true)
}

// Pitch comes out of asin, so it only ever comes back in [-90°, 90°]: a triple
// with |x| > 90 round-trips to a DIFFERENT triple naming the SAME rotation
// (x:-170 → x:-10, y:180, z:180). So outside that band, compare the rotation —
// quaternions, up to sign, since q and -q are the same orientation.
const expectSameRotation = (e: V3): void => {
  const a = eulerToQuat(e)
  const b = eulerToQuat(quatToEuler(a))
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w
  expect(close(Math.abs(dot), 1), `${JSON.stringify(e)} → ${JSON.stringify(quatToEuler(a))}`).toBe(true)
}

describe('euler ↔ quaternion (ZXY)', () => {
  it('identity maps to no rotation', () => {
    expectV3(quatToEuler({ x: 0, y: 0, z: 0, w: 1 }), { x: 0, y: 0, z: 0 })
    const q = eulerToQuat({ x: 0, y: 0, z: 0 })
    expect(close(q.w, 1)).toBe(true)
  })

  it('round-trips each axis on its own, within the representable pitch band', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const deg of [30, 45, -60, 90]) {
        const e = { x: 0, y: 0, z: 0, [axis]: deg } as unknown as V3
        expectV3(quatToEuler(eulerToQuat(e)), e)
      }
    }
  })

  it('round-trips combined rotations', () => {
    for (const e of [
      { x: 20, y: 35, z: -50 },
      { x: -15, y: 120, z: 75 },
      { x: 5, y: -95, z: 10 }
    ]) {
      expectV3(quatToEuler(eulerToQuat(e)), e)
    }
  })

  it('names the same rotation when pitch is outside ±90', () => {
    for (const e of [{ x: -170, y: 0, z: 0 }, { x: 150, y: 20, z: -30 }, { x: 179, y: 90, z: 45 }]) {
      expectSameRotation(e)
    }
  })

  // the axis order IS the contract — a Y-only rotation must not leak into X or Z
  it('keeps rotations on the axis they were authored on', () => {
    const yOnly = quatToEuler(eulerToQuat({ x: 0, y: 90, z: 0 }))
    expect(close(yOnly.y, 90)).toBe(true)
    expect(close(yOnly.x, 0)).toBe(true)
    expect(close(yOnly.z, 0)).toBe(true)
  })

  // asin clamps at the poles rather than returning NaN
  it('survives gimbal lock at pitch ±90', () => {
    const up = quatToEuler(eulerToQuat({ x: 90, y: 0, z: 0 }))
    expect(Number.isNaN(up.x)).toBe(false)
    expect(close(up.x, 90)).toBe(true)
  })

  it('produces unit quaternions', () => {
    for (const e of [{ x: 12, y: -80, z: 43 }, { x: -170, y: 20, z: 5 }]) {
      const q = eulerToQuat(e)
      const len = Math.hypot(q.x, q.y, q.z, q.w)
      expect(close(len, 1)).toBe(true)
    }
  })
})
