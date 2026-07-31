// Shape + defaults for `asset-packs::AdminTools`, the config component behind the
// built-in Admin Tools prefab. The component is engine-opaque (no engine schema
// to walk), so the inspector view can't lean on SchemaEditor — it edits this
// normalized value and writes the whole thing back. Everything here is pure so it
// can be unit-tested; the view is a thin rendering layer on top.
//
// Field order matters on the way out: Schemas.Map serializes in insertion order,
// so `adminToolsJson` rebuilds the object in the registry's order rather than
// spreading whatever came off the wire.

export const ADMIN_TOOLS_COMPONENT = 'asset-packs::AdminTools'
export const ACTIONS_COMPONENT = 'asset-packs::Actions'
export const REWARDS_COMPONENT = 'asset-packs::Rewards'
export const VIDEO_PLAYER_COMPONENT = 'VideoPlayer'

export type AdminPermissions = 'PUBLIC' | 'PRIVATE'

export interface EntityRef {
  entity: number
  customName: string
}

export interface SmartItemRef extends EntityRef {
  defaultAction: string
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface AdminToolsValue {
  adminPermissions: AdminPermissions
  authorizedAdminUsers: {
    me: boolean
    sceneOwners: boolean
    allowList: boolean
    adminAllowList: string[]
  }
  moderationControl: {
    isEnabled: boolean
    kickCoordinates: Vec3
    allowNonOwnersManageAdminAllowList: boolean
  }
  textAnnouncementControl: {
    isEnabled: boolean
    playSoundOnEachAnnouncement: boolean
    showAuthorOnEachAnnouncement: boolean
  }
  videoControl: {
    isEnabled: boolean
    disableVideoPlayersSound: boolean
    showAuthorOnVideoPlayers: boolean
    linkAllVideoPlayers: boolean
    videoPlayers: EntityRef[]
  }
  smartItemsControl: {
    isEnabled: boolean
    linkAllSmartItems: boolean
    smartItems: SmartItemRef[]
  }
  rewardsControl: {
    isEnabled: boolean
    rewardItems: EntityRef[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, key: string): Record<string, unknown> {
  const nested = isRecord(value) ? value[key] : undefined
  return isRecord(nested) ? nested : {}
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function vec3(value: unknown): Vec3 {
  const source = isRecord(value) ? value : {}
  return { x: num(source.x, 0), y: num(source.y, 0), z: num(source.z, 0) }
}

function entityRef(item: Record<string, unknown>): EntityRef {
  return { entity: num(item.entity, 0), customName: str(item.customName) }
}

function entityRefs(value: unknown): EntityRef[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map(entityRef)
}

function smartItemRefs(value: unknown): SmartItemRef[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item) => ({ ...entityRef(item), defaultAction: str(item.defaultAction) }))
}

export function normalizeAdminTools(value: unknown): AdminToolsValue {
  const users = record(value, 'authorizedAdminUsers')
  const moderation = record(value, 'moderationControl')
  const announcements = record(value, 'textAnnouncementControl')
  const video = record(value, 'videoControl')
  const smartItems = record(value, 'smartItemsControl')
  const rewards = record(value, 'rewardsControl')
  const permissions = isRecord(value) ? value.adminPermissions : undefined

  return {
    adminPermissions: permissions === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
    authorizedAdminUsers: {
      me: bool(users.me, true),
      sceneOwners: bool(users.sceneOwners, true),
      allowList: bool(users.allowList, true),
      adminAllowList: strings(users.adminAllowList)
    },
    moderationControl: {
      isEnabled: bool(moderation.isEnabled, true),
      kickCoordinates: vec3(moderation.kickCoordinates),
      allowNonOwnersManageAdminAllowList: bool(moderation.allowNonOwnersManageAdminAllowList, false)
    },
    textAnnouncementControl: {
      isEnabled: bool(announcements.isEnabled, true),
      playSoundOnEachAnnouncement: bool(announcements.playSoundOnEachAnnouncement, true),
      showAuthorOnEachAnnouncement: bool(announcements.showAuthorOnEachAnnouncement, true)
    },
    videoControl: {
      isEnabled: bool(video.isEnabled, true),
      disableVideoPlayersSound: bool(video.disableVideoPlayersSound, false),
      showAuthorOnVideoPlayers: bool(video.showAuthorOnVideoPlayers, true),
      linkAllVideoPlayers: bool(video.linkAllVideoPlayers, false),
      videoPlayers: entityRefs(video.videoPlayers)
    },
    smartItemsControl: {
      isEnabled: bool(smartItems.isEnabled, true),
      linkAllSmartItems: bool(smartItems.linkAllSmartItems, false),
      smartItems: smartItemRefs(smartItems.smartItems)
    },
    rewardsControl: {
      isEnabled: bool(rewards.isEnabled, false),
      rewardItems: entityRefs(rewards.rewardItems)
    }
  }
}

export function adminToolsJson(value: AdminToolsValue): string {
  return JSON.stringify({
    adminPermissions: value.adminPermissions,
    authorizedAdminUsers: {
      me: value.authorizedAdminUsers.me,
      sceneOwners: value.authorizedAdminUsers.sceneOwners,
      allowList: value.authorizedAdminUsers.allowList,
      adminAllowList: value.authorizedAdminUsers.adminAllowList
    },
    moderationControl: {
      isEnabled: value.moderationControl.isEnabled,
      kickCoordinates: value.moderationControl.kickCoordinates,
      allowNonOwnersManageAdminAllowList:
        value.moderationControl.allowNonOwnersManageAdminAllowList
    },
    textAnnouncementControl: {
      isEnabled: value.textAnnouncementControl.isEnabled,
      playSoundOnEachAnnouncement: value.textAnnouncementControl.playSoundOnEachAnnouncement,
      showAuthorOnEachAnnouncement: value.textAnnouncementControl.showAuthorOnEachAnnouncement
    },
    videoControl: {
      isEnabled: value.videoControl.isEnabled,
      disableVideoPlayersSound: value.videoControl.disableVideoPlayersSound,
      showAuthorOnVideoPlayers: value.videoControl.showAuthorOnVideoPlayers,
      linkAllVideoPlayers: value.videoControl.linkAllVideoPlayers,
      videoPlayers: value.videoControl.videoPlayers
    },
    smartItemsControl: {
      isEnabled: value.smartItemsControl.isEnabled,
      linkAllSmartItems: value.smartItemsControl.linkAllSmartItems,
      smartItems: value.smartItemsControl.smartItems
    },
    rewardsControl: {
      isEnabled: value.rewardsControl.isEnabled,
      rewardItems: value.rewardsControl.rewardItems
    }
  })
}

export interface EntityOption {
  id: number
  label: string
}

export type EntityBag = Record<string, Record<string, unknown>>

// Entity ids the picker offers for a slot: everything carrying `componentName`,
// minus the admin entity itself (linking the panel to itself is never meaningful).
export function entitiesWithComponent(
  snapshot: EntityBag,
  componentName: string,
  nameOf: (id: string) => string | undefined,
  exclude?: string
): EntityOption[] {
  return Object.entries(snapshot)
    .filter(([id, components]) => id !== exclude && components[componentName] !== undefined)
    .map(([id]) => ({ id: Number(id), label: `#${id} ${nameOf(id) ?? ''}`.trim() }))
    .filter((option) => Number.isFinite(option.id))
    .sort((a, b) => a.id - b.id)
}

// Action names authored on a target entity, for the smart item's default action.
export function actionNames(components: Record<string, unknown> | undefined): string[] {
  const actions = components?.[ACTIONS_COMPONENT]
  const list = isRecord(actions) ? actions.value : undefined
  if (!Array.isArray(list)) return []
  return list
    .filter(isRecord)
    .map((action) => str(action.name))
    .filter((name) => name !== '')
}

export function suggestedName(
  option: EntityOption | undefined,
  fallbackIndex: number,
  prefix: string
): string {
  if (option === undefined) return `${prefix} ${fallbackIndex + 1}`
  const label = option.label.replace(/^#\d+\s*/, '').trim()
  return label === '' ? `${prefix} ${fallbackIndex + 1}` : label
}
