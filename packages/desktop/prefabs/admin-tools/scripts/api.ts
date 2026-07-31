// Decentraland service endpoints the admin panel talks to, plus the signedFetch
// wrapper every call goes through. The hosts are hardcoded on purpose — they are
// hardcoded in the Creator Hub runtime too, and the scene has no way to discover
// them. `getDomain()` switches org/zone off the realm's network id.
import { signedFetch } from '~system/SignedFetch'
import type { SignedFetchRequest } from '~system/SignedFetch'
import { getRealm } from '~system/Runtime'
import type { PBRealmInfo } from '~system/Runtime'

export type Result<T> = [null, T] | [string, null]

let realmCache: PBRealmInfo | undefined

export async function loadRealm(): Promise<PBRealmInfo | undefined> {
  if (realmCache !== undefined) return realmCache
  const info = await getRealm({})
  realmCache = info.realmInfo
  return realmCache
}

export function isPreview(): boolean {
  return realmCache?.isPreview === true
}

export function getDomain(): string {
  if (realmCache === undefined || realmCache.networkId === 1) return 'org'
  return 'zone'
}

export function gatekeeperUrl(path: string): string {
  return `https://comms-gatekeeper.decentraland.${getDomain()}${path}`
}

export function rewardsUrl(path: string): string {
  return `https://rewards.decentraland.${getDomain()}${path}`
}

export const ENDPOINTS = {
  sceneAdmin: (): string => gatekeeperUrl('/scene-admin'),
  sceneBans: (): string => gatekeeperUrl('/scene-bans'),
  streamAccess: (): string => gatekeeperUrl('/scene-stream-access'),
  castStreamLink: (): string => gatekeeperUrl('/cast/generate-stream-link'),
  castPresenters: (): string => gatekeeperUrl('/cast/presenters'),
  rewardsCampaignKeys: (): string => rewardsUrl('/api/campaigns/keys'),
  rewardsCaptcha: (): string => rewardsUrl('/api/captcha'),
  rewardsAssign: (): string => rewardsUrl('/api/rewards')
}

// signedFetch is unavailable in local preview (no wallet-signed identity), so the
// caller gets an explanatory failure instead of a stack trace.
export async function request<T>(req: SignedFetchRequest): Promise<Result<T>> {
  await loadRealm()
  if (isPreview()) return ['Not available in local preview — try it in a World or Genesis City.', null]

  try {
    const response = await signedFetch(req)
    if (!response.ok) return [response.body === '' ? `request to ${req.url} failed` : response.body, null]
    return [null, JSON.parse(response.body === '' ? '{}' : response.body) as T]
  } catch (error) {
    console.log(`admin-tools: ${req.url} failed`, error)
    return [error instanceof Error ? error.message : String(error), null]
  }
}

export interface SceneAdminResponse {
  id: string
  name: string
  admin: string
  canBeRemoved: boolean
}

export interface SceneAdmin {
  address: string
  name: string
  verified: boolean
  canBeRemoved: boolean
}

export async function getSceneAdmins(): Promise<Result<SceneAdminResponse[]>> {
  return request<SceneAdminResponse[]>({ url: ENDPOINTS.sceneAdmin() })
}

export async function addSceneAdmin(admin: string): Promise<Result<unknown>> {
  return request({
    url: ENDPOINTS.sceneAdmin(),
    init: { method: 'POST', headers: {}, body: JSON.stringify({ admin }) }
  })
}

export async function removeSceneAdmin(admin: string): Promise<Result<unknown>> {
  return request({
    url: ENDPOINTS.sceneAdmin(),
    init: { method: 'DELETE', headers: {}, body: JSON.stringify({ admin }) }
  })
}

export interface SceneBanUser {
  bannedAddress: string
  name: string
}

export async function getSceneBans(): Promise<Result<{ results: SceneBanUser[] }>> {
  return request<{ results: SceneBanUser[] }>({ url: ENDPOINTS.sceneBans() })
}

// Who gets to see the panel. Local preview has no wallet-signed identity to check
// against /scene-admin, so everyone is an admin there — the Creator Hub runtime
// makes the same call, and without it the panel would be untestable offline.
export function isSceneAdmin(admins: SceneAdmin[], address: string | undefined): boolean {
  if (isPreview()) return true
  if (address === undefined) return false
  const lower = address.toLowerCase()
  return admins.some((admin) => admin.address === lower)
}

export function toSceneAdmins(response: SceneAdminResponse[]): SceneAdmin[] {
  return response
    .map((entry) => ({
      address: entry.admin.toLowerCase(),
      name: entry.name,
      verified: !entry.name.includes('#'),
      canBeRemoved: entry.canBeRemoved === true
    }))
    .sort((a) => (a.canBeRemoved ? 1 : -1))
}
