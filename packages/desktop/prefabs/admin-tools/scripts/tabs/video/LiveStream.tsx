import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { VideoPlayer, type Entity } from '@dcl/sdk/ecs'
import { copyToClipboard, openExternalUrl } from '~system/RestrictedActions'
import { VideoControlState } from '../../components'
import { generateStreamKey, getStreamKey, resetStreamKey } from './api'
import { isLiveSource, LIVEKIT_STREAM_SRC, type VideoControls } from './controls'
import type { VideoIcons } from './icons'
import {
  hideKey,
  isKeyVisible,
  markCopied,
  REVEAL_SECONDS,
  revealKey,
  revealRemaining,
  videoTab,
  wasCopied
} from './state'
import { Volume } from './Volume'
import { Button, COLORS, Column, ErrorNote, Hint, Row, SectionLabel, SubHeader, ReadOnlyField } from './ui'

const RTMP_SERVER_URL = 'rtmps://dcl.rtmp.livekit.cloud/x'
const SUPPORT_URL = 'https://docs.decentraland.org//creator/editor/live-streaming'

function formatRemaining(endsAt: number): string {
  const remaining = Math.max(0, endsAt - Date.now())
  const days = Math.floor(remaining / 86_400_000)
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'}`
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':')
}

function storeEndsAt(self: Entity, endsAt: number | undefined): void {
  const state = VideoControlState.getMutableOrNull(self)
  if (state === null) return
  state.endsAt = endsAt
}

