// Everything that mutates a video screen goes through the admin message bus, so
// the change is validated against the sender's wallet on every client instead of
// riding the CRDT channel. Local-only writes here would desync the scene.
import { engine, Name, VideoPlayer, type Entity } from '@dcl/sdk/ecs'
import type { AdminToolsValue, VideoPlayerRef } from '../../components'
import type { AdminMessageBus, VideoState } from '../../message-bus'

export const LIVEKIT_STREAM_SRC = 'livekit-video://current-stream'
export const CAST_SRC_PREFIX = 'livekit-video://'
export const VIDEO_URL_PREFIX = 'https://'
export const DEFAULT_VOLUME = 1
export const VOLUME_STEP = 0.1

export interface VideoScreenRef {
  entity: Entity
  customName: string
}

export interface VideoControls {
  play: () => void
  pause: () => void
  restart: () => void
  setSource: (src: string) => void
  setLoop: (loop: boolean) => void
  stepVolume: (step: number) => void
  setVolume: (volume: number) => void
}

function entityName(entity: Entity, index: number): string {
  const named = Name.getOrNull(entity)
  if (named !== null && named.value !== '') return named.value
  return `Screen ${index + 1}`
}

// `linkAllVideoPlayers` puts every screen in the scene under admin control; the
// authored list still wins on naming and ordering.
export function managedScreens(config: AdminToolsValue): VideoScreenRef[] {
  const authored: readonly VideoPlayerRef[] = config.videoControl.videoPlayers ?? []
  const screens: VideoScreenRef[] = authored.map((ref, index) => ({
    entity: ref.entity as Entity,
    customName: ref.customName !== '' ? ref.customName : entityName(ref.entity as Entity, index)
  }))
  if (!config.videoControl.linkAllVideoPlayers) return screens

  const known = new Set(screens.map((screen) => screen.entity))
  for (const [entity] of engine.getEntitiesWith(VideoPlayer)) {
    if (known.has(entity)) continue
    known.add(entity)
    screens.push({ entity, customName: entityName(entity, screens.length) })
  }
  return screens
}

// A cast room and a plain RTMP stream share `livekit-video://current-stream`, so
// src alone cannot tell them apart — callers break the tie with the media source
// the admin picked, exactly like the Hub's `selectedStream`.
export function isCastSource(src: string): boolean {
  return src.startsWith(CAST_SRC_PREFIX)
}

export function isLiveSource(src: string): boolean {
  return src === LIVEKIT_STREAM_SRC
}

export function isVideoUrl(src: string): boolean {
  return src.startsWith(VIDEO_URL_PREFIX)
}

export function volumeOf(entity: Entity): number {
  return VideoPlayer.getOrNull(entity)?.volume ?? DEFAULT_VOLUME
}

// Sound-off scenes never want an unmuted screen, not even for the admin who
// opened the panel — mute on sight, the same check the Hub runs per render.
export function enforceMute(screens: VideoScreenRef[]): void {
  for (const screen of screens) {
    const video = VideoPlayer.getOrNull(screen.entity)
    if (video === null || video.volume === 0) continue
    VideoPlayer.getMutable(screen.entity).volume = 0
  }
}

export function createControls(
  bus: AdminMessageBus | null,
  entity: Entity,
  soundDisabled: boolean
): VideoControls {
  const send = (command: Partial<VideoState>): void => {
    bus?.setVideo(entity, command)
  }
  return {
    play: () => send({ playing: true }),
    pause: () => send({ playing: false }),
    restart: () => send({ playing: true, position: 0 }),
    setSource: (src) => send({ src, playing: true }),
    setLoop: (loop) => send({ loop }),
    stepVolume: (step) => {
      if (soundDisabled) return
      const steps = Math.round(volumeOf(entity) * 10)
      const next = Math.max(0, Math.min(10, steps + Math.round(step * 10)))
      send({ volume: next / 10 })
    },
    setVolume: (volume) => {
      if (soundDisabled) return
      send({ volume })
    }
  }
}
