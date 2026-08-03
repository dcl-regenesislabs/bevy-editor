// Analytic pointer-ray vs. TriggerArea volume picking, plus the reader for the
// volumes themselves — zone-inside.ts derives the Play-mode HUD's containment
// from the same ones, and the two must agree on what a zone's volume IS.
//
// A zone renders nothing and carries no collider, so the editor's pick raycast
// can never hit one. Synthesizing a MeshCollider for it is NOT an option:
// bevy's ColliderId is (container, mesh_name, index) and both MeshCollider
// flavours (collider + trigger) default to the same (None, 0), so one shared
// slot in SceneColliderData gets fought over by two systems and `set_collider`
// removes the loser — the trigger silently stops firing, intermittently.
//
// So we do the maths ourselves against the volume the SDK derives from the
// entity's own Transform (ADR-258: a UNIT box / sphere scaled by the world
// transform). Same reasoning as gizmo-pick.ts, and unit-testable for it.
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { rotateVec3ByQuat } from '../camera/perspective-to-screen'
import { TRIGGER_AREA } from '../allowed-components'
import type { Snapshot } from '../state'
import { worldTransformOf } from '../world-pos'

// TriggerAreaMeshType: 0 = TAMT_BOX (default), 1 = TAMT_SPHERE.
export const TRIGGER_SPHERE = 1

export type ZoneHit = { id: string; t: number }

/** One authored TriggerArea's volume, in the frame `worldTransformOf` reports. */
export interface ZoneVolume {
  id: string
  sphere: boolean
  center: Vector3
  rotation: Quaternion
  scale: Vector3
}

const EPS = 1e-6

function conjugate(q: Quaternion): Quaternion {
  return Quaternion.create(-q.x, -q.y, -q.z, q.w)
}

// Half-extents / radii: the SDK scales a unit shape, so a size of 4 m is a
// half-extent of 2. Negative scale mirrors the volume, which leaves it the same
// shape, hence abs().
export function halfOf(scale: Vector3): Vector3 {
  return Vector3.create(Math.abs(scale.x) / 2, Math.abs(scale.y) / 2, Math.abs(scale.z) / 2)
}

// A point in the volume's own frame: undo the rotation about the centre. Scale is
// NOT undone — it lives in the half-extents, which keeps non-uniform scale exact.
export function toLocalPoint(point: Vector3, center: Vector3, rotation: Quaternion): Vector3 {
  return rotateVec3ByQuat(Vector3.subtract(point, center), conjugate(rotation))
}

// Every authored TriggerArea whose world transform resolves, in snapshot order.
// The reserved-id cut and the ADR-258 shape decode are the same for picking and
// for containment, so both read the scene through here.
export function zoneVolumes(snapshot: Snapshot, accept?: (id: string) => boolean): ZoneVolume[] {
  const found: ZoneVolume[] = []
  for (const [id, comps] of Object.entries(snapshot)) {
    const area = comps[TRIGGER_AREA] as { mesh?: number } | undefined
    if (area === undefined || Number(id) < 512) continue
    if (accept !== undefined && !accept(id)) continue
    const world = worldTransformOf(snapshot, id)
    if (world === null) continue
    found.push({
      id,
      sphere: area.mesh === TRIGGER_SPHERE,
      center: world.position,
      rotation: world.rotation,
      scale: world.scale
    })
  }
  return found
}

// Distance along a unit-length ray to the near face of an oriented box, or null.
// A ray whose origin is INSIDE the box misses on purpose: standing in a zone
// must not make every click select it.
export function rayObb(
  origin: Vector3,
  dir: Vector3,
  center: Vector3,
  rotation: Quaternion,
  scale: Vector3
): number | null {
  const half = halfOf(scale)
  if (half.x <= 0 || half.y <= 0 || half.z <= 0) return null
  const o = toLocalPoint(origin, center, rotation)
  const d = rotateVec3ByQuat(dir, conjugate(rotation))
  const oa = [o.x, o.y, o.z]
  const da = [d.x, d.y, d.z]
  const ha = [half.x, half.y, half.z]
  let tmin = -Infinity
  let tmax = Infinity
  for (let i = 0; i < 3; i++) {
    if (Math.abs(da[i]) < EPS) {
      if (oa[i] < -ha[i] || oa[i] > ha[i]) return null
      continue
    }
    const inv = 1 / da[i]
    const t1 = (-ha[i] - oa[i]) * inv
    const t2 = (ha[i] - oa[i]) * inv
    tmin = Math.max(tmin, Math.min(t1, t2))
    tmax = Math.min(tmax, Math.max(t1, t2))
    if (tmin > tmax) return null
  }
  return tmin > EPS ? tmin : null
}

// Same, for the sphere volume. Non-uniform scale gives a true ellipsoid here
// (bevy approximates it with a convex hull) — cosmetic, do not "fix" it.
export function rayEllipsoid(
  origin: Vector3,
  dir: Vector3,
  center: Vector3,
  rotation: Quaternion,
  scale: Vector3
): number | null {
  const r = halfOf(scale)
  if (r.x <= 0 || r.y <= 0 || r.z <= 0) return null
  const o = toLocalPoint(origin, center, rotation)
  const d = rotateVec3ByQuat(dir, conjugate(rotation))
  const ox = o.x / r.x, oy = o.y / r.y, oz = o.z / r.z
  const dx = d.x / r.x, dy = d.y / r.y, dz = d.z / r.z
  const a = dx * dx + dy * dy + dz * dz
  if (a < EPS) return null
  const b = 2 * (ox * dx + oy * dy + oz * dz)
  const c = ox * ox + oy * oy + oz * oz - 1
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / (2 * a)
  return t > EPS ? t : null
}

// Nearest zone under the ray. `dir` must be unit length, and both it and
// `origin` must be in the same frame worldTransformOf reports (scene-local
// minus the world origin) — which is the frame the camera transform arrives in.
export function pickZone(
  origin: Vector3,
  dir: Vector3,
  snapshot: Snapshot,
  accept?: (id: string) => boolean
): ZoneHit | null {
  let best: ZoneHit | null = null
  for (const zone of zoneVolumes(snapshot, accept)) {
    const hit = zone.sphere
      ? rayEllipsoid(origin, dir, zone.center, zone.rotation, zone.scale)
      : rayObb(origin, dir, zone.center, zone.rotation, zone.scale)
    if (hit === null) continue
    if (best === null || hit < best.t) best = { id: zone.id, t: hit }
  }
  return best
}
