// Worlds data layer: everything the Worlds tab and the publish flow need.
// Talks to the same production services the decentraland.org creator tools use:
//   - worlds-content-server (deployments, permissions, contributor list)
//   - the marketplace subgraph (which DCL NAMEs the wallet owns)
//   - places API (world thumbnails / live user counts)
// Authenticated calls are signed-fetch (ADR-44 x-identity-* headers) with the
// AuthIdentity from auth.ts — signing stays in the renderer, like everything
// identity-related. Publishing drives the local linker server that main spawns
// (see publish.ts in the desktop package): GET /api/info → sign rootCID →
// POST /api/deploy.
import { useSyncExternalStore } from 'react'
import { Authenticator } from '@dcl/crypto'
import { getAccount, getIdentity, hasValidIdentity } from './auth'

// same env switch as auth.ts ('dcl-auth-env' = 'zone' → Sepolia stack)
function zone(): boolean {
  return localStorage.getItem('dcl-auth-env') === 'zone'
}
export function worldsServer(): string {
  return zone() ? 'https://worlds-content-server.decentraland.zone' : 'https://worlds-content-server.decentraland.org'
}
function placesApi(): string {
  return zone() ? 'https://places.decentraland.zone/api' : 'https://places.decentraland.org/api'
}
function marketplaceSubgraph(): string {
  return zone() ? 'https://subgraph.decentraland.org/marketplace-sepolia' : 'https://subgraph.decentraland.org/marketplace'
}
function chainId(): number {
  return zone() ? 11155111 : 1
}
export function jumpInUrl(name: string): string {
  const base = zone() ? 'https://play.decentraland.zone' : 'https://play.decentraland.org'
  return `${base}/?realm=${encodeURIComponent(name.toLowerCase())}`
}

// ---- signed fetch (ADR-44) ----
// payload = method:path:timestamp:metadata, lowercased, signed with the identity;
// each auth-chain link travels as an x-identity-auth-chain-<i> header.
async function signedFetch(url: string, init?: RequestInit, metadata: Record<string, unknown> = {}): Promise<Response> {
  const identity = getIdentity()
  if (identity === null) throw new Error('Sign in to do this')
  const method = (init?.method ?? 'GET').toLowerCase()
  const path = new URL(url).pathname.toLowerCase()
  const timestamp = String(Date.now())
  const meta = JSON.stringify(metadata)
  const payload = [method, path, timestamp, meta].join(':').toLowerCase()
  const chain = Authenticator.signPayload(identity, payload)
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
  chain.forEach((link, i) => {
    headers[`x-identity-auth-chain-${i}`] = JSON.stringify(link)
  })
  headers['x-identity-timestamp'] = timestamp
  headers['x-identity-metadata'] = meta
  return fetch(url, { ...init, headers })
}

// ---- worlds inventory ----
export interface WorldDeployment {
  title: string
  deployer: string | null
  timestamp: number | null
  entityId: string | null
  thumbnail: string | null
  parcels: number
  size: number | null // bytes used by the deployment
}

export interface WorldEntry {
  name: string // full world name, e.g. "boedo.dcl.eth"
  role: 'owner' | 'collaborator'
  size: number | null // bytes used, from /wallet/contribute (collaborator list)
  deployment: WorldDeployment | null // null = nothing deployed yet
  image: string | null // places thumbnail (fallback: deployment.thumbnail)
  userCount: number | null
}

// DCL NAMEs the wallet owns (marketplace subgraph, category ens)
async function fetchOwnedNames(address: string): Promise<string[]> {
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
async function fetchContributable(): Promise<Array<{ name: string; size: number | null }>> {
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
      scene?: { parcels?: string[] }
    }
  }
}

// the world's CURRENT deployment (the server keeps no history)
export async function fetchWorldDeployment(name: string): Promise<WorldDeployment | null> {
  const res = await fetch(`${worldsServer()}/world/${encodeURIComponent(name.toLowerCase())}/scenes`)
  if (!res.ok) return null
  const body = (await res.json()) as { scenes?: WorldSceneRaw[] }
  const s = body.scenes?.[0]
  if (s?.entity === undefined) return null
  const meta = s.entity.metadata
  const thumbFile = meta?.display?.navmapThumbnail
  const thumbHash = thumbFile !== undefined ? s.entity.content?.find((c) => c.file === thumbFile)?.hash : undefined
  return {
    title: meta?.display?.title ?? 'Untitled scene',
    deployer: s.deployer?.toLowerCase() ?? null,
    timestamp: s.entity.timestamp ?? null,
    entityId: s.entityId ?? null,
    thumbnail: thumbHash !== undefined ? `${worldsServer()}/contents/${thumbHash}` : null,
    parcels: meta?.scene?.parcels?.length ?? 0,
    size: s.size !== undefined ? Number(s.size) : null
  }
}

