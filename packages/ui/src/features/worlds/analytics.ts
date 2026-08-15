// Per-world analytics: the creators-data metrics client.
//
// One signed POST answers every scene in a world. The service enumerates
// nothing — the location list is assembled from what the app already knows
// (WorldEntry.scenes) — and it takes no metric selector, window or date range, so
// a request always returns everything it has. Adding an element to the tab is
// therefore a component change, never a second request.
import { getAccount } from '../account/auth'
import { metricsApi } from './endpoints'
import { SIGN_IN_REQUIRED, signedFetch } from './signed-fetch'
import { sceneKeyOf, sceneLabel, sceneTotalOf } from './scene-label'
import type { WorldEntry, WorldScene } from './inventory'
import { projectScene, type LocationMetrics, type MetricBag, type MetricsWindow } from './metrics-read'

// ---- location assembly ----

export interface SceneLocation {
  world: string
  x: number
  y: number
}

// Per SCENE, not per world: a world hosting three scenes is three locations and
// three rows. `world` is the ENS name verbatim — `foo.eth` and `foo.dcl.eth` are
// two different, both-valid worlds, so nothing here normalises one into the other.
export function sceneLocations(w: WorldEntry): SceneLocation[] {
  return w.scenes.map((s) => ({ world: w.name, x: s.x, y: s.y }))
}

// OUR id for a scene, and the only one the app uses. The response's
// `location_key` ("cozyfarm.dcl.eth|0|0") exists for the service's logs; building
// or parsing it would hang identity on a string the service is free to change,
// when identity actually comes from what we sent.
//
// One definition, re-exported rather than restated: scene-label.ts owns scene
// identity for the section list, the map and the open set, and a second spelling
// here would key `byScene` differently from the sections that read it — which
// renders as a scene with no numbers rather than as an error.
export { sceneKeyOf as sceneKey }

// Above 100 locations the service answers 400. Scene counts are server-driven,
// so the guard stays even though no world is close to it today.
const MAX_LOCATIONS = 100

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ---- the client ----

export interface WorldSnapshot {
  exportedAt: string | null // the warehouse's export stamp, not fetch time
  byScene: Record<string, LocationMetrics> // keyed by sceneKey, never by location_key
}

interface RawLocation {
  location_key?: string
  builder_project_id?: string | null
  metrics?: MetricBag
}
interface RawBatch {
  exported_at?: string
  locations?: RawLocation[]
}

// The sentences live here and never in a .tsx, the same way gatekeeper.ts,
// storage.ts and logs.ts map their own statuses.
// A wallet that may not read a location does NOT land here — it gets a 200 with
// an empty bag — so 401/403 is an auth-chain failure, not a permission verdict,
// and the fix is to sign in again rather than to ask someone for access.
export function analyticsError(status: number, message: string | null): string {
  // status 0 is our name for a transport failure: a rejected fetch (or a
  // rejected relay call) never becomes a Response, so it arrives as a throw.
  if (status === 0) return "Couldn't reach the analytics service — check your connection."
  if (status === 401 || status === 403) return "Your sign-in wasn't recognised — sign out and back in."
  if (status === 429) return 'Slowing down — the analytics service is rate-limiting, try again in a moment.'
  // a 400 is our own bad request (a name it won't accept, too many locations);
  // the service's `message` is the only thing that says which
  if (status === 400 && message !== null) return message
  return `The analytics service didn't answer (${status}) — try again.`
}

async function messageOf(res: Response): Promise<string | null> {
  const raw = await res.text().catch(() => '')
  if (raw === '') return null
  try {
    const body = JSON.parse(raw) as { error?: string; message?: string }
    return body.message ?? body.error ?? null
  } catch {
    return raw // non-JSON bodies are kept verbatim (the service answers a bare "Forbidden" on 403)
  }
}

async function postMetrics(locations: SceneLocation[]): Promise<RawBatch> {
  let res: Response
  try {
    // Concatenated, never `new URL('/metrics', base)`: the base carries the /v2
    // the signature has to cover. The body is outside the signature entirely.
    res = await signedFetch(`${metricsApi()}/metrics`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ locations })
    })
  } catch (e) {
    // An expired identity fails here, before anything reaches the network.
    // Telling that person to check their connection sends them the wrong way.
    if (e instanceof Error && e.message === SIGN_IN_REQUIRED) throw e
    throw new Error(analyticsError(0, null))
  }
  if (!res.ok) throw new Error(analyticsError(res.status, await messageOf(res)))
  try {
    return (await res.json()) as RawBatch
  } catch {
    // A 200 carrying a non-JSON body (a proxy or captive portal) would
    // otherwise render a raw SyntaxError next to a Retry button.
    throw new Error(analyticsError(res.status, null))
  }
}

