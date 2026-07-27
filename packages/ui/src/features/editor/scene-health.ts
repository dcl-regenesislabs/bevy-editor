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

// with or without the leading ESC byte — main relays raw CLI output, but a
// line can arrive with the ESC already lost in transport
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b?\[[0-9;]*m/g

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '')
}


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

// A relayed chunk can hold several lines (pipe buffering — especially on
// Windows); parse them individually so a reset marker sharing a chunk with a
// summary can't swallow it.
export function parseChunk(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) parseLine(line)
}

export function parseLine(raw: string): void {
  const line = raw.replace(ANSI, '').trim()

  // a new compile cycle: forget the previous cycle's error lines. "Bundling
  // file" is the start of a full server (re)start's build — without it, each
  // crashed start attempt would stack the same error lines again.
  if (/File change detected|Starting compilation|rebuilding\.\.\.|Bundling file/.test(line)) {
    pending = []
    return
  }
  // error details: tsc (src/index.ts:64:1 - error TS2304: …), esbuild's
  // ✘ [ERROR] marker, and esbuild's summary location (src/index.ts:19:20: ERROR: …)
  if (/error TS\d+:|\[ERROR\]|:\d+:\d+: ERROR: /.test(line)) {
    pending.push(line)
    // already showing this cycle's build error — keep the details live
    if (health?.kind === 'build') set({ kind: 'build', lines: pending.slice(-8) })
    return
  }
  // build summaries, authoritative for build state: tsc's watch line, and
  // esbuild's hard failure (which kills `sdk-commands start` at server start —
  // tsc's summary never comes on that path)
  const summary = /Found (\d+) errors?\./.exec(line)
  const bundleFailed = /Build failed with \d+ errors?/.test(line)
  if (summary !== null || bundleFailed) {
    const n = bundleFailed ? 1 : Number(summary?.[1])
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
    for (const line of s.logs) parseChunk(line)
  })
  shell.onStackLog(parseChunk)
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
