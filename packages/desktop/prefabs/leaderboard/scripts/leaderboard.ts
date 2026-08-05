// A named board on a panel: the Multiplayer Server keeps the scores, this script
// installs the board on the server half and paints the client half onto the
// TextShape child of the placed model. The board's identity is its NAME, so two
// instances with different names are two independent boards in one scene.
//
// The panel is ordinary scene content: swap board-panel.glb for your own model
// and keep (or restyle) the text child — the script writes only its `text`, so
// font, size and colour stay exactly as authored.
import { TextShape, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { fetchBoard, installLeaderboard } from './board-api'
import { renderPanel } from './pure/board'

const REFRESH_S = 5
const WAITING = 'waiting for the Multiplayer Server…'
const EMPTY = 'no scores yet'

export class Leaderboard {
  private panel: Entity | null = null
  private accum = REFRESH_S
  private busy = false
  private painted = ''

  constructor(
    public src: string,
    public entity: Entity,
    /** Board name. Also the panel's title, and what keeps two boards in one scene apart. */
    public board: string = 'Points',
    /** Which score wins: desc keeps the highest (points), asc keeps the lowest (best time). */
    public sort: 'desc' | 'asc' = 'desc',
    /** Start a fresh board every week, or keep one all-time board. */
    public rollover: 'none' | 'weekly' = 'none',
    /** How many places the panel lists. */
    public rows: number = 8
  ) {}

  start(): void {
    installLeaderboard({ board: this.board, sort: this.sort, rollover: this.rollover })
    if (isServer()) return
    this.panel = this.findPanel()
    this.paint(`${this.board}\n\n${WAITING}`)
  }

  update(dt: number): void {
    if (isServer() || this.panel === null || this.busy) return
    this.accum += dt
    if (this.accum < REFRESH_S) return
    this.accum = 0
    this.busy = true
    void this.refresh()
  }

  private async refresh(): Promise<void> {
    const view = await fetchBoard(this.board, this.rows)
    this.busy = false
    this.paint(
      renderPanel({
        title: this.board,
        rows: view.rows,
        you: view.you,
        placeholder: view.live ? EMPTY : WAITING
      })
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
