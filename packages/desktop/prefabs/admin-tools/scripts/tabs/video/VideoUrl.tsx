import ReactEcs, { Input } from '@dcl/sdk/react-ecs'
import { openExternalUrl } from '~system/RestrictedActions'
import { VideoPlayer, type Entity } from '@dcl/sdk/ecs'
import { isVideoUrl, type VideoControls } from './controls'
import type { VideoIcons } from './icons'
import { Volume } from './Volume'
import { Button, COLORS, Column, Hint, Row, SectionLabel, SubHeader } from './ui'

const HELP_URL = 'https://docs.decentraland.org/creator/scene-editor/interactivity/video-screen'

export function VideoUrl(props: {
  entity: Entity
  icons: VideoIcons
  controls: VideoControls
  soundDisabled: boolean
}): ReactEcs.JSX.Element {
  const video = VideoPlayer.getOrNull(props.entity)
  const src = video?.src ?? ''
  const active = isVideoUrl(src)
  const [draft, setDraft] = ReactEcs.useState(active ? src : '')

  ReactEcs.useEffect(() => {
    setDraft(isVideoUrl(src) ? src : '')
  }, [props.entity])

  return (
    <Column>
      <SubHeader
        icon={props.icons.sourceVideo}
        title="Video URL"
        helpIcon={props.icons.help}
        onHelp={() => {
          void openExternalUrl({ url: HELP_URL })
        }}
      />
      <Hint text="Play videos by pasting an .m3u8 video URL below." />
      <SectionLabel text="Video URL" />
      <Input
        value={draft}
        onChange={setDraft}
        fontSize={15}
        textAlign="middle-left"
        placeholder="Paste your video URL"
        placeholderColor={COLORS.gray}
        color={COLORS.black}
        uiBackground={{ color: COLORS.offWhite }}
        uiTransform={{ width: '100%', height: 44, borderRadius: 8 }}
      />
      <Row uiTransform={{ justifyContent: 'flex-end', margin: { top: 10 } }}>
        {active ? (
          <Button
            label="Deactivate"
            variant="text"
            uiTransform={{ width: 'auto', margin: { right: 8 } }}
            onClick={() => props.controls.setSource('')}
          />
        ) : null}
        {draft !== src ? (
          <Button
            label={active ? 'Update' : 'Activate'}
            variant="success"
            disabled={!isVideoUrl(draft)}
            uiTransform={{ width: 'auto' }}
            onClick={() => props.controls.setSource(draft)}
          />
        ) : null}
      </Row>
      <SectionLabel text="Video Playback" />
      <Row>
        <Button
          label="Play"
          icon={props.icons.play}
          disabled={!active}
          uiTransform={{ width: 'auto', margin: { right: 8 } }}
          onClick={props.controls.play}
        />
        <Button
          label="Pause"
          icon={props.icons.pause}
          disabled={!active}
          uiTransform={{ width: 'auto', margin: { right: 8 } }}
          onClick={props.controls.pause}
        />
        <Button
          label="Restart"
          disabled={!active}
          uiTransform={{ width: 'auto', margin: { right: 8 } }}
          onClick={props.controls.restart}
        />
        <Button
          icon={props.icons.loop}
          variant={video?.loop === true ? 'primary' : 'secondary'}
          disabled={!active}
          uiTransform={{ width: 46 }}
          onClick={() => props.controls.setLoop(video?.loop !== true)}
        />
      </Row>
      <Volume
        label="Video Volume"
        entity={props.entity}
        icons={props.icons}
        controls={props.controls}
        soundDisabled={props.soundDisabled}
      />
    </Column>
  )
}
