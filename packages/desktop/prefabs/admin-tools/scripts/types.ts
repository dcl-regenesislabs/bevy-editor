// The contract between the panel shell (admin.tsx) and the tab components in
// tabs/. Every tab is a plain function of TabProps returning react-ecs JSX; the
// shell owns the tab bar, mounts exactly one tab at a time and passes the same
// props to all of them. Adding a tab means adding a file that exports a TabSpec
// and listing it in admin.tsx's TABS array — nothing else.
import type { Entity } from '@dcl/sdk/ecs'
import type ReactEcs from '@dcl/sdk/react-ecs'
import type { AdminToolsValue } from './components'
import type { AdminIcons } from './icons'
import type { AdminMessageBus } from './message-bus'
import type { AdminState, TabId } from './state'

export interface AdminPlayer {
  userId: string
  name: string
}

export interface TabProps {
  /** entity the admin prefab is attached to; owns TextAnnouncements + VideoControlState */
  self: Entity
  /** live asset-packs::AdminTools value authored in the inspector */
  config: AdminToolsValue
  /** mutable panel state — mutate in place, the next frame re-renders */
  state: AdminState
  /** prefab-relative texture paths */
  icons: AdminIcons
  /** the placed prefab's folder ('' when the scene root is the prefab folder) */
  assetBase: string
  /** wallet-validated command bus; null before initialisation completes */
  bus: AdminMessageBus | null
  /** the local player, or null while the profile is still loading */
  player: AdminPlayer | null
}

export type TabComponent = (props: TabProps) => ReactEcs.JSX.Element | null

export interface TabSpec {
  id: TabId
  /** tab-bar button texture; the panel header is the tab's own to render */
  icon: keyof AdminIcons
  /** whether the creator switched this control on in the inspector */
  isEnabled: (config: AdminToolsValue) => boolean
  /** hide the tab in local preview (moderation needs a signed identity) */
  hiddenInPreview?: boolean
  Component: TabComponent
}
