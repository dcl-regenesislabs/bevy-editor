// Would publishing this scene replace someone's work? Answered before anything
// is spawned, so the only destructive case is the one the creator gets to see.
//
// A scene's identity inside a world is its PARCEL SET — there is no per-scene
// name, worldConfiguration carries only the world's. POST /entities undeploys
// exactly the deployed scenes whose parcels intersect the incoming ones and
// leaves every other scene untouched; overlap is never rejected, it is silently
// resolved by replacement. So the whole question is one request: which deployed
// scenes sit on the parcels we are about to occupy.
import { canonCoords, parseCoords } from '../../lib/parse-coords'

export interface OccupyingScene {
  entityId: string | null
  deployer: string | null // lowercased wallet, as the server reports it
  title: string | null
  base: string | null
  parcels: string[] // canonical "x,y", deduped and sorted
  timestamp: number | null
}

// ---- parcel arithmetic ----

// A parcel the strict parse still rejects is kept verbatim rather than dropped:
// a parcel that silently disappears from a footprint turns a replacement into a
// surprise.
function canon(p: string): string {
  return canonCoords(p) ?? p.trim()
}

export function footprintOf(parcels: string[]): string[] {
  return [...new Set(parcels.map(canon))].sort()
}

// ---- who is standing on our parcels ----

interface RawScene {
  entityId?: string
  deployer?: string
  status?: string
  parcels?: string[] // the server's own footprint index — what it resolves a coordinate against
  entity?: {
    timestamp?: number
    metadata?: { display?: { title?: string }; scene?: { parcels?: string[]; base?: string } }
  }
}

// POST /world/:name/scenes with {"coordinates":[…]} answers with exactly the
// scenes whose footprint contains any listed parcel. Unsigned, like the plain
// /scenes read next to it — this is public world state.
export async function fetchScenesAt(server: string, world: string, coordinates: string[]): Promise<OccupyingScene[]> {
  if (coordinates.length === 0) return []
  const res = await fetch(`${server}/world/${encodeURIComponent(world.toLowerCase())}/scenes`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ coordinates: footprintOf(coordinates) })
  })
  if (!res.ok) throw new Error(`could not read what is published in ${world} (${res.status})`)
  const body = (await res.json()) as { scenes?: RawScene[] }
  return (body.scenes ?? [])
    // The field is an enum, and its absence is not evidence of an undeployment:
    // a row we wrongly drop is a scene we would replace without asking.
    .filter((s) => (s.status ?? 'DEPLOYED') === 'DEPLOYED')
    .map((s) => ({
      entityId: s.entityId ?? null,
      deployer: s.deployer?.toLowerCase() ?? null,
      title: s.entity?.metadata?.display?.title ?? null,
      base: s.entity?.metadata?.scene?.base ?? null,
      parcels: footprintOf(s.parcels ?? s.entity?.metadata?.scene?.parcels ?? []),
      timestamp: s.entity?.timestamp ?? null
    }))
}

// Your own scene coming back is a REPUBLISH — an update, not a replacement — and
// must not raise a dialog. `own` is the entity this project folder published to
// this world last time (publish-identity.ts), which is the only trustworthy
// answer: wallet + parcel set is NOT an identity, because every project starts
// on the same parcels, so a second project of yours would be filtered out as if
// it were the first one coming back — and replaced with no dialog at all.
// Knowing nothing means every row is a conflict, which is the safe direction.
export function conflictsFor(rows: OccupyingScene[], own: string | null): OccupyingScene[] {
  if (own === null) return rows
  return rows.filter((r) => r.entityId !== own)
}

// ---- the lease ----

// What we showed the creator, as one comparable value. Reviewing a conflict takes
// time, and the world is shared: if anything moved on those parcels between the
// dialog opening and Replace being pressed, the sentence they agreed to is no
// longer true and the publish must not go ahead on it.
export function leaseOf(rows: OccupyingScene[]): string {
  return rows
    .map((r) => `${r.entityId ?? '?'}@${footprintOf(r.parcels).join('+')}`)
    .sort()
    .join('|')
}

export function leaseChanged(before: string, after: string): boolean {
  return before !== after
}

// ---- moving out of the way ----

const WORLD_MIN = -150
const WORLD_MAX = 150
const MAX_RING = WORLD_MAX - WORLD_MIN

export interface Footprint {
  base: string
  parcels: string[]
}

// Deltas at Chebyshev distance `r` from the origin, nearest-first within the
// ring: straight beats diagonal, and ties resolve deterministically so the same
// world always proposes the same parcels.
function ringDeltas(r: number): Array<{ dx: number; dy: number }> {
  if (r === 0) return [{ dx: 0, dy: 0 }]
  const cells: Array<{ dx: number; dy: number }> = []
  for (let dx = -r; dx <= r; dx++) {
    cells.push({ dx, dy: -r }, { dx, dy: r })
  }
  for (let dy = -r + 1; dy <= r - 1; dy++) {
    cells.push({ dx: -r, dy }, { dx: r, dy })
  }
  cells.sort((a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy) || a.dx - b.dx || a.dy - b.dy)
  return cells
}

// The nearest place this exact footprint fits, moved as a whole. The SHAPE is
// preserved — every parcel keeps its offset from the base — because a scene's
// layout is authored against those offsets, and the search is over free ground
// only, so accepting the answer never replaces anything.
export function nearestFreeFootprint(base: string, parcels: string[], occupied: Iterable<string>): Footprint | null {
  const at = parseCoords(canon(base))
  if (at === null || parcels.length === 0) return null
  const offsets: Array<{ dx: number; dy: number }> = []
  for (const p of parcels) {
    const c = parseCoords(canon(p))
    if (c === null) return null // an unreadable parcel makes the whole shape unknowable
    offsets.push({ dx: c.x - at.x, dy: c.y - at.y })
  }
  const taken = new Set([...occupied].map(canon))
  for (let r = 0; r <= MAX_RING; r++) {
    for (const d of ringDeltas(r)) {
      const x = at.x + d.dx
      const y = at.y + d.dy
      const moved: string[] = []
      let fits = true
      for (const o of offsets) {
        const px = x + o.dx
        const py = y + o.dy
        if (px < WORLD_MIN || px > WORLD_MAX || py < WORLD_MIN || py > WORLD_MAX) {
          fits = false
          break
        }
        const key = `${px},${py}`
        if (taken.has(key)) {
          fits = false
          break
        }
        moved.push(key)
      }
      if (fits) return { base: `${x},${y}`, parcels: moved }
    }
  }
  return null
}
