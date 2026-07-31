import ReactEcs, { Input, Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { TextAnnouncements as TextAnnouncementsComponent } from '../components'
import { TabId } from '../state'
import type { TabComponent, TabProps, TabSpec } from '../types'
import { Card, CardHeader, TextButton, TEXT_DIM } from '../ui'
import { AnnouncementOverlay } from './announcements/Overlay'
import { announcementIcons } from './announcements/icons'
import { PrimaryButton } from './announcements/ui'
import {
  ANNOUNCEMENT_MAX_LENGTH,
  announcementId,
  announcementUi,
  cooldownRemaining,
  feedbackText,
  recordAnnouncement,
  recordSend
} from './announcements/state'

const PLACEHOLDER_COLOR = Color4.create(160 / 255, 155 / 255, 168 / 255, 1)
const MUTED = Color4.create(187 / 255, 187 / 255, 187 / 255, 1)

function resetInput(props: TabProps): void {
  props.state.textAnnouncements.draft = ''
  announcementUi.inputResetSeq += 1
}

function send(props: TabProps): void {
  if (props.bus === null) return
  const text = props.state.textAnnouncements.draft.trim()
  if (text === '') {
    announcementUi.feedback = 'empty'
    return
  }

  const author = props.player?.name ?? ''
  const now = Date.now()
  const throttledFor = cooldownRemaining(author, now)
  if (throttledFor > 0) {
    announcementUi.feedback = 'throttled'
    announcementUi.throttledFor = throttledFor
    return
  }

  const showAuthor = props.config.textAnnouncementControl.showAuthorOnEachAnnouncement
  props.bus.setAnnouncement(
    text.slice(0, ANNOUNCEMENT_MAX_LENGTH),
    showAuthor ? author : '',
    announcementId(now, author)
  )
  recordSend(author, now)
  resetInput(props)
  announcementUi.feedback = 'sent'
}

function clear(props: TabProps): void {
  if (props.bus === null) return
  props.bus.clearAnnouncement()
  props.state.textAnnouncements.announcements = []
  announcementUi.dismissed.clear()
  resetInput(props)
  announcementUi.feedback = 'cleared'
}

function History(props: TabProps): ReactEcs.JSX.Element | null {
  const entries = props.state.textAnnouncements.announcements
  if (entries.length === 0) return null
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: '100%', margin: { top: 8 } }}>
      <Label
        value="<b>Recent</b>"
        fontSize={14}
        color={TEXT_DIM}
        textAlign="middle-left"
        uiTransform={{ width: '100%', height: 22 }}
      />
      {entries.map((entry) => (
        <Label
          key={entry.id}
          value={entry.author === '' ? entry.text : `${entry.text}  <b>- ${entry.author}</b>`}
          fontSize={13}
          color={MUTED}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 20 }}
        />
      ))}
    </UiEntity>
  )
}

export const TextAnnouncements: TabComponent = (props: TabProps) => {
  const live = TextAnnouncementsComponent.getOrNull(props.self)
  if (live !== null && live.text !== '') {
    recordAnnouncement(props.state, {
      id: live.id,
      text: live.text,
      author: live.author ?? '',
      timestamp: Date.now()
    })
  }

  const icons = announcementIcons(props.assetBase)
  const ready = props.bus !== null
  const draft = props.state.textAnnouncements.draft
  const feedback = announcementUi.feedback

  return (
    <Card>
      <CardHeader icon={props.icons.headerTextAnnouncements} title="TEXT ANNOUNCEMENTS" />
      <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
        <Label
          value="<b>Message window</b>"
          fontSize={16}
          color={Color4.White()}
          textAlign="middle-left"
          uiTransform={{ width: '100%', height: 24, margin: { bottom: 12 } }}
        />
        <Input
          key={`announcement-input-${announcementUi.inputResetSeq}`}
          placeholder="Write your announcement here"
          placeholderColor={PLACEHOLDER_COLOR}
          color={Color4.Black()}
          fontSize={16}
          disabled={!ready}
          textAlign="top-left"
          uiBackground={{ color: Color4.White() }}
          uiTransform={{ width: '100%', height: 80, margin: { bottom: 16 } }}
          onChange={(value) => {
            props.state.textAnnouncements.draft = value
            announcementUi.feedback = undefined
          }}
          onSubmit={(value) => {
            props.state.textAnnouncements.draft = value
            send(props)
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 40,
            flexDirection: 'row',
            alignItems: 'center',
            margin: { bottom: 10 }
          }}
        >
          <Label
            value={`${draft.length} / ${ANNOUNCEMENT_MAX_LENGTH}`}
            fontSize={14}
            color={draft.length > ANNOUNCEMENT_MAX_LENGTH ? Color4.Red() : MUTED}
            textAlign="middle-left"
            uiTransform={{ flexGrow: 1 }}
          />
          <TextButton
            label="Clear Announcements"
            disabled={!ready}
            onClick={() => clear(props)}
          />
          <PrimaryButton label="Share" disabled={!ready} onClick={() => send(props)} />
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: '100%',
            minHeight: 30,
            flexDirection: 'row',
            alignItems: 'center',
            display: feedback === undefined ? 'none' : 'flex'
          }}
        >
          <UiEntity
            uiTransform={{ width: 24, height: 24, margin: { right: 8 } }}
            uiBackground={{ textureMode: 'stretch', texture: { src: icons.check } }}
          />
          <Label
            value={feedback === undefined ? '' : feedbackText(feedback, announcementUi.throttledFor)}
            fontSize={14}
            color={MUTED}
            textAlign="middle-left"
            uiTransform={{ flexGrow: 1 }}
          />
        </UiEntity>
        <History {...props} />
      </UiEntity>
    </Card>
  )
}

export const textAnnouncementsTab: TabSpec = {
  id: TabId.TEXT_ANNOUNCEMENTS,
  icon: 'tabTextAnnouncements',
  isEnabled: (config) => config.textAnnouncementControl.isEnabled,
  Component: TextAnnouncements
}

export { AnnouncementOverlay }
export type { AnnouncementOverlayProps } from './announcements/Overlay'