export function LiveStream(props: {
  self: Entity
  entity: Entity
  icons: VideoIcons
  controls: VideoControls
  soundDisabled: boolean
}): ReactEcs.JSX.Element {
  const [loading, setLoading] = ReactEcs.useState(!videoTab.streamKeyLoaded)
  const [busy, setBusy] = ReactEcs.useState(false)
  const [error, setError] = ReactEcs.useState('')

  ReactEcs.useEffect(() => {
    if (videoTab.streamKeyLoaded) return
    void (async () => {
      const [failure, data] = await getStreamKey()
      videoTab.streamKeyLoaded = true
      videoTab.hasStreamKey = failure === null
      videoTab.streamKeyEndsAt = failure === null ? data.endsAt : 0
      storeEndsAt(props.self, failure === null ? data.endsAt : undefined)
      setLoading(false)
    })()
  }, [])

  const video = VideoPlayer.getOrNull(props.entity)
  const active = isLiveSource(video?.src ?? '')
  const visible = isKeyVisible()
  const endsAt = VideoControlState.getOrNull(props.self)?.endsAt ?? videoTab.streamKeyEndsAt

  if (videoTab.confirmReset) {
    return (
      <Column uiTransform={{ alignItems: 'center', padding: { top: 24, bottom: 24 } }}>
        <Label
          value="<b>Are you sure you want to reset your Stream Key?</b>"
          fontSize={16}
          color={COLORS.offWhite}
        />
        <Hint
          text="Active streams using this stream key will be disconnected."
          uiTransform={{ margin: { top: 6, bottom: 20 } }}
        />
        <Row uiTransform={{ justifyContent: 'center' }}>
          <Button
            label="Cancel"
            variant="primary"
            disabled={busy}
            uiTransform={{ width: 'auto', margin: { right: 16 } }}
            onClick={() => {
              videoTab.confirmReset = false
            }}
          />
          <Button
            label="Reset"
            variant="danger"
            disabled={busy}
            uiTransform={{ width: 'auto' }}
            onClick={() => {
              setBusy(true)
              void (async () => {
                const [failure, data] = await resetStreamKey()
                setBusy(false)
                if (failure !== null) {
                  setError(failure)
                  return
                }
                hideKey()
                videoTab.hasStreamKey = true
                videoTab.streamKeyEndsAt = data.endsAt
                storeEndsAt(props.self, data.endsAt)
                videoTab.confirmReset = false
              })()
            }}
          />
        </Row>
        {error !== '' ? <ErrorNote icon={props.icons.error} text={error} /> : null}
      </Column>
    )
  }

  return (
    <Column>
      <SubHeader
        icon={props.icons.sourceLive}
        title="Stream"
        helpIcon={props.icons.help}
        onHelp={() => {
          void openExternalUrl({ url: SUPPORT_URL })
        }}
      />
      <Hint text="Use the RTMP server and stream key below in your broadcasting software to start streaming to this screen." />

      {loading ? <Hint text="Loading stream key…" uiTransform={{ margin: { top: 16 } }} /> : null}

      {!loading && !videoTab.hasStreamKey ? (
        <Column uiTransform={{ alignItems: 'center', margin: { top: 16 } }}>
          <Button
            label={busy ? 'Generating…' : 'Get Stream Key'}
            variant="primary"
            disabled={busy}
            fontSize={17}
            uiTransform={{ width: 'auto', height: 46 }}
            onClick={() => {
              setBusy(true)
              setError('')
              void (async () => {
                const [failure, data] = await generateStreamKey()
                setBusy(false)
                if (failure !== null) {
                  setError(failure)
                  return
                }
                videoTab.hasStreamKey = true
                videoTab.streamKeyEndsAt = data.endsAt
                storeEndsAt(props.self, data.endsAt)
              })()
            }}
          />
          <Hint
            text="Do not share your stream key with anyone, and be careful not to display it on screen while streaming."
            color={COLORS.danger}
            uiTransform={{ margin: { top: 16 } }}
          />
        </Column>
      ) : null}

      {!loading && videoTab.hasStreamKey ? (
        <Column>
          <SectionLabel text="RTMP Server" />
          <ReadOnlyField
            value={RTMP_SERVER_URL}
            actionLabel={wasCopied('rtmp') ? 'Copied!' : 'Copy'}
            onAction={() => {
              void copyToClipboard({ text: RTMP_SERVER_URL })
              markCopied('rtmp')
            }}
          />
          <SectionLabel text="Stream Key" />
          <ReadOnlyField
            value={visible ? videoTab.revealedKey : '************'}
            actionLabel={wasCopied('key') ? 'Copied!' : 'Copy'}
            onAction={() => {
              if (visible) {
                void copyToClipboard({ text: videoTab.revealedKey })
                markCopied('key')
                return
              }
              void (async () => {
                const [failure, data] = await getStreamKey()
                if (failure !== null) {
                  setError(failure)
                  return
                }
                void copyToClipboard({ text: data.streamingKey })
                markCopied('key')
              })()
            }}
          >
            <UiEntity
              uiTransform={{ width: 22, height: 22, margin: { right: 8 } }}
              uiBackground={{
                textureMode: 'stretch',
                texture: { src: visible ? props.icons.eyeHide : props.icons.eyeShow },
                color: COLORS.black
              }}
              onMouseDown={() => {
                if (visible) {
                  hideKey()
                  return
                }
                void (async () => {
                  const [failure, data] = await getStreamKey()
                  if (failure !== null) {
                    setError(failure)
                    return
                  }
                  revealKey(data.streamingKey)
                })()
              }}
            />
          </ReadOnlyField>

          <UiEntity
            uiTransform={{ width: '100%', height: 4, display: visible ? 'flex' : 'none' }}
            uiBackground={{ color: COLORS.line }}
          >
            <UiEntity
              uiTransform={{ width: `${(revealRemaining() / REVEAL_SECONDS) * 100}%`, height: '100%' }}
              uiBackground={{ color: COLORS.accent }}
            />
          </UiEntity>

          <Row uiTransform={{ justifyContent: 'space-between', margin: { top: 12 } }}>
            {endsAt > Date.now() ? (
              <Column uiTransform={{ width: 'auto' }}>
                <Hint text="Stream expires in:" color={COLORS.dim} />
                <Hint text={formatRemaining(endsAt)} color={COLORS.dim} />
              </Column>
            ) : (
              <ErrorNote
                icon={props.icons.error}
                text="Stream timed out. Please restart the stream in your broadcasting software."
              />
            )}
            {active ? (
              <Button
                label="Deactivate"
                variant="text"
                uiTransform={{ width: 'auto' }}
                onClick={() => props.controls.setSource('')}
              />
            ) : (
              <Button
                label="Activate"
                variant="success"
                uiTransform={{ width: 'auto' }}
                onClick={() => props.controls.setSource(LIVEKIT_STREAM_SRC)}
              />
            )}
          </Row>

          <Volume
            label="Stream Volume"
            entity={props.entity}
            icons={props.icons}
            controls={props.controls}
            soundDisabled={props.soundDisabled}
          />

          <Row uiTransform={{ margin: { top: 16 } }}>
            <Button
              label="Reset Stream Key"
              variant="danger"
              uiTransform={{ width: 'auto' }}
              onClick={() => {
                setError('')
                videoTab.confirmReset = true
              }}
            />
          </Row>
        </Column>
      ) : null}

      {error !== '' ? <ErrorNote icon={props.icons.error} text={error} /> : null}
    </Column>
  )
}
