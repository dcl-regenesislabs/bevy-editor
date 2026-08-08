// Lobby, countdown, rounds, winners — the piece that runs a game from start to
// end. Everything it decides happens in the game, for everyone; the sign on the
// placed entity is what each screen draws from those decisions.
//
// The flow rides one shared fact, `game.state.flow` — a phase, the instant that
// phase ends, and the number of rounds played. Nothing here is a timer, so a
// player who joins mid-round reads the same countdown as everybody else, and a
// restart lands every screen on the phase the game is actually in.
//
// A script may end the round itself with game.newRound(); this piece follows it
// rather than fighting it. See ai.md in this folder.
import { TextShape, type Entity } from '@dcl/sdk/ecs'
import { game } from './runtime/game'
import {
  advanceFlow,
  asFlowFact,
  configFromSeconds,
  intermissionState,
  lobbyState,
  panelText,
  podiumLine,
  roundState,
  type FlowConfig,
  type FlowState
} from './pure/flow'

const FLOW_KEY = 'flow'
const ANNOUNCE = 'announce'
const TICK_S = 0.25
const PAINT_S = 0.2
const PODIUM_PLACES = 3

// One Game Flow runs the game. A second placed copy still paints its own sign,
// but never drives the phases: two machines writing one fact is a fight with no
// winner, and a creator would only see the countdown stutter.
let claimed = false

export class GameFlow {
  private primary = false
  private present = new Set<string>()
  private flow: FlowState = lobbyState()
  private accum = 0
  private painted = ''
  private published = ''

  constructor(
    public src: string,
    public entity: Entity,
    /** How long a round lasts. With "script" below this is only a ceiling. */
    public roundSeconds: number = 300,
    /** How long the lobby counts down once enough players are in. */
    public countdownSeconds: number = 10,
    /** How long the winners stay up between rounds. */
    public intermissionSeconds: number = 10,
    /** Players needed before a round starts. */
    public minPlayers: number = 1,
    /** Who ends a round: this clock, or your own script calling game.newRound(). */
    public endsWhen: 'timer' | 'script' = 'timer',
    /** The game.state key the winners come from — the key a Leaderboard shows. */
    public boardKey: string = 'leaderboard'
  ) {}

  private get config(): FlowConfig {
    return configFromSeconds(this.roundSeconds, this.countdownSeconds, this.intermissionSeconds, this.minPlayers)
  }

  start(): void {
    this.primary = !claimed
    claimed = true
    if (!this.primary) {
      console.log('[gameFlow] a second Game Flow is placed — only the first runs the rounds')
      return
    }
    game.onStart(() => {
      this.flow = lobbyState()
      this.publish()
    })
    game.onPlayerJoin((player) => {
      this.present.add(player)
    })
    game.onPlayerLeave((player) => {
      this.present.delete(player)
    })
    // Every round start comes through here — this piece's own and any a script
    // starts — so the two can never both end one round.
    game.onRoundStart((round) => {
      // Round 1 is the round every game boots into; the lobby sits in it.
      if (round.number <= 1) return
      if (this.flow.phase === 'round') this.announcePodium()
      this.flow = roundState(this.flow, this.config, game.now())
      this.publish()
    })
    game.every(TICK_S, () => this.tick())
  }

  update(dt: number): void {
    this.accum += dt
    if (this.accum < PAINT_S) return
    this.accum = 0
    this.paint()
  }

  private tick(): void {
    const config = this.config
    const { state, action } = advanceFlow(this.flow, config, this.present.size, game.now())
    this.flow = state
    if (action === 'startRound') {
      game.newRound()
      return
    }
    if (action === 'endRound') {
      this.announcePodium()
      this.flow = intermissionState(this.flow, config, game.now())
    }
    this.publish()
  }

  private announcePodium(): void {
    void game.send(ANNOUNCE, { text: podiumLine(game.state[this.boardKey], PODIUM_PLACES) })
  }

  private publish(): void {
    const fact = { ...this.flow, present: this.present.size }
    const json = JSON.stringify(fact)
    // 4 Hz of an unchanged fact is 4 Hz of wire traffic for nothing.
    if (json === this.published) return
    this.published = json
    game.setState({ [FLOW_KEY]: fact })
  }

  private paint(): void {
    const fact = asFlowFact(game.state[FLOW_KEY])
    const text = panelText(fact, game.now(), this.endsWhen === 'timer', this.config.minPlayers)
    if (text === this.painted) return
    this.painted = text
    TextShape.createOrReplace(this.entity, {
      text,
      fontSize: 3,
      textColor: { r: 1, g: 1, b: 1, a: 1 },
      outlineColor: { r: 0, g: 0, b: 0 },
      outlineWidth: 0.1
    })
  }
}
