// Tab-scoped state. The shared AdminState carries the selected screen index (and
// nothing else this tab needs), while everything below outlives a tab remount and
// is deliberately module-level: the panel is a singleton, and hook state resets
// every time the shell re-mounts the tab.
import type { CastParticipant, CastRoom } from './api'

export type MediaSource = 'video-url' | 'live' | 'dcl-cast'

export interface VideoTabState {
  source: MediaSource | undefined
  streamKeyLoaded: boolean
  hasStreamKey: boolean
  streamKeyEndsAt: number
  revealedKey: string
  revealUntil: number
  confirmReset: boolean
  castRoom: CastRoom | undefined
  castError: string
  castMinimized: boolean
  participants: CastParticipant[]
  activeTrackSid: string | undefined
  showSpeakers: boolean
  copiedAt: Map<string, number>
  error: string
}

export const videoTab: VideoTabState = {
  source: undefined,
  streamKeyLoaded: false,
  hasStreamKey: false,
  streamKeyEndsAt: 0,
  revealedKey: '',
  revealUntil: 0,
  confirmReset: false,
  castRoom: undefined,
  castError: '',
  castMinimized: false,
  participants: [],
  activeTrackSid: undefined,
  showSpeakers: false,
  copiedAt: new Map(),
  error: ''
}

export const REVEAL_SECONDS = 30
const FEEDBACK_MS = 1500

export function markCopied(id: string): void {
  videoTab.copiedAt.set(id, Date.now())
}

export function wasCopied(id: string): boolean {
  const at = videoTab.copiedAt.get(id)
  return at !== undefined && Date.now() - at < FEEDBACK_MS
}

export function revealKey(key: string): void {
  videoTab.revealedKey = key
  videoTab.revealUntil = Date.now() + REVEAL_SECONDS * 1000
}

export function hideKey(): void {
  videoTab.revealedKey = ''
  videoTab.revealUntil = 0
}

// The UI re-renders every frame, so "is the key still visible" is a function of
// the clock — no timer system, no cleanup to leak. Expiry also drops the key from
// memory, which is the point of the auto-hide.
export function revealRemaining(): number {
  if (videoTab.revealedKey === '') return 0
  const remaining = (videoTab.revealUntil - Date.now()) / 1000
  if (remaining <= 0) {
    hideKey()
    return 0
  }
  return remaining
}

export function isKeyVisible(): boolean {
  return revealRemaining() > 0
}
