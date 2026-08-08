// The madness clock: three numbers every screen integrates locally.
//
// `at` is when the clock last changed, `left` is how many seconds remained at
// that instant, `speed` is how fast it drains now. Every finisher raises the
// speed, so the wire carries one small fact per finish instead of a countdown
// per tick — and a player who joins mid-round lands on the right number by
// arithmetic, from the snapshot, with no extra message.

export interface Clock {
  at: number
  left: number
  speed: number
}

/** Defensive read: the clock crossed the wire and any script can clobber a key. */
export function asClock(value: unknown): Clock | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const num = (key: keyof Clock): number | null => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  const at = num('at')
  const left = num('left')
  const speed = num('speed')
  if (at === null || left === null || speed === null) return null
  return { at, left: Math.max(0, left), speed: Math.max(1, speed) }
}

/** Seconds still on the clock at `nowMs`. */
export function remainingNow(clock: Clock, nowMs: number): number {
  const drained = ((nowMs - clock.at) / 1000) * clock.speed
  return Math.max(0, Math.min(clock.left, clock.left - drained))
}

/** What the sign reads: m:ss, plus the multiplier once anybody has finished. */
export function clockText(clock: Clock, nowMs: number): string {
  const left = Math.floor(remainingNow(clock, nowMs))
  const rest = left % 60
  const face = `${Math.floor(left / 60)}:${rest < 10 ? '0' : ''}${rest}`
  return clock.speed > 1 ? `${face}  x${clock.speed}` : face
}
