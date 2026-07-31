import { iconPath } from '../../icons'

export interface VideoIcons {
  play: string
  pause: string
  loop: string
  mute: string
  volumeMinus: string
  volumePlus: string
  sourceVideo: string
  sourceLive: string
  sourceCast: string
  info: string
  help: string
  eyeShow: string
  eyeHide: string
  copy: string
  star: string
  chevronUp: string
  chevronDown: string
  person: string
  error: string
}

function build(base: string): VideoIcons {
  const icon = (name: string): string => iconPath(base, `video/${name}`)
  return {
    play: icon('video-control-play-button.png'),
    pause: icon('video-control-pause-button.png'),
    loop: icon('video-control-loop.png'),
    mute: icon('video-control-mute.png'),
    volumeMinus: icon('video-control-volume-minus-button.png'),
    volumePlus: icon('video-control-volume-plus-button.png'),
    sourceVideo: icon('video-control-video-icon.png'),
    sourceLive: icon('video-control-live.png'),
    sourceCast: icon('video-control-dcl-cast.png'),
    info: icon('info.png'),
    help: icon('help.png'),
    eyeShow: icon('eye.png'),
    eyeHide: icon('eye-off.png'),
    copy: icon('copy-to-clipboard.png'),
    star: icon('star.png'),
    chevronUp: icon('chevron-up.png'),
    chevronDown: icon('chevron-down.png'),
    person: icon('person-outline.png'),
    error: icon('error.png')
  }
}

// Rebuilt only when the prefab folder changes — this runs on every rendered frame.
let cachedKey: string | undefined
let cached: VideoIcons = build('')

export function videoIcons(base: string): VideoIcons {
  if (base === cachedKey) return cached
  cachedKey = base
  cached = build(base)
  return cached
}
