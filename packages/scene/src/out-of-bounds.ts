// Which entities sit outside the scene's parcels.
//
// The engine clips scene geometry to the parcels the scene owns: anything more
// than a couple of metres out is discarded outright, and the band before that
// dissolves into noise. So a model dragged past the edge simply stops rendering,
// with nothing to say why — it looks like the editor lost it.
//
// Pure geometry over the snapshot, so both the page UI and the scene can ask.
import { type Snapshot } from './state'
import { computeWorldPositions } from './world-pos'
import { type ParcelCoord } from './bridge-protocol'

export const PARCEL_SIZE = 16

// The engine's own out-of-bounds allowance (config.graphics.oob): geometry within
// this many metres of the parcel edge still renders, further out is culled.
const OOB_MARGIN = 2

// Parcel (x, y) covers world x ∈ [x*16, x*16+16] and z ∈ [y*16, y*16+16].
function insideParcels(pos: { x: number; z: number }, parcels: ParcelCoord[]): boolean {
  return parcels.some((p) => {
    const [minX, minZ] = [p.x * PARCEL_SIZE, p.y * PARCEL_SIZE]
    return (
      pos.x >= minX - OOB_MARGIN &&
      pos.x <= minX + PARCEL_SIZE + OOB_MARGIN &&
      pos.z >= minZ - OOB_MARGIN &&
      pos.z <= minZ + PARCEL_SIZE + OOB_MARGIN
    )
  })
}

// Memoised on the snapshot's identity: the store is replace-on-write, so a new
// object means new content. Lets the hierarchy ask per row (it renders
// recursively, so threading the set down as a prop would touch every level)
// without recomputing the whole scene's world positions each time.
let cached: { snapshot: Snapshot; parcels: ParcelCoord[] | undefined; result: Set<string> } | null = null

export function outOfBoundsSet(snapshot: Snapshot, parcels: ParcelCoord[] | undefined): Set<string> {
  if (cached !== null && cached.snapshot === snapshot && cached.parcels === parcels) return cached.result
  const result = outOfBoundsEntities(snapshot, parcels)
  cached = { snapshot, parcels, result }
  return result
}

// Ids whose world position falls outside the scene's parcels. Empty when the
// layout isn't known yet or the snapshot has no world origin to resolve against —
// no layout means no claim, rather than flagging everything.
export function outOfBoundsEntities(snapshot: Snapshot, parcels: ParcelCoord[] | undefined): Set<string> {
  const out = new Set<string>()
  if (parcels === undefined || parcels.length === 0) return out
  const world = computeWorldPositions(snapshot)
  if (world === null) return out
  for (const [id, pos] of world) {
    if (!insideParcels(pos, parcels)) out.add(id)
  }
  return out
}
