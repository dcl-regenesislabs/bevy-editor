// Namespaced logger for the editor UI. `error`/`warn` always print; `debug`
// prints only with `?editorDebug` (the same flag the bus tracer uses), so noisy
// call sites stay quiet in normal runs but are one query-param away when
// diagnosing. Prefer logging a failure over swallowing it in a `.catch`.
// Guarded: vitest runs these modules in a node environment, and reading window at
// import time made merely IMPORTING anything that logs throw there. Every module
// that pulls in a logger would otherwise be untestable.
const DEBUG =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('editorDebug')
const TAG = '[editor-ui]'

export const log = {
  debug: (...args: unknown[]): void => {
    if (DEBUG) console.debug(TAG, ...args)
  },
  warn: (...args: unknown[]): void => {
    console.warn(TAG, ...args)
  },
  error: (...args: unknown[]): void => {
    console.error(TAG, ...args)
  }
}
