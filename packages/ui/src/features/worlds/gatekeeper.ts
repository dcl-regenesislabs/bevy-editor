// comms-gatekeeper: streaming keys, scene admins, bans.
// Scene-scoped signed requests. The gatekeeper's validate() reads a `realm`
// OBJECT from the metadata (serverName = world name, hostname containing
// "worlds-content-server" marks it a world) plus sceneId (entity hash) and a
// parcel — the exact shape the sites creators-tools sends.
import { gatekeeperUrl, worldsServer } from './endpoints'
import { signedFetch } from './signed-fetch'
import { sceneCoordinate, type WorldScene } from './inventory'

export interface SceneScope {
  sceneId: string // entityId of the scene these requests are about
  realmName: string // world name
  parcel: string // a parcel the scene stands on, "x,y"
}

// The scope of ONE scene. The parcel is a parcel of that scene's own footprint,
// because the gatekeeper resolves the scene by the ground it is given and a
// world holds several: a parcel belonging to another scene manages another
// creator's streams and bans under this scene's name. There is no fallback — a
// scene we cannot address is a scope we do not build, and the caller says so.
export function sceneScopeOf(name: string, s: WorldScene): SceneScope | null {
  if (s.entityId === null) return null
  return { sceneId: s.entityId, realmName: name.toLowerCase(), parcel: sceneCoordinate(s) }
}

function sceneMetadata(scope: SceneScope): Record<string, unknown> {
  return {
    realm: { serverName: scope.realmName, hostname: worldsServer(), protocol: 'v3' },
    sceneId: scope.sceneId,
    parcel: scope.parcel,
    signer: 'decentraland-kernel-scene'
  }
}

// The status travels with the sentence: a panel needs to tell the situation
// apart from the wording, and re-parsing the message to get it back is worse.
class GatekeeperError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function gatekeeperError(status: number): Error {
  return new GatekeeperError(
    status,
    status === 401 || status === 403
      ? 'Only the world owner or a scene admin can do this'
      : `The request failed (${status}) — try again`
  )
}

// A 404 from a call that names a scene is the Places index, not permission: the
// gatekeeper resolves the scene through Places, and a scene published minutes
// ago is not in it yet. Shown as a plain failure it reads as an accusation the
// creator can do nothing about — they do own the world, the index just hasn't
// caught up. (A GET that legitimately means "no row yet" answers null before
// this is ever reached.)
export function isSceneNotIndexed(e: unknown): boolean {
  return e instanceof GatekeeperError && e.status === 404
}

export interface StreamAccess {
  url: string
  key: string
  endsAt: number | null
}

// GET returns 404 when no key exists — that's "none", not an error
export async function getStreamAccess(scope: SceneScope): Promise<StreamAccess | null> {
  const res = await signedFetch(`${gatekeeperUrl()}/scene-stream-access`, { method: 'GET' }, sceneMetadata(scope))
  if (res.status === 404) return null
  if (!res.ok) throw gatekeeperError(res.status)
  const b = (await res.json()) as { streaming_url?: string; streaming_key?: string; ends_at?: number }
  if (b.streaming_url === undefined || b.streaming_key === undefined) return null
  return { url: b.streaming_url, key: b.streaming_key, endsAt: b.ends_at ?? null }
}

// POST creates, PUT resets (new key), DELETE revokes
export async function mutateStreamAccess(scope: SceneScope, action: 'create' | 'reset' | 'revoke'): Promise<void> {
  const method = action === 'create' ? 'POST' : action === 'reset' ? 'PUT' : 'DELETE'
  const res = await signedFetch(`${gatekeeperUrl()}/scene-stream-access`, { method }, sceneMetadata(scope))
  if (!res.ok) throw gatekeeperError(res.status)
}

export interface SceneAdmin {
  admin: string
  name: string
  canBeRemoved: boolean
}

export async function listSceneAdmins(scope: SceneScope): Promise<SceneAdmin[]> {
  const res = await signedFetch(`${gatekeeperUrl()}/scene-admin`, { method: 'GET' }, sceneMetadata(scope))
  if (!res.ok) throw gatekeeperError(res.status)
  const json = (await res.json()) as SceneAdmin[] | { admins?: SceneAdmin[] }
  return Array.isArray(json) ? json : json.admins ?? []
}

// add by wallet address or DCL name (the gatekeeper resolves names); remove by address
export async function addSceneAdmin(scope: SceneScope, target: { admin?: string; name?: string }): Promise<void> {
  const res = await signedFetch(
    `${gatekeeperUrl()}/scene-admin`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) },
    sceneMetadata(scope)
  )
  if (!res.ok) throw gatekeeperError(res.status)
}

export async function removeSceneAdmin(scope: SceneScope, admin: string): Promise<void> {
  const res = await signedFetch(
    `${gatekeeperUrl()}/scene-admin`,
    { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin }) },
    sceneMetadata(scope)
  )
  if (!res.ok) throw gatekeeperError(res.status)
}

export interface SceneBan {
  bannedAddress: string
  name: string
}

export async function listSceneBans(scope: SceneScope): Promise<{ bans: SceneBan[]; total: number }> {
  const res = await signedFetch(
    `${gatekeeperUrl()}/scene-bans?limit=100&offset=0`,
    { method: 'GET' },
    sceneMetadata(scope)
  )
  if (!res.ok) throw gatekeeperError(res.status)
  const b = (await res.json()) as { results?: SceneBan[]; total?: number }
  return { bans: b.results ?? [], total: b.total ?? 0 }
}

// ban/unban by wallet address or DCL name
export async function setSceneBan(
  scope: SceneScope,
  target: { address?: string; name?: string },
  banned: boolean
): Promise<void> {
  const body = target.address !== undefined ? { banned_address: target.address } : { banned_name: target.name }
  const res = await signedFetch(
    `${gatekeeperUrl()}/scene-bans`,
    { method: banned ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    sceneMetadata(scope)
  )
  if (!res.ok) throw gatekeeperError(res.status)
}
