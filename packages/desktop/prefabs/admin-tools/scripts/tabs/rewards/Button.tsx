import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { UiTransformProps } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

const ACTIVE = Color4.create(252 / 255, 252 / 255, 252 / 255, 1)
const DISABLED = Color4.create(74 / 255, 74 / 255, 74 / 255, 1)
const DISABLED_TEXT = Color4.create(160 / 255, 155 / 255, 168 / 255, 1)

export function RewardsButton(props: {
  label: string
  icon?: string
  disabled?: boolean
  onClick: () => void
  uiTransform?: UiTransformProps
}): ReactEcs.JSX.Element {
  const disabled = props.disabled === true
  return (
    <UiEntity
      uiTransform={{
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        borderWidth: 0,
        padding: { left: 16, right: 16 },
        margin: { right: 16 },
        ...props.uiTransform
      }}
      uiBackground={{ color: disabled ? DISABLED : ACTIVE }}
      onMouseDown={() => {
        if (!disabled) props.onClick()
      }}
    >
      {props.icon !== undefined ? (
        <UiEntity
          uiTransform={{ width: 25, height: 25, margin: { right: 8 } }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: props.icon },
            color: disabled ? DISABLED_TEXT : Color4.Black()
          }}
        />
      ) : null}
      <Label
        value={`<b>${props.label}</b>`}
        fontSize={16}
        color={disabled ? DISABLED_TEXT : Color4.Black()}
      />
    </UiEntity>
  )
}
