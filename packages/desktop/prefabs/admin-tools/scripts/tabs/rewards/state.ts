// Per-tab UI state. The shared AdminState only carries the selected airdrop, so
// the in-flight claim (busy flag, feedback line, captcha challenge) lives here —
// one panel per scene, so a module singleton is enough.
import type { PendingCaptcha } from './claim'

export type StatusTone = 'info' | 'error' | 'success'

export interface RewardsTabState {
  busy: boolean
  status: string
  tone: StatusTone
  pending: PendingCaptcha | null
  answer: string
}

export const rewardsTabState: RewardsTabState = {
  busy: false,
  status: '',
  tone: 'info',
  pending: null,
  answer: ''
}

export function setStatus(status: string, tone: StatusTone = 'info'): void {
  rewardsTabState.status = status
  rewardsTabState.tone = tone
}

export function clearCaptcha(): void {
  rewardsTabState.pending = null
  rewardsTabState.answer = ''
}
