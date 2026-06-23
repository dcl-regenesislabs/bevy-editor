// Pure geometry for picking gizmo handles: the pointer ray vs. each handle's
// world shape. Imports only @dcl/sdk/math (no engine), so it's unit-testable —
// and this maths is the thing that must be correct. The previous regression used
// the engine's collider raycast, which hit-tested these small, per-frame-scaled
// handles offset and camera-dependently (you had to aim beside the handle). Doing
// it ourselves against known geometry makes the hit exact and view-independent.
import { Vector3 } from '@dcl/sdk/math'

export type Axis = 'x' | 'y' | 'z'

export type HandleKind =
  | { op: 'translate-axis'; axis: Axis }
  | { op: 'translate-plane'; normal: Axis }
  | { op: 'rotate'; axis: Axis }
  | { op: 'scale-axis'; axis: Axis }
  | { op: 'scale-uniform' }

export type Ray = { origin: Vector3; dir: Vector3 } // dir must be unit length

// Geometry + grab tolerances, in gizmo-local units (the caller multiplies by the
// gizmo's on-screen scale, so the grab area is a constant screen fraction).
export type PickConfig = {
  armLength: number // arrow / scale-stalk length from the center
  planeOffset: number // plane square offset along each in-plane axis
  ringRadius: number // rotate ring radius
  axisTol: number // perpendicular grab radius around an axis arm
  planeHalf: number // half-extent of a plane square's grab area
  ringTol: number // half-width of the band around a rotate ring
  centerTol: number // grab radius around the uniform-scale center
}

export function axisVec(a: Axis): Vector3 {
  return a === 'x' ? Vector3.Right() : a === 'y' ? Vector3.Up() : Vector3.Forward()
}

export function otherAxes(a: Axis): [Axis, Axis] {
  return a === 'x' ? ['y', 'z'] : a === 'y' ? ['x', 'z'] : ['x', 'y']
}

export function rayPlaneIntersect(
  origin: Vector3,
  dir: Vector3,
  planePoint: Vector3,
  normal: Vector3
): Vector3 | null {
  const denom = Vector3.dot(normal, dir)
  if (Math.abs(denom) < 1e-6) return null
  const t = Vector3.dot(normal, Vector3.subtract(planePoint, origin)) / denom
  if (t < 0) return null
  return Vector3.add(origin, Vector3.scale(dir, t))
}

// Perpendicular distance from point P to the forward ray (origin O, unit dir D),
// and the ray depth t at the closest point.
export function rayPointDist(O: Vector3, D: Vector3, P: Vector3): { dist: number; t: number } {
  const t = Math.max(0, Vector3.dot(Vector3.subtract(P, O), D))
  return { dist: Vector3.distance(Vector3.add(O, Vector3.scale(D, t)), P), t }
}

// Closest distance between the forward ray (O, D unit) and segment A→B, with the
// ray depth t at the closest approach.
export function raySegmentDist(
  O: Vector3,
  D: Vector3,
  A: Vector3,
  B: Vector3
): { dist: number; t: number } {
  const v = Vector3.subtract(B, A)
  const w0 = Vector3.subtract(O, A)
  const b = Vector3.dot(D, v)
  const c = Vector3.dot(v, v)
  const d = Vector3.dot(D, w0)
  const e = Vector3.dot(v, w0)
  const denom = c - b * b
  let u = denom < 1e-6 ? 0 : (e - d * b) / denom
  u = Math.max(0, Math.min(1, u))
  const t = Math.max(0, u * b - d)
  const rayPt = Vector3.add(O, Vector3.scale(D, t))
  const segPt = Vector3.add(A, Vector3.scale(v, u))
  return { dist: Vector3.distance(rayPt, segPt), t }
}

// Index of the handle kind under the ray, or -1. `center`/`scale` describe the
// gizmo (world-aligned, uniform scale). Nearest hit (smallest ray depth) wins;
// planes / rings / the center cube outrank axis arms, so aiming at a square never
// grabs the axis sitting behind it (matches rob's original priority).
export function pickHandleKind(
  kinds: HandleKind[],
  center: Vector3,
  scale: number,
  ray: Ray,
  cfg: PickConfig
): number {
  let best = -1
  let bestT = Infinity
  let bestRank = Infinity
  const tryHit = (i: number, dist: number, t: number, tol: number, rank: number): void => {
    if (t <= 0 || dist > tol * scale) return
    if (rank < bestRank || (rank === bestRank && t < bestT)) {
      best = i
      bestT = t
      bestRank = rank
    }
  }
  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i]
    if (k.op === 'translate-axis' || k.op === 'scale-axis') {
      const end = Vector3.add(center, Vector3.scale(axisVec(k.axis), cfg.armLength * scale))
      const h = raySegmentDist(ray.origin, ray.dir, center, end)
      tryHit(i, h.dist, h.t, cfg.axisTol, 1)
    } else if (k.op === 'scale-uniform') {
      const h = rayPointDist(ray.origin, ray.dir, center)
      tryHit(i, h.dist, h.t, cfg.centerTol, 0)
    } else if (k.op === 'translate-plane') {
      const [a, b] = otherAxes(k.normal)
      const sqCenter = Vector3.add(
        center,
        Vector3.add(
          Vector3.scale(axisVec(a), cfg.planeOffset * scale),
          Vector3.scale(axisVec(b), cfg.planeOffset * scale)
        )
      )
      const hit = rayPlaneIntersect(ray.origin, ray.dir, sqCenter, axisVec(k.normal))
      if (hit !== null) {
        const rel = Vector3.subtract(hit, sqCenter)
        const half = cfg.planeHalf * scale
        const inSquare =
          Math.abs(Vector3.dot(rel, axisVec(a))) <= half &&
          Math.abs(Vector3.dot(rel, axisVec(b))) <= half
        if (inSquare) tryHit(i, 0, Vector3.dot(Vector3.subtract(hit, ray.origin), ray.dir), 1, 0)
      }
    } else {
      // rotate ring: hit the ring's plane, accept a band around the circumference
      const hit = rayPlaneIntersect(ray.origin, ray.dir, center, axisVec(k.axis))
      if (hit !== null) {
        const radial = Math.abs(Vector3.distance(hit, center) - cfg.ringRadius * scale)
        if (radial <= cfg.ringTol * scale) {
          tryHit(i, 0, Vector3.dot(Vector3.subtract(hit, ray.origin), ray.dir), 1, 0)
        }
      }
    }
  }
  return best
}
