// Worlds inventory: what the wallet owns / can deploy to, the scenes standing on
// each world, and the world-level permission lists.
//
// A world has scenes; it has no single "current deployment". The server orders
// /world/{name}/scenes by created_at ASC, so the first row is the world's OLDEST
// scene — the one field that used to stand in for the world named the scene a
// creator is least likely to be looking at, under a heading that said "world".
// Anything about one scene is read off that scene.
import { canonCoords, parseCoords } from '../../lib/parse-coords'
import { marketplaceSubgraph, placesApi, worldsServer } from './endpoints'
import { signedFetch } from './signed-fetch'
import type { WorldSettings } from './settings'

// One published scene, located. A world can host several (45 of 392 do), and
// each is counted on its own by the analytics service — hence the coordinates.
// `parcels` is the scene's identity inside a world: there is no per-scene name,
// so a publish replaces whatever stands on the same ground and nothing else.
export interface WorldScene {
  x: number
  y: number
  parcels: string[] // the scene's whole footprint, as the server sent it
  title: string | null
  deployer: string | null // lowercased wallet
  timestamp: number | null
  thumbnail: string | null
  entityId: string | null
  size: number | null // bytes; the server serializes this as a string
  status: string // 'DEPLOYED' unless the server says otherwise
  authoritativeMultiplayer: boolean // this scene declared a Multiplayer Server — the gate for its storage and logs
}

// How many scenes the world holds. A union, not `number | null`, because the
// difference matters at every call site: `?? 0` would render "we couldn't read
// this world" as "this world is empty", and the publish flow decides whether to
// warn about replacing someone's work on exactly that answer.
export type SceneCount = { known: true; total: number } | { known: false }

export interface WorldEntry {
  name: string // full world name, e.g. "boedo.dcl.eth"
  role: 'owner' | 'collaborator'
  size: number | null // bytes used, from /wallet/contribute (collaborator list)
  scenes: WorldScene[] // the scenes we could locate, in server order (oldest first)
  sceneCount: SceneCount // how many the world holds — including any we couldn't locate
  settings: WorldSettings | null // the world's own title/description/thumbnail (null = couldn't read)
  image: string | null // places thumbnail (fallback: the newest scene's)
  userCount: number | null
}

// DCL NAMEs the wallet owns (marketplace subgraph, category ens)
export async function fetchOwnedNames(address: string): Promise<string[]> {
  const res = await fetch(marketplaceSubgraph(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'query Names($address: String!) { nfts(first: 1000, where: { owner_: { id: $address }, category: ens }) { ens { subdomain } } }',
      variables: { address: address.toLowerCase() }
    })
  })
  if (!res.ok) throw new Error(`could not list your NAMEs (${res.status})`)
  const body = (await res.json()) as { data?: { nfts?: Array<{ ens?: { subdomain?: string } }> } }
  return (body.data?.nfts ?? [])
    .map((n) => n.ens?.subdomain)
    .filter((s): s is string => typeof s === 'string' && s !== '')
    .map((s) => `${s.toLowerCase()}.dcl.eth`)
}

// worlds the wallet can deploy to as a collaborator (+ size used)
export async function fetchContributable(): Promise<Array<{ name: string; size: number | null }>> {
  const res = await signedFetch(`${worldsServer()}/wallet/contribute`)
  if (!res.ok) return []
  const body = (await res.json()) as { domains?: Array<{ name?: string; size?: string; user_permissions?: string[] }> }
  return (body.domains ?? [])
    .filter((d) => typeof d.name === 'string' && (d.user_permissions ?? []).includes('deployment'))
    .map((d) => ({ name: d.name!.toLowerCase(), size: d.size !== undefined ? Number(d.size) : null }))
}

interface WorldSceneRaw {
  deployer?: string
  entityId?: string
  size?: string
  status?: string
  // The server's OWN footprint index, alongside the entity rather than inside
  // it. This is the list it resolves a coordinate against, so it is the list to
  // trust: the metadata copy is whatever the deployer's scene.json said.
  parcels?: string[]
  entity?: {
    timestamp?: number
    content?: Array<{ file: string; hash: string }>
    metadata?: {
      display?: { title?: string; navmapThumbnail?: string }
      scene?: { parcels?: string[]; base?: string }
      authoritativeMultiplayer?: boolean
    }
  }
}

