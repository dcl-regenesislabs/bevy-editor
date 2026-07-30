import ReactEcs, { Input, Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { SceneAdmin } from '../../api'
import { postSceneAdmin, postSceneBan } from './api'
import type { ModerationIcons } from './icons'
import { kickUser } from './kick'
import { showMessage } from './state'
import { BADGE_GRAY, Button, ErrorLine, RED, SectionTitle, WHITE } from './ui'
import { isAdminUser, isValidAddress, looksLikeAddress } from './utils'

export enum PermissionType {
  ADMIN = 'admin',
  BAN = 'ban'
}

interface Props {
  type: PermissionType
  icons: ModerationIcons
  admins: SceneAdmin[]
  disabled: boolean
  disabledHint: string
  allowKick: boolean
  onChanged: () => void
}

function BanUserDescription(): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 'auto',
        flexDirection: 'column',
        margin: { bottom: 8 }
      }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto', margin: { bottom: 4 } }}
        uiText={{
          value:
            "<b>Banned users CAN'T:</b> See your scene, send messages in the Nearby chat, or be seen by other users.",
          fontSize: 13,
          color: WHITE,
          textAlign: 'top-left'
        }}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 'auto' }}
        uiText={{
          value:
            '<b>Banned users CAN still:</b> See other users and see the messages in the Nearby chat.',
          fontSize: 13,
          color: WHITE,
          textAlign: 'top-left'
        }}
      />
    </UiEntity>
  )
}

export function AddUserInput(props: Props): ReactEcs.JSX.Element {
  const [value, setValue] = ReactEcs.useState('')
  const [error, setError] = ReactEcs.useState('')
  const [loading, setLoading] = ReactEcs.useState(false)

  const isAdminForm = props.type === PermissionType.ADMIN

  const validate = (raw: string): string | null => {
    const submitValue = raw.trim()
    if (submitValue.length <= 2) {
      setError('Provide a valid address or NAME')
      return null
    }
    if (looksLikeAddress(submitValue) && !isValidAddress(submitValue)) {
      setError('Provide a valid address format')
      return null
    }
    return submitValue
  }

  const submit = async (raw: string): Promise<void> => {
    if (loading || props.disabled) return
    const submitValue = validate(raw)
    if (submitValue === null) return

    const byAddress = looksLikeAddress(submitValue)

    if (!isAdminForm && isAdminUser(props.admins, submitValue)) {
      setError(
        'Admin users cannot be banned. Please remove this user from the Admin List and try again.'
      )
      return
    }

    setLoading(true)
    const [failure] = isAdminForm
      ? await postSceneAdmin(byAddress ? { admin: submitValue } : { name: submitValue })
      : await postSceneBan(
          byAddress ? { banned_address: submitValue } : { banned_name: submitValue }
        )
    setLoading(false)

    if (failure !== null) {
      setError('Please try again with a valid NAME or wallet address.')
      return
    }

    setError('')
    setValue('')
    if (!isAdminForm) kickUser(submitValue, byAddress)
    showMessage(isAdminForm ? `${submitValue} is now an admin` : `${submitValue} has been banned`)
    props.onChanged()
  }

  const kick = (): void => {
    if (loading || props.disabled) return
    const submitValue = validate(value)
    if (submitValue === null) return
    setError('')
    setValue('')
    kickUser(submitValue, looksLikeAddress(submitValue))
    showMessage(`Kick sent to ${submitValue}`)
  }

  return (
    <UiEntity uiTransform={{ width: '100%', height: 'auto', flexDirection: 'column' }}>
      <SectionTitle text={isAdminForm ? 'Add an Admin' : 'Ban User from Scene'} />
      {isAdminForm ? null : <BanUserDescription />}
      <UiEntity
        uiTransform={{ width: '100%', height: 44, flexDirection: 'row', alignItems: 'center' }}
      >
        <Input
          value={value}
          placeholder="Enter a NAME or wallet address"
          fontSize={14}
          disabled={props.disabled}
          onChange={(next) => {
            setError('')
            setValue(next)
          }}
          onSubmit={(next) => {
            void submit(next)
          }}
          uiBackground={{ color: WHITE }}
          uiTransform={{
            flexGrow: 1,
            height: 44,
            borderWidth: 3,
            borderRadius: 8,
            borderColor: error === '' ? WHITE : RED
          }}
        />
        {props.allowKick ? (
          <Button
            label="Kick"
            variant="secondary"
            disabled={props.disabled || loading}
            fontSize={15}
            onClick={kick}
            uiTransform={{ width: 74, height: 44, margin: { left: 8 } }}
          />
        ) : null}
        <Button
          label={loading ? '...' : isAdminForm ? 'Add' : 'Ban'}
          variant={isAdminForm ? 'primary' : 'danger'}
          disabled={props.disabled || loading}
          fontSize={16}
          onClick={() => {
            void submit(value)
          }}
          uiTransform={{ width: 84, height: 44, margin: { left: 8 } }}
        />
      </UiEntity>
      {error === '' ? null : <ErrorLine icon={props.icons.error} text={error} />}
      {props.disabled && props.disabledHint !== '' ? (
        <Label
          value={props.disabledHint}
          fontSize={13}
          color={BADGE_GRAY}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 'auto', margin: { top: 6 } }}
        />
      ) : null}
    </UiEntity>
  )
}
