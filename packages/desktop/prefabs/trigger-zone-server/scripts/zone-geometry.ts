// Point-in-volume tests for a TriggerArea, in plain numbers: the server half
// re-derives containment itself, because rapier only settles triggers where the
// avatar colliders live (a headless server has none — crates/avatar builds them
// and the headless binary never adds that plugin).
//
// Same volume definition the engine uses (ADR-258): a UNIT box or sphere scaled
// by the entity's world transform. `slack` widens every half-extent by metres —
// a broadcast position arrives at ≤10 Hz and is the avatar's FEET, while the
// real collider is a 2 m capsule, so an honest player standing on the boundary
// must not be called a cheat.

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

export type ZoneShape = 'box' | 'sphere'

export function insideZone(
  shape: ZoneShape,
  point: Vec3,
  center: Vec3,
  rotation: Quat,
  scale: Vec3,
  slack: number
): boolean {
  if (scale.x <= 0 || scale.y <= 0 || scale.z <= 0) return false
  const margin = slack > 0 ? slack : 0
  const half = { x: scale.x / 2 + margin, y: scale.y / 2 + margin, z: scale.z / 2 + margin }
  const local = unrotate({ x: point.x - center.x, y: point.y - center.y, z: point.z - center.z }, rotation)
  if (shape === 'sphere') {
    const x = local.x / half.x
    const y = local.y / half.y
    const z = local.z / half.z
    return x * x + y * y + z * z <= 1
  }
  return Math.abs(local.x) <= half.x && Math.abs(local.y) <= half.y && Math.abs(local.z) <= half.z
}

// Into the volume's own frame: undo the rotation about the centre. Scale stays
// in the half-extents, which keeps non-uniform scale exact.
function unrotate(v: Vec3, q: Quat): Vec3 {
  const x = -q.x
  const y = -q.y
  const z = -q.z
  const tx = 2 * (y * v.z - z * v.y)
  const ty = 2 * (z * v.x - x * v.z)
  const tz = 2 * (x * v.y - y * v.x)
  return {
    x: v.x + q.w * tx + (y * tz - z * ty),
    y: v.y + q.w * ty + (z * tx - x * tz),
    z: v.z + q.w * tz + (x * ty - y * tx)
  }
}
