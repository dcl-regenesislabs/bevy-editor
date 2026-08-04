// Browser replacements for the scene's engine-tick based timing helpers.

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// Polls `predicate` until it returns true (or `timeoutMs` elapses, if > 0).
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 0
): Promise<void> {
  let elapsed = 0
  while (!predicate()) {
    if (timeoutMs > 0 && elapsed >= timeoutMs) {
      throw new Error('waitFor timed out')
    }
    await sleep(50)
    elapsed += 50
  }
}
