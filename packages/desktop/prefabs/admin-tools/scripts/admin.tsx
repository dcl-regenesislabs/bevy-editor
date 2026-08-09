import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { engine, VideoPlayer, type Entity } from '@dcl/sdk/ecs'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { listenForKicks } from './tabs/moderation/kick'
import { Color4 } from '@dcl/sdk/math'
import {
  AdminTools,
  TextAnnouncements,
  VideoControlState,
  VIDEO_CONTROL_SYNC_ID,
  type AdminToolsValue
} from './components'
import {
  getSceneAdmins,
  getSceneBans,
  isPreview,
  isSceneAdmin,
  loadRealm,
  toSceneAdmins,
  type SceneAdmin
} from './api'
import { adminIcons, assetBase, type AdminIcons } from './icons'
import { initAdminMessageBus, type AdminMessageBus } from './message-bus'
import { createAdminState, drainNextTick, nextTick, TabId, type AdminState } from './state'
import type { AdminPlayer, TabProps, TabSpec } from './types'
import { IconButton, PANEL_BACKGROUND, PANEL_WIDTH, TEXT_DIM } from './ui'
import { claimUiRenderer, VIRTUAL_CANVAS } from './ui-owner'
import { moderationTab } from './tabs/Moderation'
import { rewardsTab } from './tabs/Rewards'
import { smartItemActionsTab } from './tabs/SmartItemActions'
import { AnnouncementOverlay, textAnnouncementsTab } from './tabs/TextAnnouncements'
import { videoControlTab } from './tabs/VideoControl'

const TABS: TabSpec[] = [
  moderationTab,
  videoControlTab,
  smartItemActionsTab,
  textAnnouncementsTab,
  rewardsTab
]

function videoPlayerEntities(): Entity[] {
  return Array.from(engine.getEntitiesWith(VideoPlayer)).map(([entity]) => entity)
}

function toAdminPlayer(): AdminPlayer | null {
  const player = getPlayer()
  if (player === null) return null
  return { userId: player.userId, name: player.name }
}

export class AdminToolsScript {
  private readonly state: AdminState = createAdminState()
  private readonly base: string
  private readonly icons: AdminIcons
  private bus: AdminMessageBus | null = null
  private ready = false

  constructor(
    public src: string,
    public entity: Entity
  ) {
    this.base = assetBase(src)
    this.icons = adminIcons(this.base)
  }

  start(): void {
    // Not free to skip: a realm lookup, two admin fetches, a comms subscription
    // and a UI diff every frame.
    if (isServer()) { return }
    // Before the renderer claim on purpose: the player being kicked is not the
    // admin looking at the panel, so their client mounts none of this UI.
    listenForKicks()
    if (!claimUiRenderer('admin-tools')) return

    if (TextAnnouncements.getOrNull(this.entity) === null) {
      TextAnnouncements.create(this.entity, { text: '', author: '', id: '' })
    }
    if (VideoControlState.getOrNull(this.entity) === null) {
      VideoControlState.create(this.entity)
    }
    syncEntity(this.entity, [VideoControlState.componentId], VIDEO_CONTROL_SYNC_ID)

    engine.addSystem(drainNextTick, Number.POSITIVE_INFINITY)

    void this.initialize()
  }

  private async initialize(): Promise<void> {
    await loadRealm()
    await this.refreshAdmins()
    await this.refreshBans()

    this.bus = initAdminMessageBus({
      self: this.entity,
      admins: this.state.admins,
      videoEntities: videoPlayerEntities(),
      onRefetchAdmins: () => {
        void this.refreshAdmins()
      }
    })

    this.ready = true
    ReactEcsRenderer.setUiRenderer(() => this.render(), VIRTUAL_CANVAS)
  }

  private async refreshAdmins(): Promise<void> {
    const [error, response] = await getSceneAdmins()
    const admins: SceneAdmin[] = error === null ? toSceneAdmins(response) : []
    this.state.admins = admins
    this.bus?.updateAdminList(admins)
  }

  private async refreshBans(): Promise<void> {
    const [error, response] = await getSceneBans()
    this.state.bans = error === null && Array.isArray(response.results) ? response.results : []
  }

  private visibleTabs(config: AdminToolsValue): TabSpec[] {
    return TABS.filter(
      (tab) => tab.isEnabled(config) && !(tab.hiddenInPreview === true && isPreview())
    )
  }

  private selectTab(id: TabId): void {
    if (this.state.activeTab === id) {
      this.state.activeTab = TabId.NONE
      return
    }
    this.state.activeTab = TabId.NONE
    nextTick(() => {
      this.state.activeTab = id
    })
  }

  private render(): ReactEcs.JSX.Element | null {
    const config: AdminToolsValue | null = AdminTools.getOrNull(this.entity)
    if (config === null || !this.ready) return null

    const player = toAdminPlayer()

    return (
      <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%' }}>
        <AnnouncementOverlay
          self={this.entity}
          config={config}
          assetBase={this.base}
          state={this.state}
        />
        {isSceneAdmin(this.state.admins, player?.userId) ? this.panel(config, player) : null}
      </UiEntity>
    )
  }

  private panel(config: AdminToolsValue, player: AdminPlayer | null): ReactEcs.JSX.Element {
    const tabs = this.visibleTabs(config)
    const active = tabs.find((tab) => tab.id === this.state.activeTab)
    const ActiveTab = active?.Component
    const props: TabProps = {
      self: this.entity,
      config,
      state: this.state,
      icons: this.icons,
      assetBase: this.base,
      bus: this.bus,
      player
    }

    return (
      <UiEntity
        uiTransform={{
          positionType: 'absolute',
          flexDirection: 'row',
          position: { top: 120, right: 14 }
        }}
      >
        <UiEntity
          uiTransform={{
            display: this.state.panelOpen ? 'flex' : 'none',
            width: PANEL_WIDTH,
            flexDirection: 'column',
            pointerFilter: 'block',
            margin: { right: 8 }
          }}
        >
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 50,
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: 12,
              padding: { left: 12, right: 12 }
            }}
            uiBackground={{ color: PANEL_BACKGROUND }}
          >
            <Label
              value="ADMIN TOOLS"
              fontSize={20}
              color={TEXT_DIM}
              textAlign="middle-left"
              uiTransform={{ flexGrow: 1 }}
            />
            {tabs.map((tab) => (
              <IconButton
                key={tab.id}
                icon={this.icons[tab.icon]}
                active={this.state.activeTab === tab.id}
                onClick={() => this.selectTab(tab.id)}
              />
            ))}
          </UiEntity>
          {ActiveTab !== undefined ? <ActiveTab {...props} /> : null}
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: 42,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            pointerFilter: 'block'
          }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: this.icons.panelBackground },
            color: Color4.White()
          }}
          onMouseDown={() => {
            this.state.panelOpen = !this.state.panelOpen
          }}
        >
          <UiEntity
            uiTransform={{ width: 32, height: 32 }}
            uiBackground={{
              textureMode: 'stretch',
              texture: { src: this.icons.panelToggle },
              color: Color4.White()
            }}
          />
        </UiEntity>
      </UiEntity>
    )
  }
}
