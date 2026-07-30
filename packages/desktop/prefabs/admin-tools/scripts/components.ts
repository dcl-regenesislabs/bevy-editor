// The asset-packs:: components this prefab reads and writes, defined on the scene
// engine. A component's numeric id is derived from its name, so these decode the
// exact bytes the editor authored — but FIELD ORDER MATTERS (Schemas.Map serializes
// in insertion order), so every spec here is a verbatim copy of the editor registry
// in packages/scene/src/custom-registry.ts, which itself mirrors the Creator Hub.
import { engine, Schemas } from '@dcl/sdk/ecs'

export enum AdminPermissions {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE'
}

export enum MediaSource {
  VideoURL,
  LiveStream
}

export const Actions = engine.defineComponent('asset-packs::Actions', {
  id: Schemas.Int,
  value: Schemas.Array(
    Schemas.Map({
      name: Schemas.String,
      type: Schemas.String,
      jsonPayload: Schemas.String,
      allowedInBasicView: Schemas.Optional(Schemas.Boolean),
      basicViewId: Schemas.Optional(Schemas.String),
      default: Schemas.Optional(Schemas.Boolean)
    })
  )
})

export const States = engine.defineComponent('asset-packs::States', {
  id: Schemas.Number,
  value: Schemas.Array(Schemas.String),
  defaultValue: Schemas.Optional(Schemas.String),
  currentValue: Schemas.Optional(Schemas.String),
  previousValue: Schemas.Optional(Schemas.String)
})

export const AdminTools = engine.defineComponent('asset-packs::AdminTools', {
  adminPermissions: Schemas.EnumString<AdminPermissions>(AdminPermissions, AdminPermissions.PUBLIC),
  authorizedAdminUsers: Schemas.Map({
    me: Schemas.Boolean,
    sceneOwners: Schemas.Boolean,
    allowList: Schemas.Boolean,
    adminAllowList: Schemas.Array(Schemas.String)
  }),
  moderationControl: Schemas.Map({
    isEnabled: Schemas.Boolean,
    kickCoordinates: Schemas.Map({
      x: Schemas.Number,
      y: Schemas.Number,
      z: Schemas.Number
    }),
    allowNonOwnersManageAdminAllowList: Schemas.Boolean
  }),
  textAnnouncementControl: Schemas.Map({
    isEnabled: Schemas.Boolean,
    playSoundOnEachAnnouncement: Schemas.Boolean,
    showAuthorOnEachAnnouncement: Schemas.Boolean
  }),
  videoControl: Schemas.Map({
    isEnabled: Schemas.Boolean,
    disableVideoPlayersSound: Schemas.Boolean,
    showAuthorOnVideoPlayers: Schemas.Boolean,
    linkAllVideoPlayers: Schemas.Boolean,
    videoPlayers: Schemas.Optional(
      Schemas.Array(
        Schemas.Map({
          entity: Schemas.Int,
          customName: Schemas.String
        })
      )
    )
  }),
  smartItemsControl: Schemas.Map({
    isEnabled: Schemas.Boolean,
    linkAllSmartItems: Schemas.Boolean,
    smartItems: Schemas.Optional(
      Schemas.Array(
        Schemas.Map({
          entity: Schemas.Int,
          customName: Schemas.String,
          defaultAction: Schemas.String
        })
      )
    )
  }),
  rewardsControl: Schemas.Map({
    isEnabled: Schemas.Boolean,
    rewardItems: Schemas.Optional(
      Schemas.Array(
        Schemas.Map({
          entity: Schemas.Int,
          customName: Schemas.String
        })
      )
    )
  })
})

export const VideoScreen = engine.defineComponent('asset-packs::VideoScreen', {
  thumbnail: Schemas.String,
  defaultMediaSource: Schemas.EnumNumber<MediaSource>(MediaSource, MediaSource.VideoURL),
  defaultURL: Schemas.String
})

export const Rewards = engine.defineComponent('asset-packs::Rewards', {
  campaignId: Schemas.String,
  dispenserKey: Schemas.String,
  testMode: Schemas.Boolean
})

export const TextAnnouncements = engine.defineComponent('asset-packs::TextAnnouncements', {
  text: Schemas.String,
  author: Schemas.Optional(Schemas.String),
  id: Schemas.String
})

export const VideoControlState = engine.defineComponent('asset-packs::VideoControlState', {
  endsAt: Schemas.Optional(Schemas.Int64),
  streamKey: Schemas.Optional(Schemas.String)
})

// syncEntity needs a network id every client agrees on before any of them has
// seen the scene. The editor allocates scene entities from 8001 up, so 8000 is
// reserved for the admin entity's shared video state (same value the Hub uses).
export const VIDEO_CONTROL_SYNC_ID = 8000

// Plain mirrors of the schemas above. The component getters return DeepReadonly
// views; these are what the tabs and the message bus pass around.
export interface ActionEntry {
  name: string
  type: string
  jsonPayload: string
}

// Everything is readonly because this is what AdminTools.get() hands back
// (DeepReadonly of the schema) — the tabs receive that value directly, no cast.
export interface VideoPlayerRef {
  readonly entity: number
  readonly customName: string
}

export interface SmartItemRef {
  readonly entity: number
  readonly customName: string
  readonly defaultAction: string
}

export interface RewardItemRef {
  readonly entity: number
  readonly customName: string
}

export interface AdminToolsValue {
  readonly adminPermissions: AdminPermissions
  readonly authorizedAdminUsers: {
    readonly me: boolean
    readonly sceneOwners: boolean
    readonly allowList: boolean
    readonly adminAllowList: readonly string[]
  }
  readonly moderationControl: {
    readonly isEnabled: boolean
    readonly kickCoordinates: { readonly x: number; readonly y: number; readonly z: number }
    readonly allowNonOwnersManageAdminAllowList: boolean
  }
  readonly textAnnouncementControl: {
    readonly isEnabled: boolean
    readonly playSoundOnEachAnnouncement: boolean
    readonly showAuthorOnEachAnnouncement: boolean
  }
  readonly videoControl: {
    readonly isEnabled: boolean
    readonly disableVideoPlayersSound: boolean
    readonly showAuthorOnVideoPlayers: boolean
    readonly linkAllVideoPlayers: boolean
    readonly videoPlayers?: readonly VideoPlayerRef[]
  }
  readonly smartItemsControl: {
    readonly isEnabled: boolean
    readonly linkAllSmartItems: boolean
    readonly smartItems?: readonly SmartItemRef[]
  }
  readonly rewardsControl: {
    readonly isEnabled: boolean
    readonly rewardItems?: readonly RewardItemRef[]
  }
}
