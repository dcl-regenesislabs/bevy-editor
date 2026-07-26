// Knowing when the project's code was rebuilt.
//
// The scene is served by its own `sdk-commands start` process, which watches the
// project and rebuilds on change. We don't get a structured event from it — the
// desktop shell streams its stdout to us — so the rebuild is detected from the
// build lines it prints, and the wait below falls back to a timed settle when the
// line never arrives.
//
// This signal says only "something rebuilt", never WHAT changed: the editor's own
// autosave writes main.composite into the project, which the watcher rebuilds too.
// So it's safe to WAIT on after a save you just made, and not safe to trigger
// anything from on its own.
import { REBUILD_WAIT_MS, REBUILD_SETTLE_MS } from './config'

const BUILD_LINE = /rebuil|recompil|compiled|built in|updated|hmr|watch/i

let lastBuildAt = 0
let wired = false

function wire(): void {
  if (wired) return
  const shell = window.editorShell
  if (shell?.onStackLog === undefined) return
  wired = true
  shell.onStackLog((line) => {
    if (BUILD_LINE.test(line)) lastBuildAt = Date.now()
  })
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
