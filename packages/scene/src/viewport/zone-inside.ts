// Which trigger zones the player is standing in — the source of the Play-mode
// "You're inside" HUD chip.
//
// The engine settles the real trigger in rapier and reports it as
// TriggerAreaResult to the scene that OWNS the area, never to the editor's
// super-scene, so containment has to be re-derived here. It is derived from the
// same snapshot transforms trigger-volume.ts draws, against the very volumes
// zone-pick.ts hit-tests (`zoneVolumes`): a UNIT box / sphere scaled by the
// entity's world transform (ADR-258).
import { Vector3, type Quaternion } from '@dcl/sdk/math'
import { entityName, nameKey } from '../custom-components'
import type { Snapshot } from '../state'
import { halfOf, toLocalPoint, zoneVolumes } from './zone-pick'

// bevy's avatar collider is a capsule of radius 0.3 and height 2.0 centred at
// feet + 1.0 (crates/common/src/dynamics.rs). We sample its axis rather than
// sweep the radius, so at a boundary the chip can lag the real trigger by up to
// 0.3 m — a HUD hint, not the detector.
const AVATAR_SAMPLES = [0.3, 1.0, 1.7]

// A zero half-extent is a volume with no inside, matching rayObb's null.
export function pointInObb(
  point: Vector3,
  center: Vector3,
  rotation: Quaternion,
  scale: Vector3
): boolean {
  const h = halfOf(scale)
  if (h.x <= 0 || h.y <= 0 || h.z <= 0) return false
  const p = toLocalPoint(point, center, rotation)
  return Math.abs(p.x) <= h.x && Math.abs(p.y) <= h.y && Math.abs(p.z) <= h.z
}

export function pointInEllipsoid(
  point: Vector3,
  center: Vector3,
  rotation: Quaternion,
  scale: Vector3
): boolean {
  const r = halfOf(scale)
  if (r.x <= 0 || r.y <= 0 || r.z <= 0) return false
  const p = toLocalPoint(point, center, rotation)
  const x = p.x / r.x
  const y = p.y / r.y
  const z = p.z / r.z
  return x * x + y * y + z * z <= 1
}

export function zoneLabel(snapshot: Snapshot, id: string): string {
  const name = entityName(snapshot, id)
  return name === undefined || name.trim() === '' ? `Entity ${id}` : name
}

// Names of every zone containing an avatar whose FEET are at `feet`, in snapshot
// order. Deduped by nameKey, the way zoneBus matches ids: two zones sharing a
// name are one place to every script that listens for it, so the chip must not
// name it twice.
export function zonesContaining(snapshot: Snapshot, feet: Vector3): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const zone of zoneVolumes(snapshot)) {
    const inside = AVATAR_SAMPLES.some((y) => {
      const p = Vector3.create(feet.x, feet.y + y, feet.z)
      return zone.sphere
        ? pointInEllipsoid(p, zone.center, zone.rotation, zone.scale)
        : pointInObb(p, zone.center, zone.rotation, zone.scale)
    })
    if (!inside) continue
    const label = zoneLabel(snapshot, zone.id)
    const key = nameKey(label)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}