// Every scene of one world in a single round trip.
export async function fetchWorldMetrics(w: WorldEntry): Promise<WorldSnapshot> {
  const locations = sceneLocations(w)
  // An empty `locations` array is a 400, so a world with nothing readable never
  // reaches the network. It is also where the reference implementation's
  // zero-chunk TypeError lives; not porting that is the point of this line.
  if (locations.length === 0) return { exportedAt: null, byScene: {} }
  // The response is parallel to the request and nothing else pairs them, so
  // each chunk is checked against the chunk that asked for it: two imbalanced
  // batches can still sum to the right total, and mispairing would show one
  // scene's numbers under another scene's name.
  const batches = await Promise.all(
    chunk(locations, MAX_LOCATIONS).map(async (part) => {
      const batch = await postMetrics(part)
      const got = (batch.locations ?? []).length
      if (got !== part.length) {
        throw new Error(`The analytics service answered ${got} of ${part.length} scenes, so the response can't be read.`)
      }
      return batch
    })
  )
  const answered = batches.flatMap((b) => b.locations ?? [])
  const byScene: Record<string, LocationMetrics> = {}
  w.scenes.forEach((s, i) => {
    const a = answered[i]
    byScene[sceneKeyOf(w, s)] = {
      location_key: a.location_key ?? '',
      builder_project_id: a.builder_project_id ?? null,
      metrics: a.metrics ?? {}
    }
  })
  return { exportedAt: batches[0].exported_at ?? null, byScene }
}

// ---- what the tab ranks and labels by ----

// A scene the export doesn't carry is an empty bag, never a missing one: every
// reading in metrics-read falls back to null on its own, so an absent scene
// projects to "no numbers" rather than to a crash.
const EMPTY: LocationMetrics = { location_key: '', builder_project_id: null, metrics: {} }

export function sceneMetrics(byScene: Record<string, LocationMetrics>, key: string): LocationMetrics {
  return key in byScene ? byScene[key] : EMPTY
}

// The projected visitor count of every scene, in the window the tab is showing.
// It ranks the sections, it labels their headers, and both have to be the number
// the section body will print — a header reading 2,772 over a body reading 4,180
// is two answers to one question.
export function visitorCounts(
  w: WorldEntry,
  snapshot: WorldSnapshot | undefined,
  window: MetricsWindow
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  if (snapshot === undefined) return out
  for (const s of w.scenes) {
    const key = sceneKeyOf(w, s)
    out.set(key, projectScene(sceneMetrics(snapshot.byScene, key), snapshot.exportedAt, window).visitors)
  }
  return out
}

// The one tab that does NOT list its scenes by coordinate. "Which of my scenes is
// doing best" is the question this surface exists to answer, and an answer is a
// ranking; a scene with no row sorts last rather than being hidden, because an
// absent number is itself a thing to see.
export function rankByVisitors(
  w: WorldEntry,
  scenes: WorldScene[],
  visitors: Map<string, number | null>
): WorldScene[] {
  const held = sceneTotalOf(w)
  return [...scenes].sort((a, b) => {
    const av = visitors.get(sceneKeyOf(w, a)) ?? null
    const bv = visitors.get(sceneKeyOf(w, b)) ?? null
    if (av === bv) return sceneLabel(a, held).localeCompare(sceneLabel(b, held))
    if (av === null) return 1
    if (bv === null) return -1
    return bv - av
  })
}

// ---- per-world cache ----

interface CacheEntry {
  fetchedOn: string // local calendar date, as toDateString() prints it
  snapshot: WorldSnapshot
}

const snapshots = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<WorldSnapshot>>()
let cacheWallet: string | null = null

// Publishing a new scene changes the key, so there is no publish invalidation to
// get wrong — and there must not be one: publishing does not change the numbers,
// and the dashed publish rule is read from WorldEntry on every render, never
// from the snapshot.
function cacheKey(w: WorldEntry, wallet: string | null): string {
  return `${wallet ?? ''}|${w.name}|${w.scenes.map((s) => sceneKeyOf(w, s)).join(',')}`
}

// What the tab actually calls. Invisible to the component, which keeps using a
// plain useLoad: switching scene rows, switching tabs and re-entering the world
// all cost nothing, which is what makes a refresh button unnecessary rather than
// merely absent.
export function worldMetrics(w: WorldEntry): Promise<WorldSnapshot> {
  const wallet = getAccount()
  // metrics are per-wallet-permissioned; never answer one wallet from another's
  // snapshot, the rule the worlds store already enforces on the inventory
  if (wallet !== cacheWallet) {
    snapshots.clear()
    inFlight.clear()
    cacheWallet = wallet
  }
  const key = cacheKey(w, wallet)
  // Not a TTL and not a timer: a new export can only exist on a new local date,
  // which is also the answer to "the app was left open overnight".
  const today = new Date().toDateString()
  const hit = snapshots.get(key)
  if (hit !== undefined && hit.fetchedOn === today) return Promise.resolve(hit.snapshot)
  snapshots.delete(key)
  const flying = inFlight.get(key)
  // useLoad neither aborts nor dedupes — it discards a stale resolution — so a
  // StrictMode double mount or a fast tab-out/tab-in would otherwise fire a
  // second signed POST for an answer already on its way.
  if (flying !== undefined) return flying
  const pending = fetchWorldMetrics(w).then(
    (snapshot) => {
      snapshots.set(key, { fetchedOn: today, snapshot })
      inFlight.delete(key)
      return snapshot
    },
    (err: unknown) => {
      // only resolved snapshots are cached, so Retry genuinely retries
      inFlight.delete(key)
      throw err
    }
  )
  inFlight.set(key, pending)
  return pending
}
