// Phase arithmetic for the Round Loop. SDK-free on purpose: the whole schedule
// is a pure function of (phaseStartMs, durations), so a client that joins late,
// a server that ticks late and a server that restarts all derive the same answer
// from the same four numbers.
//
// The loop is lobby → wave 1 → intermission → wave 2 → intermission → …
// Phase 0 is the lobby, odd phases are waves, even phases above 0 are
// intermissions. A phase never starts "now": it starts at the previous phase's
// deadline, which is what keeps a hitched tick from pushing every later deadline
// out by the same amount.

export type PhaseKind = 'lobby' | 'wave' | 'intermission'

export interface PhaseDurations {
  lobbyMs: number
  waveMs: number
  intermissionMs: number
}

/** The four numbers every client needs to reconstruct the round. Server-owned. */
export interface RoundTuple {
  seed: number
  phase: number
  phaseStartMs: number
  configVersion: number
}

export const LOBBY_PHASE = 0
export const MIN_PHASE_SECONDS = 1
export const MAX_PHASE_SECONDS = 3600

/** A creator can type anything into a number field; a 0-second wave would spin the FSM. */
export function clampSeconds(value: number): number {
  if (!Number.isFinite(value)) return MIN_PHASE_SECONDS
  return Math.min(MAX_PHASE_SECONDS, Math.max(MIN_PHASE_SECONDS, Math.round(value)))
}

export function durationsFromSeconds(lobby: number, wave: number, intermission: number): PhaseDurations {
  return {
    lobbyMs: clampSeconds(lobby) * 1000,
    waveMs: clampSeconds(wave) * 1000,
    intermissionMs: clampSeconds(intermission) * 1000
  }
}

export function phaseKind(phase: number): PhaseKind {
  if (!Number.isFinite(phase) || phase <= LOBBY_PHASE) return 'lobby'
  return Math.floor(phase) % 2 === 1 ? 'wave' : 'intermission'
}

/** 1-based wave number, or 0 outside a wave. */
export function waveNumber(phase: number): number {
  return phaseKind(phase) === 'wave' ? (Math.floor(phase) + 1) / 2 : 0
}

export function phaseDurationMs(phase: number, durations: PhaseDurations): number {
  switch (phaseKind(phase)) {
    case 'lobby':
      return durations.lobbyMs
    case 'wave':
      return durations.waveMs
    default:
      return durations.intermissionMs
  }
}

export function phaseEndsAtMs(tuple: RoundTuple, durations: PhaseDurations): number {
  return tuple.phaseStartMs + phaseDurationMs(tuple.phase, durations)
}

export function remainingMs(tuple: RoundTuple, durations: PhaseDurations, nowMs: number): number {
  return Math.max(0, phaseEndsAtMs(tuple, durations) - nowMs)
}

/** Whole seconds left, the way a countdown reads them — 0 only once the phase is over. */
export function countdownSeconds(tuple: RoundTuple, durations: PhaseDurations, nowMs: number): number {
  return Math.ceil(remainingMs(tuple, durations, nowMs) / 1000)
}

export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`
}

export function phaseLabel(phase: number): string {
  const kind = phaseKind(phase)
  if (kind === 'lobby') return 'LOBBY'
  if (kind === 'intermission') return 'INTERMISSION'
  return `WAVE ${waveNumber(phase)}`
}

/** soloMode overrides the setting outright — it is the "let me test alone" switch. */
export function requiredPlayers(minPlayers: number, soloMode: boolean): number {
  if (soloMode) return 1
  if (!Number.isFinite(minPlayers)) return 1
  return Math.max(1, Math.round(minPlayers))
}

export function isReady(present: number, minPlayers: number, soloMode: boolean): boolean {
  return present >= requiredPlayers(minPlayers, soloMode)
}

/** A fresh round: back to the lobby with a new seed, starting now. */
export function startRound(seed: number, nowMs: number, configVersion: number): RoundTuple {
  return { seed, phase: LOBBY_PHASE, phaseStartMs: nowMs, configVersion }
}

/**
 * The next phase, starting exactly at this one's deadline. `configVersion` is the
 * Game Config version pinned for the phase being entered — consumers read their
 * config through it, so a live edit lands on a boundary and never mid-wave.
 */
export function advance(tuple: RoundTuple, durations: PhaseDurations, configVersion: number): RoundTuple {
  return {
    seed: tuple.seed,
    phase: Math.floor(tuple.phase) + 1,
    phaseStartMs: phaseEndsAtMs(tuple, durations),
    configVersion
  }
}

/** Hold the current phase's countdown at full — the parked / not-enough-players state. */
export function holdAt(tuple: RoundTuple, nowMs: number): RoundTuple {
  return { ...tuple, phaseStartMs: nowMs }
}

export interface CatchUp {
  tuple: RoundTuple
  steps: number
  /** True when `maxSteps` ran out before the schedule reached `nowMs`. */
  exhausted: boolean
}

/**
 * Fast-forward an expired tuple to the phase that is current at `nowMs`. Used every
 * server tick (normally 0 or 1 steps) and again at cold start, where the restored
 * tuple can be arbitrarily old — `exhausted` is the caller's signal to start over
 * rather than replay hours of phases.
 *
 * Lobby is deliberately NOT auto-advanced: leaving it is a readiness decision, not
 * a clock one, so the caller owns that edge.
 */
export function catchUp(
  tuple: RoundTuple,
  durations: PhaseDurations,
  nowMs: number,
  maxSteps: number,
  configVersion: number
): CatchUp {
  let current = tuple
  let steps = 0
  while (nowMs >= phaseEndsAtMs(current, durations)) {
    if (steps >= maxSteps) return { tuple: current, steps, exhausted: true }
    current = advance(current, durations, configVersion)
    steps++
  }
  return { tuple: current, steps, exhausted: false }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Defensive read of a tuple that came back from Storage or off the wire. A single
 * corrupt field would otherwise poison every derived deadline for the whole round.
 */
export function sanitizeTuple(value: unknown, fallback: RoundTuple): RoundTuple {
  if (typeof value !== 'object' || value === null) return fallback
  const record = value as Record<string, unknown>
  const phase = Math.floor(finiteOr(record.phase, fallback.phase))
  return {
    seed: Math.floor(finiteOr(record.seed, fallback.seed)),
    phase: phase < LOBBY_PHASE ? LOBBY_PHASE : phase,
    phaseStartMs: Math.floor(finiteOr(record.phaseStartMs, fallback.phaseStartMs)),
    configVersion: Math.max(0, Math.floor(finiteOr(record.configVersion, fallback.configVersion)))
  }
}
