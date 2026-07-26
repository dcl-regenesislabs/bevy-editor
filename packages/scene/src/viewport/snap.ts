// Grid snapping for gizmo drags.
//
// Quantisation is applied to the DRAG DELTA, never to the resulting value: with a
// multi-selection the entities start at different places, so snapping each one's
// final position would pull them onto the grid individually and destroy their
// relative spacing. Snapping the shared delta moves them all by the same rounded
// amount, which is what "drag this group by half a metre" should mean.
import { Vector3 } from '@dcl/sdk/math'

// Steps chosen against a 16m parcel: 0.5m divides it evenly, 15° gives the eight
// principal headings plus halves, 0.1 is a readable scale increment.
export const SNAP_POSITION = 0.5
export const SNAP_ROTATION_DEG = 15
export const SNAP_SCALE = 0.1

export function snapNumber(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

export function snapVector(v: Vector3, step: number): Vector3 {
  return { x: snapNumber(v.x, step), y: snapNumber(v.y, step), z: snapNumber(v.z, step) }
}

// The delta that puts `from + delta` on the grid, along the axes the drag is
// actually moving. Snapping the delta alone keeps an object at 3.73 landing on
// 4.23, 4.73 … — quantised, but never a round number, which reads as "snapping
// isn't working" when you watch the inspector. Snapping the RESULT is what a
// creator means by snap; returning it as a delta keeps a multi-selection rigid,
// since every entity then moves by the same amount as the one under the gizmo.
export function snapDeltaToGrid(from: Vector3, delta: Vector3, step: number): Vector3 {
  const axis = (f: number, d: number): number =>
    // an axis the drag doesn't touch must stay untouched — snapping it would
    // shift the object sideways off a constrained drag
    d === 0 ? 0 : snapNumber(f + d, step) - f
  return { x: axis(from.x, delta.x), y: axis(from.y, delta.y), z: axis(from.z, delta.z) }
}

// A scale drag is expressed as a multiplier, so it snaps in multiplier steps —
// and is clamped away from zero, since a factor of 0 would flatten the entity
// irrecoverably (its scale can never grow back from 0 by multiplying).
export function snapFactor(factor: number, step = SNAP_SCALE): number {
  return Math.max(step, snapNumber(factor, step))
}
