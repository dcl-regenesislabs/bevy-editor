// Announcement state the shared AdminState does not carry: the per-author rate
// tracker (the Creator Hub declares `messageRateTracker` but never reads it — it
// is enforced here), the composer's transient feedback line, and the set of
// announcement ids the local player dismissed on the overlay.
import type { AdminState } from '../../state'

export const ANNOUNCEMENT_MAX_LENGTH = 90
export const ANNOUNCEMENT_COOLDOWN_MS = 3000

export type AnnouncementFeedback = 'sent' | 'cleared' | 'empty' | 'throttled'

export interface AnnouncementUiState {
  feedback: AnnouncementFeedback | undefined
  throttledFor: number
  inputResetSeq: number
  rateTracker: Map<string, number>
  dismissed: Set<string>
}

export const announcementUi: AnnouncementUiState = {
  feedback: undefined,
  throttledFor: 0,
  inputResetSeq: 0,
  rateTracker: new Map(),
  dismissed: new Set()
}

export function cooldownRemaining(author: string, now: number): number {
  const last = announcementUi.rateTracker.get(author)
  if (last === undefined) return 0
  return Math.max(0, ANNOUNCEMENT_COOLDOWN_MS - (now - last))
}

export function recordSend(author: string, now: number): void {
  announcementUi.rateTracker.set(author, now)
}

export function announcementId(timestamp: number, author: string): string {
  return `${timestamp}-${author}`
}

export interface AnnouncementRecord {
  id: string
  text: string
  author: string
  timestamp: number
}

// The panel history has to pick up announcements made by *other* admins too, so
// it is fed from the synced component rather than from the send handler.
export function recordAnnouncement(state: AdminState, entry: AnnouncementRecord): void {
  if (entry.id === '' || entry.text === '') return
  const list = state.textAnnouncements.announcements
  if (list.some((known) => known.id === entry.id)) return
  list.unshift(entry)
  const max = Math.max(1, state.textAnnouncements.maxAnnouncements)
  if (list.length > max) list.length = max
}

export function feedbackText(feedback: AnnouncementFeedback, throttledFor: number): string {
  switch (feedback) {
    case 'sent':
      return 'Message sent!'
    case 'cleared':
      return 'Message cleared!'
    case 'empty':
      return 'Write an announcement first.'
    default:
      return `Too fast — try again in ${Math.ceil(throttledFor / 1000)}s.`
  }
}
