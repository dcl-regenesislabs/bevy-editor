// A board on a panel. It reads one `game.state` key and paints it — nothing
// here decides a score, and nothing here stores one. The game writes the rows
// (see ai.md in this folder for the idiom); two boards pointed at two keys are
// two independent boards in one scene, and two pointed at the same key show the
// same thing on both walls.
//
// The panel is ordinary scene content: swap board-panel.glb for your own model
// and keep (or restyle) the text child — the script writes only its `text`, so
// font, size and colour stay exactly as authored.
import { TextShape, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { game } from './runtime/game'
import { boardRows, clampRows, renderPanel } from './pure/board'

const EMPTY = 'Nothing to show yet — set the board key your game writes to.'

export class Leaderboard {
  private panel: Entity | null = null
  private painted = ''

  constructor(
    public src: string,
    public entity: Entity,
    /** The panel's title. */
    public title: string = 'Leaderboard',
    /** The game.state key this board shows. The game writes the rows there. */
    public boardKey: string = 'leaderboard',
    /** Which score wins: highest keeps points, lowest keeps best times. */
    public sort: 'desc' | 'asc' = 'desc',
    /** How many places the panel lists. */
    public rows: number = 8
  ) {}

  start(): void {
    this.panel = this.findPanel()
    game.onStateChange(() => this.repaint())
    this.repaint()
  }

  private repaint(): void {
    this.paint(
      renderPanel(this.title, boardRows(game.state[this.boardKey], this.sort, clampRows(this.rows)), this.sort, EMPTY)
    )
  }

  // The text lives on a child so the model can be replaced without touching it.
  private findPanel(): Entity {
    for (const [entity, transform] of engine.getEntitiesWith(Transform)) {
      if (transform.parent === this.entity && TextShape.getOrNull(entity) !== null) return entity
    }
    return this.entity
  }

  private paint(text: string): void {
    const panel = this.panel
    if (panel === null || text === this.painted) return
    this.painted = text
    const shape = TextShape.getMutableOrNull(panel)
    if (shape !== null) {
      shape.text = text
      return
    }
    TextShape.createOrReplace(panel, { text, fontSize: 0.8 })
  }
}
