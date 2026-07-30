import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { UiTransformProps } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'

const DISABLED_BACKGROUND = Color4.create(74 / 255, 74 / 255, 74 / 255, 1)
const DISABLED_TEXT = Color4.create(160 / 255, 155 / 255, 168 / 255, 1)

export function PrimaryButton(props: {
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
        padding: { left: 20, right: 20 },
        ...props.uiTransform
      }}
      uiBackground={{ color: disabled ? DISABLED_BACKGROUND : Color4.White() }}
      onMouseDown={() => {
        if (!disabled) props.onClick()
      }}
    >
      <Label
        value={`<b>${props.label}</b>`}
        fontSize={16}
        color={disabled ? DISABLED_TEXT : Color4.Black()}
      />
    </UiEntity>
  )
}
