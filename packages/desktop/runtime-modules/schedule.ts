import { engine } from '@dcl/sdk/ecs'

// Tick helpers. Game logic runs on dt-accumulator systems, not wall-clock
// timers — and anything that must survive the server sleeping is an absolute
// deadline derived from the clock (see pure/countdown.ts), never a running
// setTimeout.

export {
  remainingMs,
  isExpired,
  countdownRemainingMs,
  countdownWithMultiplier,
  settleExpired,
  periodId,
  dailyKey,
  weeklyKey,
  DAY_MS,
  WEEK_MS,
  type CountdownState
} from './pure/countdown'

/**
 * Run `tick` every `seconds` (dt-accumulated, so it pauses with the scene and
 * batches after hitches instead of drifting). Returns a stop function.
 */
export function interval(seconds: number, tick: (elapsed: number) => void, name?: string): () => void {
  let accum = 0
  const system = (dt: number): void => {
    accum += dt
    if (accum < seconds) return
    const elapsed = accum
    accum = 0
    tick(elapsed)
  }
  const systemName = name ?? `runtime-interval-${Math.floor(Math.random() * 1e9)}`
  engine.addSystem(system, undefined, systemName)
  return () => engine.removeSystem(systemName)
}
