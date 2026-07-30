import { iconPath } from '../../icons'

export interface RewardsIcons {
  send: string
  close: string
}

export function rewardsIcons(base: string): RewardsIcons {
  return {
    send: iconPath(base, 'rewards/send.png'),
    close: iconPath(base, 'rewards/close.png')
  }
}
