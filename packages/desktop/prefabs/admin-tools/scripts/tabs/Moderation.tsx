import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { SceneAdmin, SceneBanUser } from '../api'
import { TabId } from '../state'
import type { TabComponent, TabProps, TabSpec } from '../types'
import { Card, CardHeader } from '../ui'
import { AddUserInput, PermissionType } from './moderation/AddUserInput'
import { moderationIcons } from './moderation/icons'
import { RemoveAdminConfirmation } from './moderation/RemoveAdminConfirmation'
import {
  currentMessage,
  moderationView,
  ModerationView,
  openView
} from './moderation/state'
import { BADGE_GRAY, BLACK, Button, Divider } from './moderation/ui'
import { UsersList, UserListType } from './moderation/UsersList'
import { canManageAdmins, refreshAdmins, refreshBans } from './moderation/utils'

const MANAGE_HINT =
  'Only the scene owner can change the admin list. Enable "Allow non-owners to manage the admin list" on the Admin Tools item to open it up.'

export const Moderation: TabComponent = (props: TabProps) => {
  const icons = moderationIcons(props.assetBase)
  const canManage = canManageAdmins(props.config, props.state.admins, props.player)
  const message = currentMessage()

  ReactEcs.useEffect(() => {
    openView(ModerationView.MAIN)
  }, [])

  const loadAdmins = (): void => {
    void refreshAdmins(props.state, props.bus)
  }
  const syncAdmins = (): void => {
    void refreshAdmins(props.state, props.bus, true)
  }
  const loadBans = (): void => {
    void refreshBans(props.state)
  }

  const admins: Array<SceneAdmin | SceneBanUser> = props.state.admins
  const bans: Array<SceneAdmin | SceneBanUser> = props.state.bans

  const body = (): ReactEcs.JSX.Element => {
    const pendingRemoval = moderationView.adminToRemove
    if (moderationView.view === ModerationView.CONFIRM_REMOVE && pendingRemoval !== null) {
      return (
        <RemoveAdminConfirmation admin={pendingRemoval} icons={icons} onChanged={syncAdmins} />
      )
    }

    if (
      moderationView.view === ModerationView.ADMIN_LIST ||
      moderationView.view === ModerationView.CONFIRM_REMOVE
    ) {
      return (
        <UsersList
          type={UserListType.ADMIN}
          users={admins}
          icons={icons}
          canManage={canManage}
          onChanged={syncAdmins}
        />
      )
    }

    if (moderationView.view === ModerationView.BAN_LIST) {
      return (
        <UsersList
          type={UserListType.BAN}
          users={bans}
          icons={icons}
          canManage
          onChanged={loadBans}
        />
      )
    }

    return (
      <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column' }}>
        <AddUserInput
          type={PermissionType.ADMIN}
          icons={icons}
          admins={props.state.admins}
          disabled={!canManage}
          disabledHint={MANAGE_HINT}
          allowKick={false}
          onChanged={syncAdmins}
        />
        <Button
          label="View Admin List"
          variant="secondary"
          icon={icons.verified}
          onClick={() => {
            loadAdmins()
            openView(ModerationView.ADMIN_LIST)
          }}
          uiTransform={{ width: 230, height: 40, margin: { top: 12 } }}
        />
        <Divider />
        <AddUserInput
          type={PermissionType.BAN}
          icons={icons}
          admins={props.state.admins}
          disabled={false}
          disabledHint=""
          allowKick
          onChanged={loadBans}
        />
        <Button
          label="View Ban List"
          variant="secondary"
          icon={icons.ban}
          onClick={() => {
            loadBans()
            openView(ModerationView.BAN_LIST)
          }}
          uiTransform={{ width: 230, height: 40, margin: { top: 12 } }}
        />
      </UiEntity>
    )
  }

  return (
    <Card>
      <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column' }}>
        <CardHeader icon={props.icons.headerModeration} title="PERMISSIONS & MODERATION" />
        {body()}
        {message === '' ? null : (
          <UiEntity
            uiTransform={{
              width: '100%',
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              margin: { top: 14 }
            }}
            uiBackground={{ color: BADGE_GRAY }}
          >
            <Label value={message} fontSize={13} color={BLACK} />
          </UiEntity>
        )}
      </UiEntity>
    </Card>
  )
}

export const moderationTab: TabSpec = {
  id: TabId.MODERATION,
  icon: 'tabModeration',
  isEnabled: (config) => config.moderationControl.isEnabled,
  hiddenInPreview: true,
  Component: Moderation
}
