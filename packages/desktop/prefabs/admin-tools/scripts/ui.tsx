import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { Key, UiBackgroundProps, UiTransformProps } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

export const PANEL_BACKGROUND = Color4.create(0, 0, 0, 0.75)
export const PANEL_WIDTH = 500
export const TEXT_DIM = Color4.create(160 / 255, 155 / 255, 168 / 255, 1)

export function Card(props: {
  children?: ReactEcs.JSX.ReactNode
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        borderRadius: 12,
        flexDirection: 'column',
        margin: { top: 10 },
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        ...props.uiTransform
      }}
      uiBackground={{ color: PANEL_BACKGROUND }}
    >
      {props.children}
    </UiEntity>
  )
}

export function CardHeader(props: { icon: string; title: string }): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 'auto',
        margin: { bottom: 16 }
      }}
    >
      <UiEntity
        uiTransform={{ width: 30, height: 30 }}
        uiBackground={{ textureMode: 'stretch', texture: { src: props.icon } }}
      />
      <Label
        value={`<b>${props.title}</b>`}
        fontSize={22}
        color={Color4.White()}
        textAlign="middle-left"
        uiTransform={{ margin: { left: 10 } }}
      />
    </UiEntity>
  )
}

export function IconButton(props: {
  key?: Key
  icon: string
  active?: boolean
  onClick: () => void
  uiTransform?: UiTransformProps
  iconBackground?: UiBackgroundProps
}): ReactEcs.JSX.Element {
  const active = props.active === true
  return (
    <UiEntity
      uiTransform={{
        width: 49,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        margin: { right: 8 },
        ...props.uiTransform
      }}
      uiBackground={{ color: active ? Color4.White() : Color4.create(0, 0, 0, 0) }}
      onMouseDown={props.onClick}
    >
      <UiEntity
        uiTransform={{ width: '70%', height: '70%' }}
        uiBackground={{
          textureMode: 'stretch',
          texture: { src: props.icon },
          color: active ? Color4.Black() : Color4.White(),
          ...props.iconBackground
        }}
      />
    </UiEntity>
  )
}

export function TextButton(props: {
  label: string
  disabled?: boolean
  onClick: () => void
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  const disabled = props.disabled === true
  return (
    <UiEntity
      uiTransform={{
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: disabled ? Color4.create(50 / 255, 50 / 255, 50 / 255, 1) : Color4.White(),
        padding: { left: 14, right: 14 },
        margin: { right: 8 },
        ...props.uiTransform
      }}
      onMouseDown={() => {
        if (!disabled) props.onClick()
      }}
    >
      <Label
        value={`<b>${props.label}</b>`}
        fontSize={16}
        color={disabled ? Color4.Gray() : Color4.White()}
      />
    </UiEntity>
  )
}
