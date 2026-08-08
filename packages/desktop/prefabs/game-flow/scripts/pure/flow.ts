// Game Flow's phase arithmetic, with no SDK and no I/O.
//
// The loop is lobby → round → intermission → round → …, and every phase is a
// deadline rather than a timer: the game writes when a phase ENDS, and each
// screen derives its countdown from that one number against the shared clock.
// A player who joins mid-round therefore lands on the same countdown as
// everyone else without a single extra message.
//
// The lobby parks (endsAtMs 0) while the scene is short of players, so a round
// never burns down in an empty world and the next arrival gets a full lobby.

export type FlowPhase = 'lobby' | 'round' | 'intermission'

/** What the flow wants the caller to do at this tick. */
export type FlowAction = 'none' | 'startRound' | 'endRound'

export interface FlowConfig {
  roundMs: number
  countdownMs: number
  intermissionMs: number
  minPlayers: number
}

/** The machine's own state. `round` counts rounds PLAYED, from 1. */
export interface FlowState {
  phase: FlowPhase
  endsAtMs: number
  round: number
}

/**
 * What the game publishes. The head count only exists in the game — a screen has
 * no roster — so it rides the fact rather than being counted twice.
 */
export interface FlowFact extends FlowState {
  present: number
}

export const MIN_SECONDS = 1
export const MAX_SECONDS = 3600

/** A creator can type anything into a number field; a 0-second round would spin. */
export function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return MIN_SECONDS
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value)))
}

export function configFromSeconds(
  round: number,
  countdown: number,
  intermission: number,
  minPlayers: number
): FlowConfig {
  return {
    roundMs: clampSeconds(round) * 1000,
    countdownMs: clampSeconds(countdown) * 1000,
    intermissionMs: clampSeconds(intermission) * 1000,
    minPlayers: Number.isFinite(minPlayers) ? Math.max(1, Math.round(minPlayers)) : 1
  }
}

export function lobbyState(): FlowState {
  return { phase: 'lobby', endsAtMs: 0, round: 0 }
}

/** Defensive read: the fact crossed the wire and a script can clobber the key. */
export function asFlowFact(value: unknown): FlowFact | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const phase = record.phase
  if (phase !== 'lobby' && phase !== 'round' && phase !== 'intermission') return null
  const num = (key: string): number => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0
  }
  return { phase, endsAtMs: num('endsAtMs'), round: num('round'), present: num('present') }
}

/**
 * One tick of the machine. Pure: the caller owns the clock, the head count, and
 * the two side effects (`startRound` calls game.newRound, `endRound` closes the
 * round out). Rounds never end here in script mode by accident — the caller
 * decides whether an expired round deadline is the end or only a ceiling.
 */
export function advanceFlow(
  state: FlowState,
  config: FlowConfig,
  present: number,
  nowMs: number
): { state: FlowState; action: FlowAction } {
  if (state.phase === 'round') {
    if (state.endsAtMs > 0 && nowMs >= state.endsAtMs) return { state, action: 'endRound' }
    return { state, action: 'none' }
  }
  const ready = present >= config.minPlayers
  if (state.phase === 'intermission') {
    if (nowMs < state.endsAtMs) return { state, action: 'none' }
    if (!ready) return { state: { phase: 'lobby', endsAtMs: 0, round: state.round }, action: 'none' }
    return { state, action: 'startRound' }
  }
  if (!ready) {
    if (state.endsAtMs === 0) return { state, action: 'none' }
    return { state: { ...state, endsAtMs: 0 }, action: 'none' }
  }
  if (state.endsAtMs === 0) {
    return { state: { ...state, endsAtMs: nowMs + config.countdownMs }, action: 'none' }
  }
  if (nowMs >= state.endsAtMs) return { state, action: 'startRound' }
  return { state, action: 'none' }
}

// A round always carries a deadline, even where a script owns the end: it is the
// ceiling that keeps a forgotten game.newRound() from wedging the loop forever.
// Only the panel differs — in script mode it hides a clock it does not own.
export function roundState(state: FlowState, config: FlowConfig, nowMs: number): FlowState {
  return { phase: 'round', endsAtMs: nowMs + config.roundMs, round: state.round + 1 }
}

export function intermissionState(state: FlowState, config: FlowConfig, nowMs: number): FlowState {
  return { phase: 'intermission', endsAtMs: nowMs + config.intermissionMs, round: state.round }
}

/** Whole seconds left, the way a countdown reads them. */
export function secondsLeft(state: { endsAtMs: number }, nowMs: number): number {
  if (state.endsAtMs === 0) return 0
  return Math.max(0, Math.ceil((state.endsAtMs - nowMs) / 1000))
}

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const rest = total % 60
  return `${Math.floor(total / 60)}:${rest < 10 ? '0' : ''}${rest}`
}

/** One row of whatever a board key holds — the shapes real games write vary. */
export interface Standing {
  player: string
  score: number
}

const PLAYER_FIELDS = ['player', 'p', 'address', 'wallet', 'name']
const SCORE_FIELDS = ['score', 'points', 'pts', 'value', 'seconds', 'time', 'best']

/**
 * Read a board out of a `game.state` key. Creators write these rows themselves,
 * so the field names differ game to game — anything with a player-ish and a
 * number-ish field is a standing, and anything else is skipped rather than
 * rendered as `[object Object]`.
 */
export function standingsOf(value: unknown): Standing[] {
  if (!Array.isArray(value)) return []
  const out: Standing[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const playerKey = PLAYER_FIELDS.find((key) => typeof record[key] === 'string' && record[key] !== '')
    const scoreKey = SCORE_FIELDS.find((key) => typeof record[key] === 'number' && Number.isFinite(record[key]))
    if (playerKey === undefined || scoreKey === undefined) continue
    out.push({ player: String(record[playerKey]), score: Number(record[scoreKey]) })
  }
  return out
}

/** Wallets are long; a podium line reads better with the tail. */
export function shortName(player: string): string {
  return player.startsWith('0x') && player.length > 10 ? `${player.slice(0, 6)}…${player.slice(-4)}` : player
}

/** The winners line the game tells every player at the end of a round. */
export function podiumLine(value: unknown, places: number): string {
  const top = standingsOf(value).slice(0, Math.max(1, places))
  if (top.length === 0) return 'Round over — nobody scored.'
  return `Round over — ${top.map((row, i) => `${i + 1}. ${shortName(row.player)}`).join('  ')}`
}

export function panelText(fact: FlowFact | null, nowMs: number, showClock: boolean, needed: number): string {
  if (fact === null) return 'GAME FLOW\n--:--\nwaiting for the Multiplayer Server'
  if (fact.phase === 'lobby') {
    if (fact.endsAtMs === 0) return `LOBBY\n--:--\n${fact.present}/${needed} players`
    return `LOBBY\n${formatCountdown(secondsLeft(fact, nowMs))}\nstarting`
  }
  if (fact.phase === 'intermission') return `ROUND ${fact.round} OVER\n${formatCountdown(secondsLeft(fact, nowMs))}`
  if (!showClock) return `ROUND ${fact.round}`
  return `ROUND ${fact.round}\n${formatCountdown(secondsLeft(fact, nowMs))}`
}
