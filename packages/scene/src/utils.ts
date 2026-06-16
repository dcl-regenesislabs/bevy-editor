import { engine } from '@dcl/sdk/ecs'

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let elapsed = 0
    const tick = (dt: number): void => {
      elapsed += dt * 1000
      if (elapsed >= ms) {
        engine.removeSystem(tick)
        resolve()
      }
    }
    engine.addSystem(tick)
  })
}

// Polls `predicate` once per frame until it returns true (or `timeoutMs` elapses).
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 0
): Promise<void> {
  let elapsed = 0
  await new Promise<void>((resolve, reject) => {
    const tick = (dt: number): void => {
      elapsed += dt * 1000
      if (predicate()) {
        engine.removeSystem(tick)
        resolve()
      } else if (timeoutMs > 0 && elapsed >= timeoutMs) {
        engine.removeSystem(tick)
        reject(new Error('waitFor timed out'))
      }
    }
    engine.addSystem(tick)
  })
}
