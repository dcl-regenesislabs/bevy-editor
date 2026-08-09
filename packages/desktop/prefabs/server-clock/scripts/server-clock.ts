import { Entity, TextShape } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { initTimeSync, getServerTime, isTimeSyncReady } from './runtime/timeSync'
import { mountClockHud, setClockHudText } from './clock-hud'

// Displays the Multiplayer Server's clock, NTP-synced, identical for every
// player — as floating 3D text, or as a 2D overlay with `onScreen`. The script
// carries its own server half: initTimeSync() registers the server-side
// responder, so dropping the prefab is all the setup there is.

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

export class ServerClock {
  private accum = 0

  constructor(
    public src: string,
    public entity: Entity,
    /** Label above the time */ public label: string = 'SERVER TIME',
    /** Show in UTC instead of each viewer's timezone */ public utc: boolean = true,
    /** How the clock is shown */ public display: '3D text' | '2D UI' = '3D text',
    /** Where the 2D UI sits on screen */ public position: 'top' | 'top left' | 'top right' | 'bottom' = 'top'
  ) {}

  private get onScreen(): boolean {
    return this.display === '2D UI'
  }

  start(): void {
    initTimeSync()
    if (isServer()) return
    if (this.onScreen) {
      // the 3D text becomes the overlay — remove the placed shape
      TextShape.deleteFrom(this.entity)
      mountClockHud(this.entity, this.position)
    }
    this.render('--:--:--')
  }

  update(dt: number): void {
    if (isServer()) return
    this.accum += dt
    if (this.accum < 0.25) return
    this.accum = 0
    if (!isTimeSyncReady()) return
    this.render(this.formatTime(new Date(getServerTime())))
  }

  private formatTime(d: Date): string {
    const parts = this.utc
      ? [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
      : [d.getHours(), d.getMinutes(), d.getSeconds()]
    return parts.map(pad).join(':')
  }

  private render(time: string): void {
    if (this.onScreen) {
      setClockHudText(this.label, time)
      return
    }
    TextShape.createOrReplace(this.entity, {
      text: this.label === '' ? time : `${this.label}\n${time}`,
      fontSize: 4,
      textColor: { r: 1, g: 1, b: 1, a: 1 },
      outlineColor: { r: 0, g: 0, b: 0 },
      outlineWidth: 0.1
    })
  }
}
