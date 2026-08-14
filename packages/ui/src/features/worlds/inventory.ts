// Worlds inventory: what the wallet owns / can deploy to, each world's current
// deployment, and the world-level permission lists.
import { parseCoords } from '../../lib/parse-coords'
import { marketplaceSubgraph, placesApi, worldsServer } from './endpoints'
import { signedFetch } from './signed-fetch'
import type { WorldSettings } from './settings'

export interface WorldDeployment {
  title: string
  deployer: string | null
  timestamp: number | null
  entityId: string | null
  thumbnail: string | null
  parcels: number
  size: number | null // bytes used by the deployment
  base: string | null // base parcel "x,y" — the gatekeeper scope needs it
  authoritativeMultiplayer: boolean // server storage only works for these scenes
}

// One published scene, located. A world can host several (45 of 392 do), and
// each is counted on its own by the analytics service — hence the coordinates.
export interface WorldScene {
  x: number
  y: number
  title: string | null
  timestamp: number | null
  thumbnail: string | null
  entityId: string | null
}

export interface WorldEntry {
  name: string // full world name, e.g. "boedo.dcl.eth"
  role: 'owner' | 'collaborator'
  size: number | null // bytes used, from /wallet/contribute (collaborator list)
  deployment: WorldDeployment | null // null = nothing deployed yet
  scenes: WorldScene[] // every scene published here, in server order; unreadable bases dropped
  settings: WorldSettings | null // the world's own title/description/thumbnail (null = couldn't read)
  image: string | null // places thumbnail (fallback: deployment.thumbnail)
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

function mapDeployment(s: WorldSceneRaw | undefined): WorldDeployment | null {
  if (s?.entity === undefined) return null
  const meta = s.entity.metadata
  return {
    title: meta?.display?.title ?? 'Untitled scene',
    deployer: s.deployer?.toLowerCase() ?? null,
    timestamp: s.entity.timestamp ?? null,
    entityId: s.entityId ?? null,
    thumbnail: thumbnailOf(s),
    parcels: meta?.scene?.parcels?.length ?? 0,
    size: s.size !== undefined ? Number(s.size) : null,
    base: meta?.scene?.base ?? null,
    authoritativeMultiplayer: meta?.authoritativeMultiplayer === true
  }
}

function mapScene(s: WorldSceneRaw): WorldScene | null {
  const meta = s.entity?.metadata
  const at = parseCoords(meta?.scene?.base ?? null)
  if (at === null) return null
  return {
    x: at.x,
    y: at.y,
    title: meta?.display?.title ?? null,
    timestamp: s.entity?.timestamp ?? null,
    thumbnail: thumbnailOf(s),
    entityId: s.entityId ?? null
  }
}

// The world's CURRENT scenes (the server keeps no history). `deployment` is
// scenes[0] mapped exactly as it always was — six surfaces read it, so it is
// computed independently of the coordinate parse: a scene whose base is
// unreadable drops out of `scenes` without changing `deployment` at all.
export async function fetchWorldScenes(
  name: string
): Promise<{ deployment: WorldDeployment | null; scenes: WorldScene[] }> {
  const res = await fetch(`${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/scenes`)
  if (!res.ok) return { deployment: null, scenes: [] }
  const body = (await res.json()) as { scenes?: WorldSceneRaw[] }
  const raw = body.scenes ?? []
  return {
    deployment: mapDeployment(raw[0]),
    scenes: raw.map(mapScene).filter((s): s is WorldScene => s !== null)
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
export interface WorldPermissions {
  owner: string | null
  deployment: { type: string; wallets: string[] }
  streaming: { type: string; wallets: string[] }
  access: { type: string; wallets: string[] }
}

export async function fetchWorldPermissions(name: string): Promise<WorldPermissions | null> {
  const res = await fetch(`${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/permissions`)
  if (!res.ok) return null
  const body = (await res.json()) as {
    owner?: string
    permissions?: Partial<Record<WorldPermissionKind, { type?: string; wallets?: string[] }>>
  }
  const norm = (k: WorldPermissionKind): { type: string; wallets: string[] } => ({
    type: body.permissions?.[k]?.type ?? 'unrestricted',
    wallets: (body.permissions?.[k]?.wallets ?? []).map((w) => w.toLowerCase())
  })
  return { owner: body.owner?.toLowerCase() ?? null, deployment: norm('deployment'), streaming: norm('streaming'), access: norm('access') }
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
