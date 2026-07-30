// Pure-ish helpers behind the moderation tab: input validation, the two list
// refreshes and the permission rule for `allowNonOwnersManageAdminAllowList`.
import {
  getSceneAdmins,
  getSceneBans,
  isPreview,
  toSceneAdmins,
  type SceneAdmin,
  type SceneBanUser
} from '../../api'
import type { AdminToolsValue } from '../../components'
import type { AdminMessageBus } from '../../message-bus'
import type { AdminState } from '../../state'
import type { AdminPlayer } from '../../types'

const ADDRESS = /^0x[a-fA-F0-9]{40}$/

export function isValidAddress(value: string): boolean {
  return ADDRESS.test(value)
}

// A Decentraland NAME is at most 15 characters, so anything longer was meant to be
// a wallet address — that is how the Hub decides which request shape to send.
export function looksLikeAddress(value: string): boolean {
  return value.length > 15
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function addressOf(user: SceneAdmin | SceneBanUser): string {
  return 'address' in user ? user.address : user.bannedAddress
}

// The gatekeeper omits `name` for wallets with no NAME, so this never trusts it.
export function userName(user: SceneAdmin | SceneBanUser): string {
  return typeof user.name === 'string' ? user.name : ''
}

export function displayName(user: SceneAdmin | SceneBanUser): string {
  const name = userName(user)
  return name === '' ? shortAddress(addressOf(user)) : name
}

export function isAdminUser(admins: SceneAdmin[], value: string): boolean {
  const lower = value.toLowerCase()
  return admins.some(
    (admin) => admin.address === lower || (lower !== '' && userName(admin).toLowerCase() === lower)
  )
}

// The gatekeeper marks scene owners and operators as non-removable, which is the
// only signal the /scene-admin response carries about who is more than an admin.
export function isSceneOwner(admins: SceneAdmin[], address: string | undefined): boolean {
  if (address === undefined) return false
  const lower = address.toLowerCase()
  return admins.some((admin) => admin.address === lower && !admin.canBeRemoved)
}

export function canManageAdmins(
  config: AdminToolsValue,
  admins: SceneAdmin[],
  player: AdminPlayer | null
): boolean {
  if (config.moderationControl.allowNonOwnersManageAdminAllowList) return true
  if (isPreview()) return true
  return isSceneOwner(admins, player?.userId)
}

// `broadcast` tells the other clients to refetch too — only worth the comms message
// after the list actually changed, which is how the Hub splits its two fetchers.
export async function refreshAdmins(
  state: AdminState,
  bus: AdminMessageBus | null,
  broadcast = false
): Promise<void> {
  const [error, response] = await getSceneAdmins()
  state.admins = error === null ? toSceneAdmins(response) : []
  bus?.updateAdminList(state.admins)
  if (broadcast) bus?.syncAdmins()
}

export async function refreshBans(state: AdminState): Promise<void> {
  const [error, response] = await getSceneBans()
  state.bans = error === null && Array.isArray(response.results) ? response.results : []
}
