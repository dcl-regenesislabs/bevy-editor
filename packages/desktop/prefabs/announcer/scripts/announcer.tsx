// The game says something; every player sees it. One line, centred near the top
// of the screen, gone a few seconds later.
//
// This is the game's own side of the ordinary send/onMessage pair: green code
// anywhere in the scene calls game.send('announce', { text }) and this piece
// draws it on each screen. It is a moment, not a fact — a player who arrives
// afterwards never sees it, which is why standings belong in game.state.
import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import type { Entity } from '@dcl/sdk/ecs'
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
    /** How long a message stays on screen. */
    public holdSeconds: number = 4,
    /** Text size on a 1920×1080 screen. */
    public fontSize: number = 32
  ) {}

  start(): void {
    // Claim before handling: one name has one handler, so a copy that cannot
    // draw must not take the name away from the copy that can.
    this.rendering = claimUiRenderer(OWNER)
    if (!this.rendering) return
    ReactEcsRenderer.setUiRenderer(() => this.render(), VIRTUAL_CANVAS)
    game.onMessage(ANNOUNCE, (data: unknown) => this.show(data))
  }

  update(dt: number): void {
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
