import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { DEFAULT_VOLUME, VOLUME_STEP, volumeOf, type VideoControls } from './controls'
import type { VideoIcons } from './icons'
import { Button, COLORS, Column, Row, SectionLabel } from './ui'
import type { Entity } from '@dcl/sdk/ecs'

export function Volume(props: {
  label: string
  entity: Entity
  icons: VideoIcons
  controls: VideoControls
  soundDisabled: boolean
}): ReactEcs.JSX.Element {
  if (props.soundDisabled) {
    return (
      <Row uiTransform={{ margin: { top: 12 } }}>
        <UiEntity
          uiTransform={{ width: 22, height: 22, margin: { right: 8 } }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: props.icons.mute },
            color: COLORS.gray
          }}
        />
        <Label
          value="Sound is disabled for all screens"
          fontSize={14}
          color={COLORS.gray}
          textAlign="middle-left"
        />
      </Row>
    )
  }

  const volume = volumeOf(props.entity)
  const percentage = `${Math.round((volume ?? DEFAULT_VOLUME) * 100)}%`

  return (
    <Column uiTransform={{ margin: { top: 12 } }}>
      <SectionLabel text={props.label} />
      <Row>
        <Button
          icon={props.icons.volumeMinus}
          disabled={volume === 0}
          uiTransform={{ width: 46, margin: { right: 10 } }}
          onClick={() => props.controls.stepVolume(-VOLUME_STEP)}
        />
        <Label
          value={percentage}
          fontSize={16}
          color={COLORS.gray}
          uiTransform={{ width: 56, margin: { right: 10 } }}
        />
        <Button
          icon={props.icons.volumePlus}
          disabled={volume === 1}
          uiTransform={{ width: 46, margin: { right: 10 } }}
          onClick={() => props.controls.stepVolume(VOLUME_STEP)}
        />
        <Button
          icon={props.icons.mute}
          variant={volume === 0 ? 'primary' : 'secondary'}
          uiTransform={{ width: 46 }}
          onClick={() => props.controls.setVolume(volume === 0 ? DEFAULT_VOLUME : 0)}
        />
      </Row>
    </Column>
  )
}
