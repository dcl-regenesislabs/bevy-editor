import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { Key } from '@dcl/sdk/react-ecs'
import type { SceneAdmin, SceneBanUser } from '../../api'
import { deleteSceneBan } from './api'
import type { ModerationIcons } from './icons'
import {
  clampPage,
  moderationView,
  ModerationView,
  openView,
  pageCount,
  showMessage,
  USERS_PER_PAGE
} from './state'
import {
  ADDRESS_GRAY,
  BADGE_GRAY,
  BLACK,
  Button,
  DANGER,
  Divider,
  ListHeader,
  WHITE
} from './ui'
import { addressOf, displayName, userName } from './utils'

export enum UserListType {
  ADMIN = 'admin',
  BAN = 'ban'
}

interface Props {
  type: UserListType
  users: Array<SceneAdmin | SceneBanUser>
  icons: ModerationIcons
  canManage: boolean
  onChanged: () => void
}

function counterText(type: UserListType, count: number): string {
  if (type === UserListType.ADMIN) return `(${count} ${count === 1 ? 'admin' : 'admins'})`
  return `(${count} ${count === 1 ? 'user' : 'users'})`
}

function canRemove(user: SceneAdmin | SceneBanUser): boolean {
  return 'canBeRemoved' in user ? user.canBeRemoved : true
}

function UserRow(props: {
  key?: Key
  user: SceneAdmin | SceneBanUser
  type: UserListType
  icons: ModerationIcons
  canManage: boolean
  onAction: (user: SceneAdmin | SceneBanUser) => void
}): ReactEcs.JSX.Element {
  const name = userName(props.user)
  const address = addressOf(props.user)
  const isOwner = props.type === UserListType.ADMIN && !canRemove(props.user)
  const showAction = props.canManage && (props.type === UserListType.BAN || canRemove(props.user))
  return (
    <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column' }}>
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 46,
          flexDirection: 'row',
          alignItems: 'center',
          padding: { left: 4, right: 4 }
        }}
      >
        <UiEntity
          uiTransform={{ width: 24, height: 24, flexShrink: 0, margin: { right: 8 } }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: props.icons.person },
            color: WHITE
          }}
        />
        <UiEntity
          uiTransform={{ flexGrow: 1, height: '100%', flexDirection: 'column', justifyContent: 'center' }}
        >
          {name === '' ? null : (
            <UiEntity uiTransform={{ height: 18, flexDirection: 'row', alignItems: 'center' }}>
              <Label value={`<b>${name}</b>`} fontSize={14} color={WHITE} />
              {name.includes('#') ? null : (
                <UiEntity
                  uiTransform={{ width: 13, height: 13, flexShrink: 0, margin: { left: 4 } }}
                  uiBackground={{
                    textureMode: 'stretch',
                    texture: { src: props.icons.verified },
                    color: WHITE
                  }}
                />
              )}
              {isOwner ? (
                <UiEntity
                  uiTransform={{
                    height: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 4,
                    margin: { left: 8 },
                    padding: { left: 5, right: 5 }
                  }}
                  uiBackground={{ color: BADGE_GRAY }}
                >
                  <Label value="<b>Owner</b>" fontSize={11} color={BLACK} />
                </UiEntity>
              ) : null}
            </UiEntity>
          )}
          <Label
            value={address}
            fontSize={name === '' ? 13 : 11}
            color={name === '' ? WHITE : ADDRESS_GRAY}
            textAlign="middle-left"
            uiTransform={{ height: 16 }}
          />
        </UiEntity>
        {showAction ? (
          <Button
            label={props.type === UserListType.ADMIN ? 'Remove' : 'Unban'}
            variant="text"
            color={DANGER}
            fontSize={14}
            onClick={() => props.onAction(props.user)}
            uiTransform={{ width: 78, height: 32, flexShrink: 0 }}
          />
        ) : null}
      </UiEntity>
      <Divider uiTransform={{ margin: { top: 0, bottom: 0 } }} />
    </UiEntity>
  )
}

export function UsersList(props: Props): ReactEcs.JSX.Element {
  const page = clampPage(props.users.length)
  const pages = pageCount(props.users.length)
  const start = (page - 1) * USERS_PER_PAGE
  const visible = props.users.slice(start, start + USERS_PER_PAGE)
  const isAdminList = props.type === UserListType.ADMIN

  const onAction = (user: SceneAdmin | SceneBanUser): void => {
    if (isAdminList) {
      moderationView.adminToRemove = 'address' in user ? user : null
      moderationView.view = ModerationView.CONFIRM_REMOVE
      return
    }
    const address = addressOf(user)
    const label = displayName(user)
    void deleteSceneBan(address).then(([failure]) => {
      showMessage(
        failure === null
          ? `${label} has been unbanned from your scene`
          : 'We were unable to unban this user'
      )
      if (failure === null) props.onChanged()
    })
  }

  return (
    <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column' }}>
      <ListHeader
        icon={isAdminList ? props.icons.verified : props.icons.ban}
        title={isAdminList ? 'ADMIN LIST' : 'SCENE BAN LIST'}
        counter={counterText(props.type, props.users.length)}
        closeIcon={props.icons.close}
        onClose={() => openView(ModerationView.MAIN)}
      />
      {props.users.length === 0 ? (
        <Label
          value={isAdminList ? 'No admins yet.' : 'Nobody is banned from this scene.'}
          fontSize={14}
          color={BADGE_GRAY}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 40 }}
        />
      ) : null}
      {visible.map((user) => (
        <UserRow
          key={addressOf(user)}
          user={user}
          type={props.type}
          icons={props.icons}
          canManage={props.canManage}
          onAction={onAction}
        />
      ))}
      {props.users.length > USERS_PER_PAGE ? (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 44,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            margin: { top: 10 }
          }}
        >
          <Button
            label="Prev"
            variant="secondary"
            icon={props.icons.chevronBack}
            disabled={page <= 1}
            fontSize={14}
            onClick={() => {
              moderationView.page = page - 1
            }}
            uiTransform={{ width: 104, height: 36 }}
          />
          <Label value={`${page} / ${pages}`} fontSize={14} color={WHITE} />
          <Button
            label="Next"
            variant="secondary"
            iconRight={props.icons.chevronForward}
            disabled={page >= pages}
            fontSize={14}
            onClick={() => {
              moderationView.page = page + 1
            }}
            uiTransform={{ width: 104, height: 36 }}
          />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}
