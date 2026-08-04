// Quaternion ↔ euler-degrees conversion for the Transform editor. The creator
// edits degrees; the component stores a quaternion.
//
// The convention is ZXY — the same one `Quaternion.fromEulerDegrees` uses in the
// SDK. Getting this wrong is not a visible crash: it silently swaps which axis a
// rotation lands on, so the round-trip is asserted in euler.test.ts.

export interface V3 {
  x: number
  y: number
  z: number
}

export interface Q {
  x: number
  y: number
  z: number
  w: number
}

export function quatToEuler(q: Q): V3 {
  const { x, y, z, w } = q
  const sinp = 2 * (w * x - y * z)
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp)
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y))
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z))
  const d = 180 / Math.PI
  return { x: pitch * d, y: yaw * d, z: roll * d }
}

export function eulerToQuat(e: V3): Q {
  const r = Math.PI / 360 // half, degrees→radians
  const cx = Math.cos(e.x * r), sx = Math.sin(e.x * r)
  const cy = Math.cos(e.y * r), sy = Math.sin(e.y * r)
  const cz = Math.cos(e.z * r), sz = Math.sin(e.z * r)
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  }
}
