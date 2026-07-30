import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { Key, UiTransformProps } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

export const WHITE = Color4.White()
export const BLACK = Color4.Black()
export const GRAY = Color4.Gray()
export const ADDRESS_GRAY = Color4.fromHexString('#716B7C')
export const DIVIDER_GRAY = Color4.fromHexString('#43404A')
export const DISABLED_GRAY = Color4.fromHexString('#323232')
export const BADGE_GRAY = Color4.fromHexString('#A09BA8')
export const DANGER = Color4.fromHexString('#FF2D55')
export const BAN_PINK = Color4.fromHexString('#FB3B3B')
export const RED = Color4.Red()

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'text'

export function Divider(props: { uiTransform?: UiTransformProps }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 1,
        flexShrink: 0,
        margin: { top: 14, bottom: 14 },
        ...props.uiTransform
      }}
      uiBackground={{ color: DIVIDER_GRAY }}
    />
  )
}

export function SectionTitle(props: { text: string }): ReactEcs.JSX.Element {
  return (
    <Label
      value={`<b>${props.text}</b>`}
      fontSize={17}
      color={WHITE}
      textAlign="middle-left"
      uiTransform={{ height: 'auto', margin: { bottom: 8 } }}
    />
  )
}

export function ErrorLine(props: {
  icon: string
  text: string
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        margin: { top: 6 },
        ...props.uiTransform
      }}
    >
      <UiEntity
        uiTransform={{ width: 16, height: 16, flexShrink: 0, margin: { right: 8 } }}
        uiBackground={{ textureMode: 'stretch', texture: { src: props.icon } }}
      />
      <UiEntity
        uiTransform={{ width: '90%', height: 'auto' }}
        uiText={{ value: props.text, fontSize: 13, color: RED, textAlign: 'top-left' }}
      />
    </UiEntity>
  )
}

function backgroundColor(variant: ButtonVariant, disabled: boolean): Color4 {
  if (disabled) return variant === 'primary' ? DISABLED_GRAY : Color4.create(0, 0, 0, 0)
  if (variant === 'primary') return WHITE
  if (variant === 'danger') return BAN_PINK
  return Color4.create(0, 0, 0, 0)
}

function labelColor(variant: ButtonVariant, disabled: boolean): Color4 {
  if (disabled) return DISABLED_GRAY
  if (variant === 'primary') return BLACK
  return WHITE
}

export function Button(props: {
  key?: Key
  label: string
  variant?: ButtonVariant
  disabled?: boolean
  icon?: string
  iconRight?: string
  color?: Color4
  fontSize?: number
  onClick: () => void
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  const variant = props.variant ?? 'primary'
  const disabled = props.disabled === true
  const color = disabled ? DISABLED_GRAY : (props.color ?? labelColor(variant, disabled))
  return (
    <UiEntity
      uiTransform={{
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: variant === 'secondary' ? 2 : 0,
        borderColor: disabled ? DISABLED_GRAY : WHITE,
        padding: { left: 12, right: 12 },
        ...props.uiTransform
      }}
      uiBackground={{ color: backgroundColor(variant, disabled) }}
      onMouseDown={() => {
        if (!disabled) props.onClick()
      }}
    >
      {props.icon === undefined ? null : (
        <UiEntity
          uiTransform={{ width: 20, height: 20, flexShrink: 0, margin: { right: 8 } }}
          uiBackground={{ textureMode: 'stretch', texture: { src: props.icon }, color }}
        />
      )}
      <Label value={`<b>${props.label}</b>`} fontSize={props.fontSize ?? 15} color={color} />
      {props.iconRight === undefined ? null : (
        <UiEntity
          uiTransform={{ width: 20, height: 20, flexShrink: 0, margin: { left: 8 } }}
          uiBackground={{ textureMode: 'stretch', texture: { src: props.iconRight }, color }}
        />
      )}
    </UiEntity>
  )
}

export function ListHeader(props: {
  icon: string
  title: string
  counter: string
  closeIcon: string
  onClose: () => void
}): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 32,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 10 }
      }}
    >
      <UiEntity
        uiTransform={{ width: 26, height: 26, flexShrink: 0, margin: { right: 8 } }}
        uiBackground={{ textureMode: 'stretch', texture: { src: props.icon }, color: WHITE }}
      />
      <Label value={`<b>${props.title}</b>`} fontSize={19} color={WHITE} />
      <Label
        value={props.counter}
        fontSize={14}
        color={GRAY}
        uiTransform={{ flexGrow: 1, margin: { left: 8 } }}
        textAlign="middle-left"
      />
      <UiEntity
        uiTransform={{ width: 26, height: 26, flexShrink: 0 }}
        uiBackground={{ textureMode: 'stretch', texture: { src: props.closeIcon }, color: WHITE }}
        onMouseDown={props.onClose}
      />
    </UiEntity>
  )
}
