// The clock sign. Each client integrates the remaining time from the three
// numbers in game.state.clock, so the round timer costs no messages at all —
// and a player who joins mid-round reads the same face as everybody else.
//
// The faces are whatever text entities are dragged under this one, so adding a
// second face is a hierarchy gesture, not a param.
import { TextShape, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { childrenOf, game } from './runtime/game'
import { asClock, clockText } from './pure/clock'

const PAINT_S = 0.2

export class ClockBoard {
  private accum = 0
  private painted = ''

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  update(dt: number): void {
    if (isServer()) { return }
    this.accum += dt
    if (this.accum < PAINT_S) return
    this.accum = 0
    const clock = asClock(game.state.clock)
    if (clock === null) return
    const text = clockText(clock, game.now())
    if (text === this.painted) return
    this.painted = text
    for (const face of childrenOf(this.entity)) {
      const shape = TextShape.getMutableOrNull(face)
      if (shape !== null) shape.text = text
    }
  }
}
