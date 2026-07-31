// Wallet-validated admin command bus — port of @dcl/asset-packs
// src/admin-toolkit-ui/admin-message-bus.ts.
//
// Why a second transport: admin-controlled components (VideoPlayer, the
// announcement component) are attractive targets for a forged CRDT write. So
//   1. VideoPlayer is dropped from SyncComponents on admin-controlled entities,
//      which stops attacker CRDT writes from propagating over the binary channel;
//   2. admin commands travel on the TEXT comms channel instead, and every
//      receiver checks the sender's wallet against the scene admin list;
//   3. each client seeds authoritative state from VideoScreen.defaultURL (a
//      deploy-time value that CRDT cannot touch) and a per-frame system reverts
//      anything that drifts from it;
//   4. late joiners ask existing participants for the current state.
//
// Sending goes through communicationsController.send() rather than
// MessageBus.emit(): the class's internal flush queue drops follow-up messages.
// Receiving uses MessageBus.on(), which hooks the global comms observable.
import { engine, SyncComponents, VideoPlayer, type Entity } from '@dcl/sdk/ecs'
import { MessageBus } from '@dcl/sdk/message-bus'
import { onEnterScene } from '@dcl/sdk/players'
import { send as commsSend } from '~system/CommunicationsController'
import { TextAnnouncements, VideoScreen } from './components'
import { isPreview, type SceneAdmin } from './api'

const MSG = {
  SET_VIDEO: 'admin:set-video',
  SET_ANNOUNCEMENT: 'admin:set-announcement',
  CLEAR_ANNOUNCEMENT: 'admin:clear-announcement',
  REQUEST_STATE: 'admin:request-state',
  SYNC_STATE: 'admin:sync-state',
  SYNC_ADMINS: 'admin:sync-admins'
} as const

export interface VideoState {
  src: string
  playing: boolean
  volume: number
  loop: boolean
  // write-only: SET_VIDEO forwards it to the player (restart seeks to 0), it is
  // never part of the authoritative snapshot a late joiner receives.
  position?: number
}

export interface AnnouncementState {
  text: string
  author: string
  id: string
}

export interface AdminMessageBus {
  setVideo: (entity: Entity, props: Partial<VideoState>) => void
  setAnnouncement: (text: string, author?: string, id?: string) => void
  clearAnnouncement: () => void
  syncAdmins: () => void
  updateAdminList: (admins: SceneAdmin[]) => void
}

export interface AdminMessageBusOptions {
  self: Entity
  admins: SceneAdmin[]
  videoEntities: Entity[]
  onRefetchAdmins: () => void
}

type Payload = Record<string, unknown>
type Handler = (payload: Payload, sender: string) => void

