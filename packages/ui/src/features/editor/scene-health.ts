// Scene code health, read from the dev-server log stream. When the creator's
// scene has a TypeScript error or its bundle throws on load, the engine
// handshake just never completes and the editor used to sit on "waiting for
// scene…" — while the [stack] log stream carried the exact error the whole
// time. Parse that stream so the loading screen can say what's actually wrong,
// and clear again when a fixed build lands (the dev server rebuilds + the
// engine hot-reloads on save, so recovery needs no user action).
import { useSyncExternalStore } from 'react'

export interface SceneHealth {
  kind: 'build' | 'runtime'
  lines: string[] // the error lines, ANSI-stripped, ready to display
}

let health: SceneHealth | null = null
const listeners = new Set<() => void>()

function set(h: SceneHealth | null): void {
  health = h
  for (const l of listeners) l()
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b?\[[0-9;]*m/g

// error lines collected since the last rebuild started — the tsc summary line
// decides whether they become the displayed health
let pending: string[] = []

// exported for the unit test only — the app consumes useSceneHealth
export function healthForTest(): SceneHealth | null {
  return health
}
export function resetForTest(): void {
  health = null
  pending = []
}

export function parseLine(raw: string): void {
  const line = raw.replace(ANSI, '').trim()

  // a new compile cycle: forget the previous cycle's error lines
  if (/File change detected|Starting compilation|rebuilding\.\.\./.test(line)) {
    pending = []
    return
  }
  // tsc error detail (src/index.ts:64:1 - error TS2304: …) or an esbuild error
  if (/error TS\d+:|\[ERROR\]/.test(line)) {
    pending.push(line)
    return
  }
  // tsc watch summary: authoritative for build state
  const summary = /Found (\d+) errors?\./.exec(line)
  if (summary !== null) {
    const n = Number(summary[1])
    if (n > 0) set({ kind: 'build', lines: pending.length > 0 ? pending.slice(-8) : [line] })
    else if (health?.kind === 'build') set(null)
    return
  }
  // the scene's bundle threw at load — the runtime is gone until the next reload
  const crash = /terminated with error: (.+)/.exec(line)
  if (crash !== null) {
    set({ kind: 'runtime', lines: [crash[1]] })
    return
  }
  // the engine reloads the scene with a fresh bundle — assume recovered; a
  // still-broken bundle re-reports `terminated` a moment later
  if (health?.kind === 'runtime' && /Change detected for scene.*reloading/.test(line)) {
    set(null)
  }
}

let wired = false
function wire(): void {
  const shell = window.editorShell
  if (wired || shell === undefined) return
  wired = true
  // seed from the buffered log so errors from before this page loaded count
  // (reopening a broken scene reloads the page mid-stream)
  void shell.getState().then((s) => {
    for (const line of s.logs) parseLine(line)
  })
  shell.onStackLog(parseLine)
}

export function useSceneHealth(): SceneHealth | null {
  return useSyncExternalStore(
    (l) => {
      wire()
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => health
  )
}
