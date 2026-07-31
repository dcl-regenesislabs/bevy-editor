import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { Key, UiBackgroundProps, UiTransformProps } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

export const COLORS = {
  white: Color4.White(),
  black: Color4.Black(),
  offWhite: Color4.fromHexString('#FCFCFC'),
  gray: Color4.create(160 / 255, 155 / 255, 168 / 255, 1),
  dim: Color4.fromHexString('#FFFFFFB2'),
  surface: Color4.fromHexString('#43404A'),
  line: Color4.create(1, 1, 1, 0.12),
  accent: Color4.fromHexString('#00D3FF'),
  success: Color4.fromHexString('#34CE77'),
  successMuted: Color4.fromHexString('#274431'),
  danger: Color4.fromHexString('#FB3B3B'),
  transparent: Color4.create(0, 0, 0, 0)
}

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'success' | 'danger'

function background(variant: ButtonVariant, disabled: boolean): Color4.Mutable {
  if (disabled && variant === 'success') return COLORS.successMuted
  if (variant === 'primary') return COLORS.white
  if (variant === 'success') return COLORS.success
  if (variant === 'secondary') return COLORS.surface
  return COLORS.transparent
}

function foreground(variant: ButtonVariant, disabled: boolean): Color4.Mutable {
  if (disabled) return COLORS.gray
  if (variant === 'primary' || variant === 'success') return COLORS.black
  if (variant === 'danger') return COLORS.danger
  return COLORS.white
}

export function Button(props: {
  key?: Key
  label?: string
  icon?: string
  iconRight?: string
  variant?: ButtonVariant
  disabled?: boolean
  fontSize?: number
  onClick: () => void
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  const variant = props.variant ?? 'secondary'
  const disabled = props.disabled === true
  const tint = foreground(variant, disabled)
  const iconStyle: UiBackgroundProps = { textureMode: 'stretch', color: tint }
  return (
    <UiEntity
      uiTransform={{
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        padding: { left: 12, right: 12 },
        ...props.uiTransform
      }}
      uiBackground={{ color: background(variant, disabled) }}
      onMouseDown={() => {
        if (!disabled) props.onClick()
      }}
    >
      {props.icon !== undefined ? (
        <UiEntity
          uiTransform={{ width: 22, height: 22, margin: { right: props.label === undefined ? 0 : 8 } }}
          uiBackground={{ ...iconStyle, texture: { src: props.icon } }}
        />
      ) : null}
      {props.label !== undefined ? (
        <Label value={`<b>${props.label}</b>`} fontSize={props.fontSize ?? 16} color={tint} />
      ) : null}
      {props.iconRight !== undefined ? (
        <UiEntity
          uiTransform={{ width: 20, height: 20, margin: { left: 8 } }}
          uiBackground={{ ...iconStyle, texture: { src: props.iconRight } }}
        />
      ) : null}
    </UiEntity>
  )
}

export function SectionLabel(props: {
  text: string
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  return (
    <Label
      value={`<b>${props.text}</b>`}
      fontSize={16}
      color={COLORS.white}
      textAlign="middle-left"
      uiTransform={{ width: '100%', height: 24, margin: { top: 12, bottom: 4 }, ...props.uiTransform }}
    />
  )
}

export function Hint(props: {
  text: string
  color?: Color4.Mutable
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  return (
    <Label
      value={props.text}
      fontSize={14}
      color={props.color ?? COLORS.gray}
      textAlign="top-left"
      textWrap="wrap"
      uiTransform={{ width: '100%', height: 'auto', ...props.uiTransform }}
    />
  )
}

export function Row(props: {
  children?: ReactEcs.JSX.ReactNode
  uiTransform?: UiTransformProps
  uiBackground?: UiBackgroundProps
}): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        ...props.uiTransform
      }}
      uiBackground={props.uiBackground}
    >
      {props.children}
    </UiEntity>
  )
}

export function Column(props: {
  children?: ReactEcs.JSX.ReactNode
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', ...props.uiTransform }}>
      {props.children}
    </UiEntity>
  )
}

export function Divider(): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 1, margin: { top: 10, bottom: 10 } }}
      uiBackground={{ color: COLORS.line }}
    />
  )
}

export function ErrorNote(props: { icon: string; text: string }): ReactEcs.JSX.Element {
  return (
    <Row uiTransform={{ margin: { top: 8 } }}>
      <UiEntity
        uiTransform={{ width: 16, height: 16, margin: { right: 6 } }}
        uiBackground={{ textureMode: 'stretch', texture: { src: props.icon }, color: COLORS.danger }}
      />
      <Hint text={props.text} color={COLORS.danger} uiTransform={{ width: '90%' }} />
    </Row>
  )
}

export function IconLink(props: { icon: string; onClick: () => void }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{ width: 22, height: 22 }}
      uiBackground={{ textureMode: 'stretch', texture: { src: props.icon }, color: COLORS.white }}
      onMouseDown={props.onClick}
    />
  )
}

export function SubHeader(props: {
  icon: string
  title: string
  helpIcon?: string
  onHelp?: () => void
}): ReactEcs.JSX.Element {
  return (
    <Row uiTransform={{ justifyContent: 'space-between', margin: { bottom: 8 } }}>
      <Row uiTransform={{ width: 'auto' }}>
        <UiEntity
          uiTransform={{ width: 24, height: 24, margin: { right: 8 } }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: props.icon },
            color: COLORS.white
          }}
        />
        <Label value={`<b>${props.title}</b>`} fontSize={18} color={COLORS.white} />
      </Row>
      {props.helpIcon !== undefined && props.onHelp !== undefined ? (
        <IconLink icon={props.helpIcon} onClick={props.onHelp} />
      ) : null}
    </Row>
  )
}

export function ReadOnlyField(props: {
  value: string
  actionLabel: string
  onAction: () => void
  children?: ReactEcs.JSX.ReactNode
}): ReactEcs.JSX.Element {
  return (
    <Row
      uiTransform={{
        height: 42,
        borderRadius: 8,
        justifyContent: 'space-between',
        margin: { top: 6, bottom: 6 }
      }}
      uiBackground={{ color: COLORS.offWhite }}
    >
      <Label
        value={`<b>${props.value}</b>`}
        fontSize={15}
        color={COLORS.gray}
        textAlign="middle-left"
        uiTransform={{ margin: { left: 12 }, flexShrink: 1 }}
      />
      <Row uiTransform={{ width: 'auto', flexShrink: 0 }}>
        {props.children}
        <Button
          label={props.actionLabel}
          variant="text"
          fontSize={15}
          uiTransform={{ height: 32, margin: { right: 6 } }}
          onClick={props.onAction}
        />
      </Row>
    </Row>
  )
}
