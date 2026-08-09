// The server says something; every player sees it. One line, centred near the
// top, gone a few seconds later.
//
// This is the listening half of the ordinary broadcast pair: server code
// anywhere in the scene calls game.broadcast('announce', { text }) and this
// piece draws it for every player. It is a moment, not a fact — a player who
// arrives afterwards never sees it, which is why standings belong in game.state.
import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import type { Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { game } from './runtime/game'
import { clampHold, toastText } from './pure/toast'
import { claimUiRenderer, VIRTUAL_CANVAS } from './ui-owner'

const ANNOUNCE = 'announce'
const OWNER = 'Announcer'
const BACKDROP = Color4.create(0, 0, 0, 0.65)

export class Announcer {
  private text = ''
  private leftS = 0
  private rendering = false

  constructor(
    public src: string,
    public entity: Entity,
    /** How long a message stays up. */
    public holdSeconds: number = 4,
    /** Text size at 1920×1080. */
    public fontSize: number = 32
  ) {}

  start(): void {
    if (isServer()) { return }
    // Claim before handling: one name has one handler, so a copy that cannot
    // draw must not take the name away from the copy that can.
    this.rendering = claimUiRenderer(OWNER)
    if (!this.rendering) return
    ReactEcsRenderer.setUiRenderer(() => this.render(), VIRTUAL_CANVAS)
    game.onBroadcast(ANNOUNCE, (data: unknown) => this.show(data))
  }

  update(dt: number): void {
    if (isServer()) { return }
    if (this.leftS <= 0) return
    this.leftS -= dt
    if (this.leftS <= 0) this.text = ''
  }

  private show(data: unknown): void {
    const text = toastText(data)
    if (text === null) return
    this.text = text
    this.leftS = clampHold(this.holdSeconds)
  }

  private render(): ReactEcs.JSX.Element | null {
    if (this.text === '') return null
    return (
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          alignItems: 'flex-start',
          justifyContent: 'center'
        }}
      >
        <UiEntity
          uiTransform={{
            margin: { top: 96 },
            padding: { top: 12, bottom: 12, left: 28, right: 28 },
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center'
          }}
          uiBackground={{ color: BACKDROP }}
        >
          <Label value={this.text} fontSize={this.fontSize} color={Color4.White()} />
        </UiEntity>
      </UiEntity>
    )
  }
}
