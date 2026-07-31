import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { sourceLabel, type CastParticipant, type CastTrack } from './api'
import type { VideoIcons } from './icons'
import { refreshSpeakers } from './speakers'
import { videoTab } from './state'
import { Button, COLORS, Column, Divider, Hint, Row } from './ui'

function ParticipantRow(props: {
  key?: string
  participant: CastParticipant
  icons: VideoIcons
  onSelect: (track: CastTrack) => void
}): ReactEcs.JSX.Element {
  return (
    <Column>
      <Row uiTransform={{ justifyContent: 'space-between', margin: { top: 6, bottom: 6 } }}>
        <Row uiTransform={{ width: 'auto' }}>
          <UiEntity
            uiTransform={{ width: 20, height: 20, margin: { right: 8 } }}
            uiBackground={{
              textureMode: 'stretch',
              texture: { src: props.icons.person },
              color: COLORS.white
            }}
          />
          <Label
            value={`<b>${props.participant.name}</b>`}
            fontSize={14}
            color={COLORS.white}
            textAlign="middle-left"
          />
        </Row>
        <Row uiTransform={{ width: 'auto' }}>
          {props.participant.tracks.map((track) => (
            <Button
              key={track.sid}
              label={sourceLabel(track.sourceType)}
              variant={videoTab.activeTrackSid === track.sid ? 'primary' : 'secondary'}
              icon={videoTab.activeTrackSid === track.sid ? props.icons.star : undefined}
              fontSize={14}
              uiTransform={{ width: 'auto', height: 32, margin: { left: 6 } }}
              onClick={() => props.onSelect(track)}
            />
          ))}
        </Row>
      </Row>
      <Divider />
    </Column>
  )
}

export function SpeakerShowcase(props: {
  icons: VideoIcons
  onSelectTrack: (track: CastTrack) => void
  onAutomatic: () => void
}): ReactEcs.JSX.Element {
  const automatic = videoTab.activeTrackSid === undefined
  return (
    <Column uiTransform={{ margin: { top: 12 } }}>
      <Row uiTransform={{ justifyContent: 'space-between' }}>
        <Label
          value={`<b>SPEAKER SHOWCASE</b> (${videoTab.participants.length})`}
          fontSize={16}
          color={COLORS.white}
          textAlign="middle-left"
        />
        <Button
          label="Refresh"
          variant="text"
          fontSize={14}
          uiTransform={{ width: 'auto', height: 30 }}
          onClick={refreshSpeakers}
        />
      </Row>
      <Row uiTransform={{ justifyContent: 'space-between', margin: { top: 8, bottom: 8 } }}>
        <Column uiTransform={{ width: '60%' }}>
          <Label
            value="Automatic Showcase"
            fontSize={14}
            color={COLORS.white}
            textAlign="middle-left"
            uiTransform={{ height: 20 }}
          />
          <Hint text="Speakers are featured automatically when they speak." />
        </Column>
        <Button
          label={automatic ? 'Active' : 'Turn On'}
          icon={automatic ? props.icons.star : undefined}
          variant={automatic ? 'primary' : 'secondary'}
          fontSize={14}
          disabled={automatic}
          uiTransform={{ width: 'auto', height: 32 }}
          onClick={props.onAutomatic}
        />
      </Row>
      <Divider />
      <Column uiTransform={{ maxHeight: 260, overflow: 'scroll' }}>
        {videoTab.participants.length === 0 ? (
          <Hint text="No active participants in the Cast room." />
        ) : null}
        {videoTab.participants.map((participant) => (
          <ParticipantRow
            key={participant.identity}
            participant={participant}
            icons={props.icons}
            onSelect={props.onSelectTrack}
          />
        ))}
      </Column>
    </Column>
  )
}
