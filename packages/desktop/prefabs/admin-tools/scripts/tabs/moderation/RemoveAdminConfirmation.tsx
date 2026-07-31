import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { SceneAdmin } from '../../api'
import { deleteSceneAdmin } from './api'
import type { ModerationIcons } from './icons'
import { moderationView, ModerationView, openView, showMessage } from './state'
import { BADGE_GRAY, Button, ErrorLine, WHITE } from './ui'
import { displayName } from './utils'

interface Props {
  admin: SceneAdmin
  icons: ModerationIcons
  onChanged: () => void
}

export function RemoveAdminConfirmation(props: Props): ReactEcs.JSX.Element {
  const label = displayName(props.admin)

  const confirm = async (): Promise<void> => {
    if (moderationView.removing) return
    moderationView.removing = true
    const [failure] = await deleteSceneAdmin(props.admin.address)
    moderationView.removing = false
    if (failure !== null) {
      moderationView.removeError = failure
      return
    }
    showMessage(`${label} is no longer an admin`)
    openView(ModerationView.ADMIN_LIST)
    props.onChanged()
  }

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 'auto',
        flexDirection: 'column',
        alignItems: 'center'
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto' }}
        uiText={{
          value: `Are you sure you want to remove <b><color=#FF2D55>${label}</color></b> from the Admin list?`,
          fontSize: 16,
          color: WHITE,
          textAlign: 'top-left'
        }}
      />
      <Label
        value="If you proceed, they will lose access to the Admin Tools for this scene."
        fontSize={13}
        color={BADGE_GRAY}
        textAlign="middle-left"
        uiTransform={{ width: '100%', height: 'auto', margin: { top: 10, bottom: 16 } }}
      />
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 42,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center'
        }}
      >
        <Button
          label="Cancel"
          variant="secondary"
          disabled={moderationView.removing}
          onClick={() => openView(ModerationView.ADMIN_LIST)}
          uiTransform={{ width: 120, height: 40, margin: { right: 12 } }}
        />
        <Button
          label={moderationView.removing ? 'Removing...' : 'Remove'}
          variant="danger"
          color={WHITE}
          disabled={moderationView.removing}
          onClick={() => {
            void confirm()
          }}
          uiTransform={{ width: 160, height: 40 }}
        />
      </UiEntity>
      {moderationView.removeError === '' ? null : (
        <ErrorLine
          icon={props.icons.error}
          text={moderationView.removeError}
          uiTransform={{ margin: { top: 14 } }}
        />
      )}
    </UiEntity>
  )
}
