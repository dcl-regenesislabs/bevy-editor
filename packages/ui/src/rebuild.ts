// Knowing when the project's code was rebuilt.
//
// The scene is served by its own `sdk-commands start` process, which watches the
// project and rebuilds on change. We don't get a structured event from it — the
// desktop shell streams its stdout to us — so the rebuild is detected from the
// build lines it prints. Crude, but it's the only signal that exists, and both
// consumers here degrade to a timed settle when it doesn't arrive.
import { REBUILD_DEBOUNCE_MS, REBUILD_WAIT_MS, REBUILD_SETTLE_MS } from './config'

const BUILD_LINE = /rebuil|recompil|compiled|built in|updated|hmr|watch/i

let lastBuildAt = 0
let wired = false
const listeners = new Set<() => void>()
let debounce: ReturnType<typeof setTimeout> | null = null

// Suppressed while something is already handling the rebuild it caused (Script
// Studio saves, then restarts the scene itself) — otherwise that one edit would
// restart the scene twice.
let suppressed = 0

function wire(): void {
  if (wired) return
  const shell = window.editorShell
  if (shell?.onStackLog === undefined) return
  wired = true
  shell.onStackLog((line) => {
    if (!BUILD_LINE.test(line)) return
    lastBuildAt = Date.now()
    if (listeners.size === 0) return
    // a rebuild prints several matching lines — react once, after they settle
    if (debounce !== null) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      if (suppressed > 0) return
      for (const fn of listeners) fn()
    }, REBUILD_DEBOUNCE_MS)
  })
}

// Run `fn` without the rebuild it causes triggering the auto-reload.
export async function withoutAutoReload<T>(fn: () => Promise<T>): Promise<T> {
  suppressed++
  try {
    return await fn()
  } finally {
    // outlast the debounce, so the lines this rebuild printed are ignored too
    setTimeout(() => suppressed--, REBUILD_DEBOUNCE_MS * 2)
  }
}

export function onRebuild(fn: () => void): () => void {
  wire()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Wait for the next rebuild to land, or give up and let the engine fetch whatever
// is there. Used right after writing a file, so the restart picks up new code.
export async function waitForRebuild(): Promise<void> {
  wire()
  const t0 = Date.now()
  const deadline = t0 + REBUILD_WAIT_MS
  while (Date.now() < deadline) {
    if (lastBuildAt > t0) return
    await new Promise((r) => setTimeout(r, 120))
  }
  await new Promise((r) => setTimeout(r, REBUILD_SETTLE_MS))
}