// the navmap thumbnail is a file NAME in the metadata; its bytes live under the
// content hash the deployment lists for that name.
function thumbnailOf(s: WorldSceneRaw): string | null {
  const thumbFile = s.entity?.metadata?.display?.navmapThumbnail
  const thumbHash = thumbFile !== undefined ? s.entity?.content?.find((c) => c.file === thumbFile)?.hash : undefined
  return thumbHash !== undefined ? `${worldsServer()}/contents/${thumbHash}` : null
}

function parcelsOf(s: WorldSceneRaw): string[] {
  return s.parcels ?? s.entity?.metadata?.scene?.parcels ?? []
}

// Locate the scene the way the server does: base first, falling back to the
// first parcel (extractSpawnCoordinates does the same, and base is not required
// to be a member of parcels). Only a scene with no readable coordinate at all is
// dropped — it is still one of the world's scenes, so it is still counted.
function mapScene(s: WorldSceneRaw): WorldScene | null {
  const meta = s.entity?.metadata
  const parcels = parcelsOf(s)
  const at = parseCoords(meta?.scene?.base ?? null) ?? parseCoords(parcels[0] ?? null)
  if (at === null) return null
  return {
    x: at.x,
    y: at.y,
    parcels,
    title: meta?.display?.title ?? null,
    deployer: s.deployer?.toLowerCase() ?? null,
    timestamp: s.entity?.timestamp ?? null,
    thumbnail: thumbnailOf(s),
    entityId: s.entityId ?? null,
    size: s.size !== undefined ? Number(s.size) : null,
    status: s.status ?? 'DEPLOYED',
    authoritativeMultiplayer: meta?.authoritativeMultiplayer === true
  }
}

// The coordinate that addresses THIS scene for removal.
//
// `x,y` is the scene's base, because that is where the server spawns visitors —
// but the server does not require the base to be a member of the footprint (it
// is why the locator above needs a fallback at all). DELETE
// /world/{name}/scenes/{coordinate} resolves whichever scene occupies the
// coordinate, so addressing a removal by a base that sits outside the footprint
// removes a DIFFERENT scene, or 404s while the scene stays live. A parcel of the
// footprint always resolves to this scene and nothing else.
//
// Whitespace is forgiven — canonCoords does that, and undeployScene's parse is
// strict — but nothing else is invented.
export function sceneCoordinate(s: WorldScene): string {
  for (const p of s.parcels) {
    const at = canonCoords(p)
    if (at !== null) return at
  }
  return `${s.x},${s.y}`
}

// An UNDEPLOYED row is a tombstone, not a scene. Older servers send no status at
// all and everything they send is live, so a missing field means deployed.
function isDeployed(s: WorldSceneRaw): boolean {
  return (s.status ?? 'DEPLOYED') === 'DEPLOYED'
}

const PAGE = 100 // the endpoint's own default limit
const MAX_PAGES = 20 // a server that keeps answering with full pages must not spin us forever

// null means "couldn't read this page" — a transport failure and a 404 are the
// same answer here, and neither may be mistaken for an empty world.
async function fetchScenesPage(
  lowerName: string,
  offset: number
): Promise<{ rows: WorldSceneRaw[]; total: number | null } | null> {
  try {
    const res = await fetch(`${worldsServer()}/world/${encodeURIComponent(lowerName)}/scenes?limit=${PAGE}&offset=${offset}`)
    if (!res.ok) return null
    const body = (await res.json()) as { scenes?: WorldSceneRaw[]; total?: number }
    return { rows: body.scenes ?? [], total: typeof body.total === 'number' ? body.total : null }
  } catch {
    return null
  }
}

