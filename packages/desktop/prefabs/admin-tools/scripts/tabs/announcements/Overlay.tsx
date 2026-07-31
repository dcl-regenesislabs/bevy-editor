import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import type { Entity } from '@dcl/sdk/ecs'
import { TextAnnouncements as TextAnnouncementsComponent } from '../../components'
import type { AdminToolsValue } from '../../components'
import type { AdminState } from '../../state'
import { announcementIcons } from './icons'
import { announcementUi, recordAnnouncement } from './state'

export interface AnnouncementOverlayProps {
  self: Entity
  config: AdminToolsValue
  assetBase: string
  state: AdminState
}

export function AnnouncementOverlay(props: AnnouncementOverlayProps): ReactEcs.JSX.Element | null {
  const announcement = TextAnnouncementsComponent.getOrNull(props.self)
  if (announcement === null || announcement.text === '') return null

  recordAnnouncement(props.state, {
    id: announcement.id,
    text: announcement.text,
    author: announcement.author ?? '',
    timestamp: Date.now()
  })

  if (announcementUi.dismissed.has(announcement.id)) return null

  const icons = announcementIcons(props.assetBase)
  const author = announcement.author ?? ''
  const showAuthor =
    props.config.textAnnouncementControl.showAuthorOnEachAnnouncement && author !== ''

  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        width: '100%',
        height: '100%'
      }}
    >
      <UiEntity
        key={announcement.id}
        uiTransform={{
          flexDirection: 'column',
          width: 400,
          height: 150,
          margin: { bottom: 10 },
          padding: { top: 10, right: 10, bottom: 10, left: 10 },
          pointerFilter: 'block'
        }}
        uiBackground={{ color: { r: 0.15, g: 0.15, b: 0.15, a: 0.95 } }}
      >
        <UiEntity
          uiTransform={{ alignSelf: 'center', justifyContent: 'center', width: 50, height: 50 }}
          uiBackground={{
            textureMode: 'stretch',
            texture: { src: icons.chatMessage },
            color: { r: 1, g: 1, b: 1, a: 1 }
          }}
        />
        <Label
          value={announcement.text}
          fontSize={18}
          uiTransform={{ width: '100%', flexGrow: 1 }}
        />
        {showAuthor ? (
          <Label
            value={`- ${author}`}
            fontSize={14}
            color={{ r: 0.7, g: 0.7, b: 0.7, a: 1 }}
            textAlign="bottom-right"
            uiTransform={{ width: '100%' }}
          />
        ) : null}
        <UiEntity
          uiTransform={{
            width: 24,
            height: 24,
            positionType: 'absolute',
            position: { top: 5, right: 5 }
          }}
          uiBackground={{ textureMode: 'stretch', texture: { src: icons.close } }}
          onMouseDown={() => {
            announcementUi.dismissed.add(announcement.id)
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}
