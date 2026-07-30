import ReactEcs, { Input, Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { TEXT_DIM } from '../../ui'
import { RewardsButton } from './Button'
import type { RewardCaptcha } from './api'

export function CaptchaPrompt(props: {
  captcha: RewardCaptcha
  answer: string
  busy: boolean
  closeIcon: string
  onChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}): ReactEcs.JSX.Element {
  return (
    <UiEntity uiTransform={{ width: '100%', flexDirection: 'column' }}>
      <UiEntity
        uiTransform={{
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          margin: { bottom: 16 }
        }}
      >
        <Label
          value="<b>Solve the captcha</b>"
          fontSize={16}
          color={Color4.White()}
          textAlign="middle-left"
          uiTransform={{ flexGrow: 1 }}
        />
        <UiEntity
          uiTransform={{ width: 24, height: 24 }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: props.closeIcon },
            color: Color4.White()
          }}
          onMouseDown={props.onClose}
        />
      </UiEntity>

      <UiEntity
        uiTransform={{
          width: '100%',
          height: 120,
          margin: { bottom: 16 },
          borderRadius: 8
        }}
        uiBackground={{
          color: Color4.White(),
          textureMode: 'stretch',
          texture: { src: props.captcha.image }
        }}
      />

      <Input
        key={`captcha-${props.captcha.id}`}
        placeholder="Enter the captcha"
        value={props.answer}
        fontSize={16}
        textAlign="middle-left"
        color={Color4.Black()}
        placeholderColor={Color4.create(0.4, 0.4, 0.4, 1)}
        uiTransform={{ width: '100%', height: 40, margin: { bottom: 16 } }}
        uiBackground={{ color: Color4.White() }}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
      />

      <UiEntity uiTransform={{ flexDirection: 'row' }}>
        <RewardsButton
          label={props.busy ? 'Sending…' : 'Submit'}
          disabled={props.busy}
          onClick={props.onSubmit}
        />
        <Label
          value="The reward is assigned once the captcha is accepted."
          fontSize={12}
          color={TEXT_DIM}
          textAlign="middle-left"
          uiTransform={{ width: 220, height: 'auto' }}
        />
      </UiEntity>
    </UiEntity>
  )
}
