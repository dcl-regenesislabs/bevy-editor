// Namespaced logger for the editor scene (output lands in the engine console).
// `error`/`warn` always print; `debug` is opt-in via setSceneDebug so per-frame
// call sites (picking, highlight, bus poll) can log without spamming normal runs.
// Prefer logging a failure over swallowing it in a `.catch` — a logged error is
// debuggable, a silent one looks like success.
// The SDK7 runtime console only exposes log + error (no warn), so warn routes
// through console.log with a marker.
const TAG = '[editor-scene]'
let debugOn = false

export function setSceneDebug(on: boolean): void {
  debugOn = on
}

export const log = {
  debug: (...args: unknown[]): void => {
    if (debugOn) console.log(TAG, ...args)
  },
  warn: (...args: unknown[]): void => {
    console.log(TAG, 'WARN', ...args)
  },
  error: (...args: unknown[]): void => {
    console.error(TAG, ...args)
  }
}