function asRecord(value: unknown): Payload {
  return typeof value === 'object' && value !== null ? (value as Payload) : {}
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

let instance: AdminMessageBus | null = null

export function getAdminMessageBus(): AdminMessageBus | null {
  return instance
}

export function initAdminMessageBus(options: AdminMessageBusOptions): AdminMessageBus {
  const { self, videoEntities, onRefetchAdmins } = options
  let sceneAdmins = options.admins

  const authoritativeVideo = new Map<Entity, VideoState>()
  let authoritativeAnnouncement: AnnouncementState = { text: '', author: '', id: '' }
  let adminHasActed = false

  const isAdminWallet = (sender: string): boolean => {
    if (isPreview()) return true
    if (sender === 'self') return true
    return sceneAdmins.some((admin) => admin.address.toLowerCase() === sender.toLowerCase())
  }

  const handlers = new Map<string, Handler>()
  const receiver = new MessageBus()

  const onMessage = (type: string, handler: Handler): void => {
    handlers.set(type, handler)
    receiver.on(type, (value: unknown, sender: string) => handler(asRecord(value), sender))
  }

  const onAdminMessage = (type: string, handler: Handler): void => {
    onMessage(type, (payload, sender) => {
      if (!isAdminWallet(sender)) return
      handler(payload, sender)
    })
  }

  const emitMessage = (type: string, payload: Payload): void => {
    handlers.get(type)?.(payload, 'self')
    commsSend({ message: JSON.stringify({ message: type, payload }) }).catch(() => {})
  }

  for (const entity of videoEntities) {
    const sync = SyncComponents.getMutableOrNull(entity)
    if (sync === null) continue
    sync.componentIds = sync.componentIds.filter((id) => id !== VideoPlayer.componentId)
  }

  for (const entity of videoEntities) {
    const video = VideoPlayer.getOrNull(entity)
    if (video === null) continue
    const screen = VideoScreen.getOrNull(entity)
    const src = screen?.defaultURL !== undefined && screen.defaultURL !== '' ? screen.defaultURL : video.src
    authoritativeVideo.set(entity, {
      src,
      playing: video.playing ?? false,
      volume: video.volume ?? 1,
      loop: video.loop ?? false
    })
    if (video.src !== src) VideoPlayer.getMutable(entity).src = src
  }

  onAdminMessage(MSG.SET_VIDEO, (payload) => {
    const entity = num(payload.entity, 0) as Entity
    const current = VideoPlayer.getOrNull(entity)
    if (current === null) return
    const updated: VideoState = {
      src: str(payload.src, current.src),
      playing: bool(payload.playing, current.playing ?? false),
      volume: num(payload.volume, current.volume ?? 1),
      loop: bool(payload.loop, current.loop ?? false)
    }
    authoritativeVideo.set(entity, updated)
    const video = VideoPlayer.getMutable(entity)
    video.src = updated.src
    video.playing = updated.playing
    video.volume = updated.volume
    video.loop = updated.loop
    if (payload.position !== undefined) video.position = num(payload.position, 0)
    adminHasActed = true
  })

  const applyAnnouncement = (next: AnnouncementState): void => {
    authoritativeAnnouncement = next
    const announcements = TextAnnouncements.getMutableOrNull(self)
    if (announcements === null) return
    announcements.text = next.text
    announcements.author = next.author
    announcements.id = next.id
    adminHasActed = true
  }

  onAdminMessage(MSG.SET_ANNOUNCEMENT, (payload) => {
    applyAnnouncement({
      text: str(payload.text),
      author: str(payload.author),
      id: str(payload.id)
    })
  })

  onAdminMessage(MSG.CLEAR_ANNOUNCEMENT, () => {
    applyAnnouncement({ text: '', author: '', id: '' })
  })

  const broadcastCurrentState = (): void => {
    const video: Payload[] = []
    for (const entity of videoEntities) {
      const current = VideoPlayer.getOrNull(entity)
      if (current === null) continue
      const screen = VideoScreen.getOrNull(entity)
      if (current.src === (screen?.defaultURL ?? '')) continue
      video.push({
        entity: entity as number,
        src: current.src,
        playing: current.playing ?? false,
        volume: current.volume ?? 1,
        loop: current.loop ?? false
      })
    }
    const announcements = TextAnnouncements.getOrNull(self)
    const announcement =
      announcements !== null && announcements.id !== ''
        ? { text: announcements.text, author: announcements.author ?? '', id: announcements.id }
        : null
    if (video.length === 0 && announcement === null) return
    emitMessage(MSG.SYNC_STATE, { video, announcement })
  }

  onAdminMessage(MSG.SYNC_STATE, (payload) => {
    const list = Array.isArray(payload.video) ? payload.video : []
    for (const raw of list) {
      const item = asRecord(raw)
      const entity = num(item.entity, 0) as Entity
      const video = VideoPlayer.getMutableOrNull(entity)
      if (video === null) continue
      const next: VideoState = {
        src: str(item.src, video.src),
        playing: bool(item.playing, video.playing ?? false),
        volume: num(item.volume, video.volume ?? 1),
        loop: bool(item.loop, video.loop ?? false)
      }
      authoritativeVideo.set(entity, next)
      video.src = next.src
      video.playing = next.playing
      video.volume = next.volume
      video.loop = next.loop
    }
    const announcement = asRecord(payload.announcement)
    if (str(announcement.id) !== '') {
      applyAnnouncement({
        text: str(announcement.text),
        author: str(announcement.author),
        id: str(announcement.id)
      })
    }
    adminHasActed = true
  })

  onMessage(MSG.REQUEST_STATE, () => {
    if (adminHasActed) broadcastCurrentState()
  })

  onAdminMessage(MSG.SYNC_ADMINS, () => {
    onRefetchAdmins()
  })

  onEnterScene(() => {
    if (adminHasActed) broadcastCurrentState()
  })

  emitMessage(MSG.REQUEST_STATE, {})

  // Forged CRDT writes bypass SyncComponents (they can be injected straight into
  // LiveKit) but land here. Admin commands update the authoritative maps before
  // touching the components, so a legitimate change is never reverted.
  engine.addSystem(() => {
    for (const [entity, authoritative] of authoritativeVideo) {
      const video = VideoPlayer.getOrNull(entity)
      if (video === null || video.src === authoritative.src) continue
      const mutable = VideoPlayer.getMutable(entity)
      mutable.src = authoritative.src
      mutable.playing = authoritative.playing
    }
    const announcements = TextAnnouncements.getOrNull(self)
    if (
      announcements !== null &&
      authoritativeAnnouncement.id !== '' &&
      announcements.id !== authoritativeAnnouncement.id
    ) {
      const mutable = TextAnnouncements.getMutable(self)
      mutable.text = authoritativeAnnouncement.text
      mutable.author = authoritativeAnnouncement.author
      mutable.id = authoritativeAnnouncement.id
    }
  })

  instance = {
    setVideo(entity, props) {
      emitMessage(MSG.SET_VIDEO, { entity: entity as number, ...props })
    },
    setAnnouncement(text, author, id) {
      emitMessage(MSG.SET_ANNOUNCEMENT, { text, author: author ?? '', id: id ?? '' })
    },
    clearAnnouncement() {
      emitMessage(MSG.CLEAR_ANNOUNCEMENT, {})
    },
    syncAdmins() {
      emitMessage(MSG.SYNC_ADMINS, {})
    },
    updateAdminList(admins) {
      sceneAdmins = admins
    }
  }

  return instance
}
