// Mutable panel state. react-ecs re-renders the whole tree every frame off these
// values, so tabs mutate this object directly rather than holding hook state —
// same model as the Creator Hub's admin-toolkit-ui/index.tsx `state`.
import type { Entity } from '@dcl/sdk/ecs'
import type { SceneAdmin, SceneBanUser } from './api'

export enum TabId {
  NONE = 'none',
  SMART_ITEMS = 'smart_items',
  TEXT_ANNOUNCEMENTS = 'text_announcements',
  VIDEO = 'video',
  MODERATION = 'moderation',
  REWARDS = 'rewards'
}

export interface SmartItemUiState {
  visible: boolean
  selectedAction: string
}

export interface AdminState {
  panelOpen: boolean
  activeTab: TabId
  admins: SceneAdmin[]
  bans: SceneBanUser[]
  smartItems: {
    selectedIndex: number | undefined
    byEntity: Map<Entity, SmartItemUiState>
  }
  video: {
    selectedIndex: number | undefined
  }
  textAnnouncements: {
    draft: string
    announcements: Array<{ id: string; text: string; author: string; timestamp: number }>
    maxAnnouncements: number
  }
  rewards: {
    selectedIndex: number | undefined
  }
}

export function createAdminState(): AdminState {
  return {
    panelOpen: false,
    activeTab: TabId.NONE,
    admins: [],
    bans: [],
    smartItems: { selectedIndex: undefined, byEntity: new Map() },
    video: { selectedIndex: undefined },
    textAnnouncements: { draft: '', announcements: [], maxAnnouncements: 4 },
    rewards: { selectedIndex: undefined }
  }
}

// react-ecs renders synchronously inside a system, so a state change made from a
// click handler is only visible next frame. Deferring the "close then open" of a
// tab through this queue is what makes tab switching re-mount the panel body,
// which the Hub relies on to reset per-tab widgets.
export const nextTickQueue: Array<() => void> = []

export function nextTick(fn: () => void): void {
  nextTickQueue.push(fn)
}

export function drainNextTick(): void {
  const fn = nextTickQueue.shift()
  if (fn !== undefined) fn()
}
