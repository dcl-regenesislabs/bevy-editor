// The record-in-place gesture's frame math, import-clean so it tests without
// the engine bus. A `position` param is METRES in the entity's oriented frame —
// scale sizes the model, never the trip — so entering the state rotates the
// offset into a parent-frame pose (endPoseFor) and Done un-rotates the dragged
// pose back (dragOffset). A translate drag changes neither rotation nor scale,
// so both use the ORIGINAL transform and the pair round-trips exactly.
import type { PositionValue } from '../script/parser'

export interface Vec3 {
  x: number
  y: number
  z: number
}
export interface Quat {
  x: number
  y: number
  z: number
  w: number
}
export interface TransformValue {
  position?: Vec3
  rotation?: Quat
  scale?: Vec3
  parent?: number
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 }
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 }

function rotate(v: Vec3, q: Quat): Vec3 {
  const { x, y, z } = v
  const ix = q.w * x + q.y * z - q.z * y
  const iy = q.w * y + q.z * x - q.x * z
  const iz = q.w * z + q.x * y - q.y * x
  const iw = -q.x * x - q.y * y - q.z * z
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  }
}

function invert(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function endPoseFor(before: TransformValue, offset: PositionValue): Vec3 {
  const pos = before.position ?? ZERO
  const rot = before.rotation ?? IDENTITY
  const step = rotate({ ...offset }, rot)
  return { x: pos.x + step.x, y: pos.y + step.y, z: pos.z + step.z }
}

export function dragOffset(before: TransformValue, currentPos: Vec3): PositionValue {
  const orig = before.position ?? ZERO
  const rot = before.rotation ?? IDENTITY
  const deltaParent = { x: currentPos.x - orig.x, y: currentPos.y - orig.y, z: currentPos.z - orig.z }
  const local = rotate(deltaParent, invert(rot))
  return { x: round3(local.x), y: round3(local.y), z: round3(local.z) }
}