// The world's CURRENT scenes (the server keeps no history), read page by page.
//
// `sceneCount` is known only when a stop condition was actually reached. A page
// that failed, or a server still handing out full pages after MAX_PAGES, leaves
// the scenes we did read in place and admits the total is unknown. It can
// therefore exceed `scenes.length`: a scene with no readable coordinate is
// counted but cannot be located, and nothing may report it as an empty world.
export async function fetchWorldScenes(name: string): Promise<{ scenes: WorldScene[]; sceneCount: SceneCount }> {
  const lowerName = name.toLowerCase()
  const rows: WorldSceneRaw[] = []
  let complete = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await fetchScenesPage(lowerName, page * PAGE)
    if (got === null) break
    rows.push(...got.rows)
    // a short page is the last one; a long one means the server ignored `limit`
    if (got.rows.length !== PAGE || (got.total !== null && rows.length >= got.total)) {
      complete = true
      break
    }
  }
  const live = rows.filter(isDeployed)
  return {
    scenes: live.map(mapScene).filter((s): s is WorldScene => s !== null),
    sceneCount: complete ? { known: true, total: live.length } : { known: false }
  }
}

// places thumbnails + live user counts, batched
export async function fetchPlacesMeta(names: string[]): Promise<Map<string, { image: string | null; users: number | null }>> {
  const out = new Map<string, { image: string | null; users: number | null }>()
  if (names.length === 0) return out
  try {
    const q = names.map((n) => `names=${encodeURIComponent(n.toLowerCase())}`).join('&')
    const res = await fetch(`${placesApi()}/worlds?${q}`)
    if (!res.ok) return out
    const body = (await res.json()) as { data?: Array<{ world_name?: string; image?: string; user_count?: number }> }
    for (const p of body.data ?? []) {
      if (typeof p.world_name === 'string') {
        out.set(p.world_name.toLowerCase(), { image: p.image ?? null, users: p.user_count ?? null })
      }
    }
  } catch {
    /* enrichment only */
  }
  return out
}

const CONCURRENCY = 6
export async function mapLimited<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return results
}

// ---- permissions (world detail panel) ----
export type WorldPermissionKind = 'deployment' | 'streaming' | 'access'

// The three gates, in the order the panel lists them.
export const PERMISSION_KINDS: WorldPermissionKind[] = ['deployment', 'access', 'streaming']

// The four gates the worlds server serves. Only 'allow-list' is a list a creator
// can add to; the other three are set outside Studio, so collapsing them all to
// "a type string and some wallets" is what let the UI offer an add-wallet row on
// a world gated by an NFT. A type we don't recognise is 'unknown', never
// 'unrestricted' — guessing the open gate would say "everyone can" about a wall.
const KNOWN_TYPES = ['unrestricted', 'shared-secret', 'nft-ownership', 'allow-list'] as const
export type WorldPermissionType = (typeof KNOWN_TYPES)[number] | 'unknown'

export interface WorldPermission {
  type: WorldPermissionType
  raw: string // the server's own word, so an unrecognised gate can still be named
  wallets: string[] // lowercased; the gate only when type is 'allow-list'
  communities: string[] // community ids an allow-list admits, opaque and left verbatim
}

export interface WorldPermissions {
  owner: string | null
  deployment: WorldPermission
  streaming: WorldPermission
  access: WorldPermission
  // How wide each grant actually is, keyed by `scopeKey(kind, address)`. A
  // narrowing belongs to ONE grant — a wallet may publish on two parcels and
  // stream across the whole world — so an address alone cannot key this: the
  // last kind read would overwrite the others and the surviving scope would be
  // stated of all three. PUT .../permissions/{kind}/{address} deletes any parcel
  // narrowing, so re-granting from Studio widens a parcel-scoped collaborator to
  // the whole world. A missing entry means "we could not tell", never
  // "world-wide": `summary`'s shape is documented but was never observed
  // populated, so an unrecognised body yields no entries and the UI says nothing
  // rather than inventing a scope.
  scopes: Map<string, GrantScope>
}

export interface GrantScope {
  worldWide: boolean
  parcelCount: number | null
  // WHICH parcels, when the server names them — empty whenever it does not, and
  // empty is "we were not told", never "none". A count answers how wide a grant
  // is; only the list answers where, and there is nowhere else in the app to
  // learn that. Read strictly (canonCoords or drop) so a half-legible list can
  // never draw a parcel the grant does not actually cover.
  parcels: string[]
}

