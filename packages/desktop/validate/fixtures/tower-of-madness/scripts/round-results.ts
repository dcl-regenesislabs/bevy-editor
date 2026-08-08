// What a round is worth, and when it ends.
//
// The madness clock owns the ending, so Game Flow is placed with "Who ends a
// round: your own script" — its round length stays as a ceiling that keeps a
// forgotten game.newRound() from wedging the loop, and every round start (its
// own and this one's) still comes through Game Flow's single hook, which is what
// stops the two from both ending one round.
//
// Points accumulate privately in game.playerData; the top ten are folded into
// game.saved and copied into game.state, because playerData cannot be listed and
// a board has to be a fact every screen can read.
import { Transform, type Entity } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { game } from './runtime/game'
import { asClock, remainingNow, type Clock } from './pure/clock'
import { asRuns, asScores, bestTimes, season } from './pure/boards'
import { showPodium } from './race-ui'

const CLOCK_KEY = 'clock'
const FINISHERS_KEY = 'finishers'
const FLOW_KEY = 'flow'
const TIMES_BOARD = 'leaderboard'
const POINTS_BOARD = 'seasonBoard'
const SAVED_TIMES = 'bestTimes'
const SAVED_SEASON = 'season'
const ROUND_OVER = 'roundOver'
const PODIUM = [100, 90, 80]
const FINISH_POINTS = 30

interface PlayerRecord extends Record<string, unknown> {
  points: number
  best: number
}

/** True while Game Flow says a round is actually being played. */
function inRound(): boolean {
  const fact = game.state[FLOW_KEY]
  if (typeof fact !== 'object' || fact === null) return false
  return (fact as Record<string, unknown>).phase === 'round'
}

export class RoundResults {
  constructor(
    public src: string,
    public entity: Entity,
    /** How long a round lasts before anybody finishes. Finishers drain it faster. */
    public roundSeconds: number = 420,
    /** How long the podium stays up before the next round's clock starts. */
    public breakSeconds: number = 10,
    /** Where players land when a round ends. Pick the pad by the start gate. */
    public home: Entity = 0 as Entity
  ) {}

  start(): void {
    game.onStart(() => {
      game.setState({
        [CLOCK_KEY]: this.freshClock(),
        [FINISHERS_KEY]: [],
        [TIMES_BOARD]: asRuns(game.saved.get(SAVED_TIMES)),
        [POINTS_BOARD]: asScores(game.saved.get(SAVED_SEASON))
      })
    })
    // every round start lands here, whether Game Flow began it or close() did
    game.onRoundStart(() => {
      game.setState({ [CLOCK_KEY]: this.freshClock(), [FINISHERS_KEY]: [] })
    })
    game.every(1, () => {
      if (!inRound()) return
      const clock = asClock(game.state[CLOCK_KEY])
      if (clock === null || remainingNow(clock, game.now()) > 0) return
      this.close()
    })
    // told by the game, obeyed by every screen: only a player's own screen can
    // move that player
    game.onMessage(ROUND_OVER, (data: unknown) => this.landed(data))
  }

  /** In the game: pay the finishers, fold both boards, tell everyone, next round. */
  private close(): void {
    const finishers = asRuns(game.state[FINISHERS_KEY])
    for (const [place, run] of finishers.entries()) {
      const record = game.playerData<PlayerRecord>(run.p).get()
      game.playerData<PlayerRecord>(run.p).set({
        points: (record.points ?? 0) + (PODIUM[place] ?? FINISH_POINTS),
        best: record.best === undefined ? run.time : Math.min(record.best, run.time)
      })
    }
    const times = bestTimes(asRuns(game.saved.get(SAVED_TIMES)), finishers)
    const points = season(asScores(game.saved.get(SAVED_SEASON)), finishers, PODIUM, FINISH_POINTS)
    game.saved.set(SAVED_TIMES, times)
    game.saved.set(SAVED_SEASON, points)
    game.setState({ [TIMES_BOARD]: times, [POINTS_BOARD]: points })
    void game.send(ROUND_OVER, { top: finishers.slice(0, PODIUM.length) })
    game.newRound()
  }

  /** On this player's screen. */
  private landed(data: unknown): void {
    const top = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).top : []
    showPodium(asRuns(top))
    const spot = Transform.getOrNull(this.home)
    if (spot === null) return
    void movePlayerTo({ newRelativePosition: spot.position })
  }

  private freshClock(): Clock {
    // the break is the clock starting in the future: it reads full while the
    // podium is up, then drains — one number instead of a second phase machine
    return { at: game.now() + Math.max(0, this.breakSeconds) * 1000, left: Math.max(1, this.roundSeconds), speed: 1 }
  }
}