// places thumbnails + live user counts, batched
async function fetchPlacesMeta(names: string[]): Promise<Map<string, { image: string | null; users: number | null }>> {
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
async function mapLimited<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
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

// ---- worlds store (module singleton, like auth.ts) ----
export interface WorldsState {
  worlds: WorldEntry[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}
let worldsStore: WorldsState = { worlds: [], status: 'idle', error: null }
const worldsListeners = new Set<() => void>()
function setWorldsStore(patch: Partial<WorldsState>): void {
  worldsStore = { ...worldsStore, ...patch }
  for (const l of worldsListeners) l()
}

let refreshing = false
let worldsWallet: string | null = null // whose worlds the store holds

// Call on mount / wallet change: resets on sign-out or account switch, fetches
// when the store is empty or belongs to another wallet. refreshWorlds() is the
// explicit "Refresh" action; this one is idempotent.
export function ensureWorlds(): void {
  const wallet = hasValidIdentity() ? getAccount() : null
  if (wallet === null) {
    if (worldsWallet !== null || worldsStore.status !== 'idle') {
      worldsWallet = null
      setWorldsStore({ worlds: [], status: 'idle', error: null })
    }
    return
  }
  if (wallet !== worldsWallet || worldsStore.status === 'idle') refreshWorlds()
}

export function refreshWorlds(): void {
  const wallet = getAccount()
  if (wallet === null || !hasValidIdentity()) {
    worldsWallet = null
    setWorldsStore({ worlds: [], status: 'idle', error: null })
    return
  }
  if (refreshing) return
  if (wallet !== worldsWallet) setWorldsStore({ worlds: [] }) // never show another wallet's worlds
  worldsWallet = wallet
  refreshing = true
  setWorldsStore({ status: 'loading', error: null })
  void (async () => {
    try {
      const [owned, contributable] = await Promise.all([
        fetchOwnedNames(wallet),
        fetchContributable().catch(() => [])
      ])
      const byName = new Map<string, WorldEntry>()
      for (const c of contributable) {
        byName.set(c.name, { name: c.name, role: 'collaborator', size: c.size, deployment: null, image: null, userCount: null })
      }
      for (const n of owned) {
        const prev = byName.get(n)
        byName.set(n, { name: n, role: 'owner', size: prev?.size ?? null, deployment: null, image: null, userCount: null })
      }
      const entries = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
      const [deployments, places] = await Promise.all([
        mapLimited(entries, (e) => fetchWorldDeployment(e.name).catch(() => null)),
        fetchPlacesMeta(entries.map((e) => e.name))
      ])
      entries.forEach((e, i) => {
        e.deployment = deployments[i]
        const p = places.get(e.name)
        e.image = p?.image ?? e.deployment?.thumbnail ?? null
        e.userCount = p?.users ?? null
      })
      setWorldsStore({ worlds: entries, status: 'ready', error: null })
    } catch (err) {
      setWorldsStore({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    } finally {
      refreshing = false
    }
  })()
}

export function useWorlds(): WorldsState {
  return useSyncExternalStore(
    (l) => {
      worldsListeners.add(l)
      return () => worldsListeners.delete(l)
    },
    () => worldsStore
  )
}

// ---- publish flow (module singleton state machine) ----
// building: main is installing deps / building / hashing (until linker `ready`)
// uploading: we signed the entity and POSTed — the linker uploads to the server
export type PublishPhase = 'idle' | 'building' | 'uploading' | 'success' | 'error'
export interface PublishState {
  phase: PublishPhase
  dir: string | null
  world: string | null
  logs: string[]
  error: string | null
  jumpIn: string | null
}
let publishStore: PublishState = { phase: 'idle', dir: null, world: null, logs: [], error: null, jumpIn: null }
const publishListeners = new Set<() => void>()
function setPublishStore(patch: Partial<PublishState>): void {
  publishStore = { ...publishStore, ...patch }
  for (const l of publishListeners) l()
}

// The live job's token. Every async continuation (event handler, driveLinker
// then/catch, the pre-flight chain) checks `alive` before touching the store —
// a cancelled/replaced job must not stamp state over its successor. `id` is
// main's jobId; null while publishStart is still in flight (early install logs
// arrive before it resolves).
interface JobToken {
  id: string | null
  alive: boolean
}
let jobToken: JobToken | null = null
let unsubPublish: (() => void) | null = null
const LOG_CAP = 400

function finishPublish(patch: Partial<PublishState>): void {
  if (jobToken !== null) jobToken.alive = false
  jobToken = null
  unsubPublish?.()
  unsubPublish = null
  setPublishStore(patch)
}

// Sign the entity and hand it to the linker: the POST returns once the upload
// to the worlds content server finished (or failed).
async function driveLinker(port: number): Promise<void> {
  const identity = getIdentity()
  const wallet = getAccount()
  if (identity === null || wallet === null) throw new Error('Your session expired — sign in again')
  const info = (await (await fetch(`http://localhost:${port}/api/info`)).json()) as { rootCID: string }
  const authChain = Authenticator.signPayload(identity, info.rootCID)
  const res = await fetch(`http://localhost:${port}/api/deploy`, {
    method: 'POST',
    body: JSON.stringify({ address: wallet, authChain, chainId: chainId() })
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `upload failed (${res.status})`)
  }
}

// Advisory pre-flight (the server re-checks authoritatively at upload): can
// `wallet` deploy to `name`? Owner, open deployment, or on the allow-list.
async function canDeploy(name: string, wallet: string): Promise<boolean> {
  try {
    const p = await fetchWorldPermissions(name)
    if (p === null) return true // can't tell — let the server decide
    return p.owner === wallet || p.deployment.type === 'unrestricted' || p.deployment.wallets.includes(wallet)
  } catch {
    return true
  }
}

// Publish `dir` to `world`: writes worldConfiguration.name, then main builds and
// serves the linker; on `ready` we sign + upload. One publish at a time.
export function startPublish(dir: string, world: string): void {
  const shell = window.editorShell
  const publishStartShell = shell?.publishStart
  const setWorldName = shell?.setWorldName
  if (shell === undefined || publishStartShell === undefined || shell.onPublishEvent === undefined || setWorldName === undefined) {
    setPublishStore({ phase: 'error', error: 'Publishing needs the desktop app', dir, world, logs: [], jumpIn: null })
    return
  }
  if (publishStore.phase === 'building' || publishStore.phase === 'uploading') return
  if (!hasValidIdentity()) {
    setPublishStore({ phase: 'error', error: 'Sign in to publish', dir, world, logs: [], jumpIn: null })
    return
  }
  const name = world.toLowerCase()
  const wallet = getAccount()
  const token: JobToken = { id: null, alive: true }
  jobToken = token
  setPublishStore({ phase: 'building', dir, world: name, logs: [], error: null, jumpIn: null })
  let uploading = false
  unsubPublish = shell.onPublishEvent((e) => {
    if (!token.alive) return
    // before publishStart resolves we don't know our jobId — accept only the
    // (cosmetic) install logs then; ready/exit must match our job exactly
    if (token.id === null ? e.kind !== 'log' : e.jobId !== token.id) return
    if (e.kind === 'log') {
      const logs = [...publishStore.logs, e.line]
      if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP)
      setPublishStore({ logs })
    } else if (e.kind === 'ready') {
      uploading = true
      setPublishStore({ phase: 'uploading' })
      driveLinker(e.port)
        .then(() => {
          if (!token.alive) return // cancelled mid-upload
          finishPublish({ phase: 'success', jumpIn: jumpInUrl(name) })
          refreshWorlds() // the tab should show the new deployment right away
        })
        .catch((err: unknown) => {
          if (!token.alive) return // cancelled — the connection reset is ours
          void shell.publishStop?.()
          finishPublish({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
        })
    } else if (e.kind === 'exit') {
      // an exit before `ready` (or a non-zero exit before our POST resolved)
      // means the build/validation failed — surface the log tail
      if (!uploading && publishStore.phase === 'building') {
        const tail = publishStore.logs.slice(-6).join('\n')
        finishPublish({ phase: 'error', error: `The build failed.\n${tail}` })
      }
    }
  })
  void (async () => {
    if (wallet !== null && !(await canDeploy(name, wallet))) {
      if (token.alive) {
        finishPublish({
          phase: 'error',
          error: `You don't have permission to publish to ${name} — ask the world owner to add your wallet to its deployment list.`
        })
      }
      return
    }
    if (!token.alive) return // cancelled during pre-flight — nothing started yet
    await setWorldName(dir, name)
    if (!token.alive) return
    const { jobId } = await publishStartShell(dir, worldsServer())
    // cancelled while main was spawning: cancelPublish's publish-stop was sent
    // AFTER our publish-start (IPC is ordered), so main already cancelled this
    // job — calling publishStop again here could kill a newer job instead
    if (!token.alive) return
    token.id = jobId
  })().catch((err: unknown) => {
    if (!token.alive) return
    finishPublish({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
  })
}

export function cancelPublish(): void {
  void window.editorShell?.publishStop?.()
  finishPublish({ phase: 'idle', error: null, jumpIn: null })
}

// clear a finished (success/error) publish so the modal returns to the picker
export function resetPublish(): void {
  if (publishStore.phase === 'success' || publishStore.phase === 'error') {
    finishPublish({ phase: 'idle', dir: null, world: null, logs: [], error: null, jumpIn: null })
  }
}

export function usePublish(): PublishState {
  return useSyncExternalStore(
    (l) => {
      publishListeners.add(l)
      return () => publishListeners.delete(l)
    },
    () => publishStore
  )
}

export function formatBytes(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatAgo(ts: number | null): string {
  if (ts === null) return ''
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}
