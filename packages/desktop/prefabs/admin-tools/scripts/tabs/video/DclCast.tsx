import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { VideoPlayer, type Entity } from '@dcl/sdk/ecs'
import { copyToClipboard } from '~system/RestrictedActions'
import { VideoControlState } from '../../components'
import { ensurePresenterRole, getCastRoom, resetStreamKey } from './api'
import { LIVEKIT_STREAM_SRC, type VideoControls } from './controls'
import type { VideoIcons } from './icons'
import { ensureSpeakerPolling, refreshSpeakers } from './speakers'
import { markCopied, videoTab, wasCopied } from './state'
import { SpeakerShowcase } from './SpeakerShowcase'
import { Volume } from './Volume'
import { Button, COLORS, Column, Divider, ErrorNote, Hint, Row, SubHeader } from './ui'

export function DclCast(props: {
  self: Entity
  entity: Entity
  icons: VideoIcons
  controls: VideoControls
  soundDisabled: boolean
  playerAddress: string | undefined
  active: boolean
}): ReactEcs.JSX.Element {
  const [loading, setLoading] = ReactEcs.useState(videoTab.castRoom === undefined)

  const fetchRoom = (): void => {
    setLoading(true)
    videoTab.castError = ''
    void (async () => {
      const [error, room] = await getCastRoom()
      if (error !== null) videoTab.castError = error
      else videoTab.castRoom = room
      setLoading(false)
    })()
  }

  ReactEcs.useEffect(() => {
    ensureSpeakerPolling()
    if (videoTab.castRoom === undefined) fetchRoom()
    else setLoading(false)
    if (props.playerAddress !== undefined) void ensurePresenterRole(props.playerAddress)
  }, [])

  const room = videoTab.castRoom
  const showSpeakers = videoTab.showSpeakers

  return (
    <Column>
      <Row uiTransform={{ justifyContent: 'space-between' }}>
        <SubHeader icon={props.icons.sourceCast} title="DCL Cast" />
        <UiEntity
          uiTransform={{ width: 20, height: 20, display: props.active ? 'flex' : 'none' }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: props.icons.star },
            color: COLORS.success
          }}
        />
      </Row>
      <Hint text="Use a browser-based DCL Cast room to stream camera and screen feeds onto this screen." />

      {loading ? <Hint text="Loading room…" uiTransform={{ margin: { top: 16 } }} /> : null}

      {!loading && videoTab.castError !== '' ? (
        <Column uiTransform={{ margin: { top: 12 } }}>
          <ErrorNote icon={props.icons.error} text={videoTab.castError} />
          <Row uiTransform={{ margin: { top: 8 } }}>
            <Button label="Retry" uiTransform={{ width: 'auto' }} onClick={fetchRoom} />
          </Row>
        </Column>
      ) : null}

      {!loading && room !== undefined ? (
        <Column uiTransform={{ margin: { top: 12 } }}>
          <Row uiTransform={{ justifyContent: 'space-between' }}>
            <Column uiTransform={{ width: 'auto' }}>
              <Label
                value="<b>Room ID</b>"
                fontSize={20}
                color={COLORS.white}
                textAlign="middle-left"
                uiTransform={{ height: 26 }}
              />
              <Hint text={`Expires in ${room.expiresInDays} days`} />
            </Column>
            {props.active ? (
              <Button
                label="Deactivate"
                variant="text"
                uiTransform={{ width: 'auto' }}
                onClick={() => {
                  props.controls.setSource('')
                  videoTab.activeTrackSid = undefined
                }}
              />
            ) : (
              <Button
                label="Activate"
                variant="success"
                uiTransform={{ width: 'auto' }}
                onClick={() => {
                  props.controls.setSource(LIVEKIT_STREAM_SRC)
                  videoTab.activeTrackSid = undefined
                  videoTab.source = 'dcl-cast'
                }}
              />
            )}
          </Row>

          <Divider />

          <Row uiTransform={{ justifyContent: 'space-between' }}>
            <Column uiTransform={{ width: '62%' }}>
              <Label
                value="<b>Cast speakers</b>"
                fontSize={16}
                color={COLORS.white}
                textAlign="middle-left"
                uiTransform={{ height: 22 }}
              />
              <Hint text="This link grants streaming access." />
            </Column>
            <Button
              label={wasCopied('stream-link') ? 'Copied!' : 'Copy Link'}
              variant="text"
              iconRight={props.icons.copy}
              uiTransform={{ width: 'auto' }}
              onClick={() => {
                if (room.streamLink === '') return
                void copyToClipboard({ text: room.streamLink })
                markCopied('stream-link')
              }}
            />
          </Row>

          <Divider />

          <Row uiTransform={{ justifyContent: 'space-between' }}>
            <Column uiTransform={{ width: '62%' }}>
              <Label
                value="<b>Viewers</b>"
                fontSize={16}
                color={COLORS.white}
                textAlign="middle-left"
                uiTransform={{ height: 22 }}
              />
              <Hint text="This link grants viewing access." />
            </Column>
            <Button
              label={wasCopied('watcher-link') ? 'Copied!' : 'Copy Link'}
              variant="text"
              iconRight={props.icons.copy}
              uiTransform={{ width: 'auto' }}
              onClick={() => {
                if (room.watcherLink === '') return
                void copyToClipboard({ text: room.watcherLink })
                markCopied('watcher-link')
              }}
            />
          </Row>

          <Volume
            label="Cast controls"
            entity={props.entity}
            icons={props.icons}
            controls={props.controls}
            soundDisabled={props.soundDisabled}
          />

          <Row uiTransform={{ margin: { top: 16 }, justifyContent: 'space-between' }}>
            <Button
              label={showSpeakers ? 'Hide Speakers' : 'Speakers'}
              icon={props.icons.star}
              iconRight={showSpeakers ? props.icons.chevronUp : props.icons.chevronDown}
              disabled={!props.active}
              uiTransform={{ width: 'auto' }}
              onClick={() => {
                videoTab.showSpeakers = !showSpeakers
                if (!showSpeakers) refreshSpeakers()
              }}
            />
            <Button
              label="Reset Room"
              variant="danger"
              uiTransform={{ width: 'auto' }}
              onClick={() => {
                setLoading(true)
                void (async () => {
                  const [error, data] = await resetStreamKey()
                  if (error !== null) {
                    videoTab.castError = error
                    setLoading(false)
                    return
                  }
                  const state = VideoControlState.getMutableOrNull(props.self)
                  if (state !== null) state.endsAt = data.endsAt
                  videoTab.castRoom = undefined
                  videoTab.activeTrackSid = undefined
                  fetchRoom()
                })()
              }}
            />
          </Row>

          {showSpeakers && props.active ? (
            <SpeakerShowcase
              icons={props.icons}
              onSelectTrack={(track) => {
                props.controls.setSource(track.sid)
                videoTab.activeTrackSid = track.sid
                videoTab.source = 'dcl-cast'
              }}
              onAutomatic={() => {
                props.controls.setSource(LIVEKIT_STREAM_SRC)
                videoTab.activeTrackSid = undefined
              }}
            />
          ) : null}
        </Column>
      ) : null}

      {VideoPlayer.getOrNull(props.entity) === null ? (
        <ErrorNote icon={props.icons.error} text="This screen has no VideoPlayer component." />
      ) : null}
    </Column>
  )
}
