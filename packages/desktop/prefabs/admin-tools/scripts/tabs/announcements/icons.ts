import { iconPath } from '../../icons'

export interface AnnouncementIcons {
  check: string
  close: string
  chatMessage: string
}

export function announcementIcons(base: string): AnnouncementIcons {
  return {
    check: iconPath(base, 'announcements/text-announcement-check.png'),
    close: iconPath(base, 'announcements/text-announcement-close-button.png'),
    chatMessage: iconPath(base, 'announcements/text-announcement-chat-message.png')
  }
}
