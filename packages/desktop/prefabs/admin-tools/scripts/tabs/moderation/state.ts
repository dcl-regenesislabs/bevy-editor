// View state for the moderation tab. It lives at module scope rather than in
// ReactEcs.useState because the shell unmounts the tab body on every tab switch
// (state.ts nextTick trick) — a list the admin paged into would otherwise reset.
// Same reason the Creator Hub keeps `moderationControlState` outside the tree.
import type { SceneAdmin } from '../../api'

export enum ModerationView {
  MAIN = 'main',
  ADMIN_LIST = 'admin_list',
  BAN_LIST = 'ban_list',
  CONFIRM_REMOVE = 'confirm_remove'
}

export const USERS_PER_PAGE = 4
const MESSAGE_MS = 3000

export interface ModerationViewState {
  view: ModerationView
  page: number
  adminToRemove: SceneAdmin | null
  removeError: string
  removing: boolean
  message: string
  messageAt: number
}

export const moderationView: ModerationViewState = {
  view: ModerationView.MAIN,
  page: 1,
  adminToRemove: null,
  removeError: '',
  removing: false,
  message: '',
  messageAt: 0
}

export function openView(view: ModerationView): void {
  moderationView.view = view
  moderationView.page = 1
  moderationView.adminToRemove = null
  moderationView.removeError = ''
  moderationView.removing = false
}

export function showMessage(text: string): void {
  moderationView.message = text
  moderationView.messageAt = Date.now()
}

// Read during render, so the toast disappears on its own without a timer system.
export function currentMessage(): string {
  if (moderationView.message === '') return ''
  if (Date.now() - moderationView.messageAt > MESSAGE_MS) {
    moderationView.message = ''
    return ''
  }
  return moderationView.message
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / USERS_PER_PAGE))
}

export function clampPage(total: number): number {
  const pages = pageCount(total)
  if (moderationView.page > pages) moderationView.page = pages
  if (moderationView.page < 1) moderationView.page = 1
  return moderationView.page
}
