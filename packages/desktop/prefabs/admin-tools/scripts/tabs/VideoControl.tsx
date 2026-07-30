import ReactEcs, { Dropdown, UiEntity } from '@dcl/sdk/react-ecs'
import { VideoPlayer } from '@dcl/sdk/ecs'
import { TabId } from '../state'
import type { TabComponent, TabProps, TabSpec } from '../types'
import { Card, CardHeader } from '../ui'
import { DclCast } from './video/DclCast'
import { LiveStream } from './video/LiveStream'
import { VideoUrl } from './video/VideoUrl'
import { videoIcons } from './video/icons'
import { videoTab, type MediaSource } from './video/state'
import {
  createControls,
  enforceMute,
  isCastSource,
  isVideoUrl,
  LIVEKIT_STREAM_SRC,
  managedScreens
} from './video/controls'
import { Button, COLORS, Column, Hint, Row, SectionLabel } from './video/ui'

function sourceOf(src: string): MediaSource {
  if (isVideoUrl(src)) return 'video-url'
  if (src === '' || src === LIVEKIT_STREAM_SRC) return 'live'
  return 'dcl-cast'
}

export const VideoControl: TabComponent = (props: TabProps) => {
  const icons = videoIcons(props.assetBase)
  const screens = managedScreens(props.config)
  const soundDisabled = props.config.videoControl.disableVideoPlayersSound
  const selected = Math.min(Math.max(props.state.video.selectedIndex ?? 0, 0), screens.length - 1)
  const screen = screens[selected]
  const entity = screen?.entity
  const src = entity === undefined ? '' : (VideoPlayer.getOrNull(entity)?.src ?? '')

  ReactEcs.useEffect(() => {
    if (soundDisabled) enforceMute(screens)
  }, [screens.length, soundDisabled])

  ReactEcs.useEffect(() => {
    const stillCasting =
      videoTab.source === 'dcl-cast' && (isCastSource(src) || src === videoTab.activeTrackSid)
    videoTab.source = stillCasting ? 'dcl-cast' : sourceOf(src)
  }, [entity])

  if (entity === undefined) {
    return (
      <Card>
        <CardHeader icon={props.icons.headerVideo} title="VIDEO SCREENS" />
        <Hint text="No video screens linked yet. Add them from the Admin Tools inspector, or turn on 'Link all video players'." />
      </Card>
    )
  }

  const source = videoTab.source ?? sourceOf(src)
  const urlActive = isVideoUrl(src)
  const liveActive = src === LIVEKIT_STREAM_SRC && source !== 'dcl-cast'
  const castActive =
    src !== '' &&
    (isCastSource(src) ? source === 'dcl-cast' : src === videoTab.activeTrackSid)
  const controls = createControls(props.bus, entity, soundDisabled)

  const pick = (value: MediaSource): void => {
    videoTab.source = value
  }

  const sourceButton = (
    value: MediaSource,
    label: string,
    icon: string,
    active: boolean
  ): ReactEcs.JSX.Element => (
    <Column uiTransform={{ width: '31%' }}>
      <Button
        label={label}
        icon={icon}
        fontSize={14}
        variant={source === value ? 'primary' : 'secondary'}
        uiTransform={{ width: '100%', height: 36, borderRadius: 6 }}
        onClick={() => pick(value)}
      />
      <UiEntity
        uiTransform={{ width: '100%', height: 4, margin: { top: 6 }, borderRadius: 2 }}
        uiBackground={{ color: active ? COLORS.success : COLORS.transparent }}
      />
    </Column>
  )

  return (
    <Column>
      <Card>
        <CardHeader icon={props.icons.headerVideo} title="VIDEO SCREENS" />
        {screens.length > 1 ? (
          <Column>
            <SectionLabel text="Current Screen" uiTransform={{ margin: { bottom: 6 } }} />
            <Dropdown
              options={screens.map((item) => item.customName)}
              selectedIndex={selected}
              onChange={(index) => {
                props.state.video.selectedIndex = index
              }}
              textAlign="middle-left"
              fontSize={15}
              color={COLORS.black}
              uiBackground={{ color: COLORS.offWhite }}
              uiTransform={{ width: '100%', height: 36 }}
            />
          </Column>
        ) : null}
        <SectionLabel text="Media Source" />
        <Row uiTransform={{ justifyContent: 'space-between', margin: { top: 4 } }}>
          {sourceButton('video-url', 'VIDEO URL', icons.sourceVideo, urlActive)}
          {sourceButton('dcl-cast', 'DCL CAST', icons.sourceCast, castActive)}
          {sourceButton('live', 'STREAM', icons.sourceLive, liveActive)}
        </Row>
      </Card>
      <Card>
        {source === 'video-url' ? (
          <VideoUrl
            entity={entity}
            icons={icons}
            controls={controls}
            soundDisabled={soundDisabled}
          />
        ) : null}
        {source === 'live' ? (
          <LiveStream
            self={props.self}
            entity={entity}
            icons={icons}
            controls={controls}
            soundDisabled={soundDisabled}
          />
        ) : null}
        {source === 'dcl-cast' ? (
          <DclCast
            self={props.self}
            entity={entity}
            icons={icons}
            controls={controls}
            soundDisabled={soundDisabled}
            playerAddress={props.player?.userId}
            active={castActive}
          />
        ) : null}
      </Card>
    </Column>
  )
}

export const videoControlTab: TabSpec = {
  id: TabId.VIDEO,
  icon: 'tabVideo',
  isEnabled: (config) => config.videoControl.isEnabled,
  Component: VideoControl
}
