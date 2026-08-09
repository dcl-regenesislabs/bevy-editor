// Attempts, finish validation, and the madness: every finisher makes the round
// clock drain faster for everyone still climbing.
//
// The two halves of this file are the whole model, and the branches below are
// where to read them: only a client can see where its own avatar is, so only a
// client can notice a summit, and all it does is ask. The answer is worked out
// once, against the server's own view of that player's feet and its own start
// stamp.
import { Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { game, type Player } from './runtime/game'
import { asClock, remainingNow } from './pure/clock'
import { asRuns } from './pure/boards'
import { BASE_Y, topFor } from './pure/tower'
import { showVerdict, type Verdict } from './race-ui'

const FINISH = 'finish'
const ANNOUNCE = 'announce'
const START_ZONE = 'Start'
const CLOCK_KEY = 'clock'
const FINISHERS_KEY = 'finishers'
const FLOW_KEY = 'flow'
// Positions reach the server as feet at about 10 Hz, so the summit check is
// generous by half a chunk — an honest climber standing on the cap must pass.
const SUMMIT_SLACK_M = 3
// A client asks once it is essentially there, and re-arms back at the base.
const ASK_WITHIN_M = 1
const REARM_ABOVE_BASE_M = 4

// Round 1 is the round every scene boots into, and Game Flow keeps it as the
// lobby. Nothing closes a round there, so a finish taken then would be recorded
// and never paid — refuse it instead of banking a run that goes nowhere.
function inRound(): boolean {
  const fact = game.state[FLOW_KEY]
  if (typeof fact !== 'object' || fact === null) return false
  return (fact as Record<string, unknown>).phase === 'round'
}

export class MadnessRace {
  /** When each player last walked through the start gate. Keyed on round.id,
   * not round.number: the number counts from 1 again after the server sleeps. */
  private attempt: Record<Player, { atMs: number; round: string }> = {}
  /** Whether this player's request is already out. */
  private asked = false

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start(): void {
    if (isServer()) {
      game.onEnterArea(START_ZONE, (player) => {
        this.attempt[player] = { atMs: game.now(), round: game.round.id }
      })
      game.onRequest(FINISH, (_data: unknown, player: Player) => this.finish(player))
    }
  }

  update(): void {
    if (isServer()) { return }
    const round = game.round
    if (round.number <= 0) return
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me === null) return
    if (me.position.y < BASE_Y + REARM_ABOVE_BASE_M) this.asked = false
    if (this.asked || me.position.y < topFor(round.seed) - ASK_WITHIN_M) return
    this.asked = true
    // the answer IS the verdict — no broadcast to filter, no timeout to hand-roll
    void game.request<Verdict>(FINISH, {}).then(showVerdict, (error: unknown) =>
      showVerdict({ ok: false, why: error instanceof Error ? error.message : String(error) })
    )
  }

  /** The payload is empty on purpose: everything that decides this — who asked,
   * where they are, when they started — the server already knows. */
  private finish(player: Player): Verdict {
    const round = game.round
    if (!inRound()) return { ok: false, why: 'the round has not started yet — wait for the clock' }
    // "already finished" first: a run clears its own attempt, so asking the
    // other way round tells a finisher to start again instead of the truth
    const done = asRuns(game.state[FINISHERS_KEY])
    if (done.some((run) => run.p === player)) return { ok: false, why: 'already finished this round' }
    const attempt = this.attempt[player]
    if (attempt === undefined || attempt.round !== round.id) {
      return { ok: false, why: 'start again from the gate' }
    }
    const feet = game.positionOf(player)
    if (feet === null || feet.y < topFor(round.seed) - SUMMIT_SLACK_M) {
      return { ok: false, why: 'not at the summit' }
    }
    delete this.attempt[player]
    const now = game.now()
    const time = (now - attempt.atMs) / 1000
    const finishers = [...done, { p: player, time }]
    const speed = finishers.length + 1
    const clock = asClock(game.state[CLOCK_KEY])
    game.setState({
      [FINISHERS_KEY]: finishers,
      ...(clock === null ? {} : { [CLOCK_KEY]: { at: now, left: remainingNow(clock, now), speed } })
    })
    game.broadcast(ANNOUNCE, { text: `A climber made it — the clock now drains x${speed}` })
    console.log(`[server] finish accepted — ${time.toFixed(2)}s, the clock now drains x${speed}`)
    return { ok: true, time }
  }
}