// The scope when we KNOW the grant is narrowed. Null covers both "world-wide" and
// "the server didn't tell us" — those two must render the same, because inventing
// a scope is what surfacing it exists to stop. A narrowed grant whose COUNT is
// missing is still narrowed: the count is the label, never the test.
export function narrowedScope(scope: GrantScope | undefined): GrantScope | null {
  if (scope === undefined || scope.worldWide) return null
  return scope
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

// Recognise, never guess: only an object carrying a boolean `world_wide` counts.
// `parcels` rides the same rule — an entry that carries no readable coordinate
// list yields none, and the UI then shows the count alone as it always has.
function readScope(v: unknown): GrantScope | null {
  const o = asRecord(v)
  if (o === null || typeof o.world_wide !== 'boolean') return null
  const parcels = stringList(o.parcels)
    .map((p) => canonCoords(p))
    .filter((p): p is string => p !== null)
  return {
    worldWide: o.world_wide,
    parcelCount: typeof o.parcel_count === 'number' ? o.parcel_count : parcels.length > 0 ? parcels.length : null,
    parcels
  }
}

// One grant's narrowing: the kind it belongs to and the wallet it was given to.
export function scopeKey(kind: WorldPermissionKind, address: string): string {
  return `${kind}|${address.toLowerCase()}`
}

// Which grants can be narrowed to parcels at all. Deployment and streaming can;
// entry cannot — there is no per-parcel access. It matters for the flat shape
// below, which names no kind: attributing one of those scopes to `access` would
// draw a map of "where this wallet can enter", a rule the platform does not have.
const NARROWABLE: WorldPermissionKind[] = ['deployment', 'streaming']

// The handler may key the map by permission kind with the addresses one level in,
// or flat by address. The nested shape says which grant it is talking about and
// is taken at its word; the flat one does not, so it is read as the two kinds a
// narrowing can belong to and never as the third.
function parseSummary(summary: unknown): Map<string, GrantScope> {
  const out = new Map<string, GrantScope>()
  for (const [key, value] of Object.entries(asRecord(summary) ?? {})) {
    const direct = readScope(value)
    if (direct !== null) {
      for (const kind of NARROWABLE) out.set(scopeKey(kind, key), direct)
      continue
    }
    const kind = PERMISSION_KINDS.find((k) => k === key)
    if (kind === undefined) continue
    for (const [address, nested] of Object.entries(asRecord(value) ?? {})) {
      const scope = readScope(nested)
      if (scope !== null) out.set(scopeKey(kind, address), scope)
    }
  }
  return out
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// A missing entry is the open gate — the server stores no row for a permission
// nobody restricted. A present one is taken at its word, and its lists are read
// whatever the type says: a consumer decides what they mean by looking at `type`.
function readPermission(raw: unknown): WorldPermission {
  const o = asRecord(raw)
  const word = typeof o?.type === 'string' ? o.type : 'unrestricted'
  return {
    type: KNOWN_TYPES.find((t) => t === word) ?? 'unknown',
    raw: word,
    wallets: stringList(o?.wallets).map((w) => w.toLowerCase()),
    communities: stringList(o?.communities)
  }
}

export async function fetchWorldPermissions(name: string): Promise<WorldPermissions | null> {
  const res = await fetch(`${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/permissions`)
  if (!res.ok) return null
  const body = (await res.json()) as { owner?: string; permissions?: Record<string, unknown>; summary?: unknown }
  const norm = (k: WorldPermissionKind): WorldPermission => readPermission(body.permissions?.[k])
  return {
    owner: body.owner?.toLowerCase() ?? null,
    deployment: norm('deployment'),
    streaming: norm('streaming'),
    access: norm('access'),
    scopes: parseSummary(body.summary)
  }
}

export async function setWorldPermission(
  name: string,
  kind: WorldPermissionKind,
  address: string,
  grant: boolean
): Promise<void> {
  const url = `${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/permissions/${kind}/${encodeURIComponent(address.toLowerCase())}`
  const res = await signedFetch(url, { method: grant ? 'PUT' : 'DELETE' })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(res.status === 401 || res.status === 403 ? 'Only the world owner can change this' : `Failed (${res.status}) ${detail}`)
  }
}
