import { iconPath } from '../../icons'

export interface ModerationIcons {
  verified: string
  person: string
  ban: string
  close: string
  chevronBack: string
  chevronForward: string
  error: string
}

export function moderationIcons(base: string): ModerationIcons {
  return {
    verified: iconPath(base, 'moderation/admin-panel-verified-user.png'),
    person: iconPath(base, 'moderation/person-outline.png'),
    ban: iconPath(base, 'moderation/ban.png'),
    close: iconPath(base, 'moderation/close.png'),
    chevronBack: iconPath(base, 'moderation/chevron-back.png'),
    chevronForward: iconPath(base, 'moderation/chevron-forward.png'),
    error: iconPath(base, 'moderation/error.png')
  }
}
