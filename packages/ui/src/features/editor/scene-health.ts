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

// Publish a build error without flicker. The server's crash-restart loop
// replays the identical compile (4 attempts), and details stream in line by
// line — naive re-publishing makes the card's content oscillate for seconds.
// Skip updates that equal what's shown, or that are a prefix of it (the same
// error block mid-replay).
function setBuild(lines: string[]): void {
  if (health?.kind === 'build') {
    const cur = health.lines
    const samePrefix = lines.length <= cur.length && lines.every((l, i) => l === cur[i])
    if (samePrefix) return
  }
  set({ kind: 'build', lines })
}

// with or without the leading ESC byte — main relays raw CLI output, but a
// line can arrive with the ESC already lost in transport
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b?\[[0-9;]*m/g

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '')
}

// A source position inside the creator's own project, as printed by tsc
// ("src/index.ts:64:1 - error TS2304"), esbuild ("src/index.ts:19:20: ERROR:")
// or a stack frame ("at main (src/index.ts:12:5)"). Absolute paths and file://
// URLs are trimmed back to the project-relative form the editor opens by.
const LOCATION = /(?:^|[\s(/])((?:[\w.-]+\/)*[\w.-]+\.tsx?):(\d+)(?::(\d+))?/

export interface ErrorLocation {
  path: string
  line: number
  column: number | null
}

export function errorLocation(health: SceneHealth): ErrorLocation | null {
  for (const raw of health.lines) {
    const m = LOCATION.exec(raw)
    if (m === null) continue
    const path = m[1].replace(/^\.\//, '')
    // node_modules frames are the SDK's own code — not something to open
    if (path.includes('node_modules')) continue
    return { path, line: Number(m[2]), column: m[3] === undefined ? null : Number(m[3]) }
  }
  return null
}


// error lines collected since the last rebuild started — the tsc summary line
// decides whether they become the displayed health
let pending: string[] = []

// --- build/reload state, for the Play button ---
// A composite save kicks the dev server's watcher: rebuild bin/index.js, then the
// engine reloads the scene with the fresh bundle. Until that lands, the running
// instance predates the save — Play would run code without the newest scripts.
let building = false
let sceneReloadedAt = 0

export function buildInFlight(): boolean {
  return building
}
export function lastSceneReloadAt(): number {
  return sceneReloadedAt
}

// exported for the unit test only — the app consumes useSceneHealth
export function healthForTest(): SceneHealth | null {
  return health
}
export function resetForTest(): void {
  health = null
  pending = []
  building = false
  sceneReloadedAt = 0
}

// A relayed chunk can hold several lines (pipe buffering — especially on
// Windows); parse them individually so a reset marker sharing a chunk with a
// summary can't swallow it.
export function parseChunk(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) parseLine(line)
}

export function parseLine(raw: string): void {
  const line = raw.replace(ANSI, '').trim()

  // the engine picking up a fresh bundle — the moment the running instance
  // catches up with the last save (also used below for runtime recovery)
  if (/Change detected for scene.*reloading/.test(line)) {
    sceneReloadedAt = Date.now()
  }

  // Session boundary: leaving a scene ("scene closed") or launching a scene
  // server ("▶ port N: starting"). Everything before it belongs to a PREVIOUS
  // project's session — main's log buffer is app-global and survives project
  // switches, so without this a crash in one scene haunted the next scene's
  // loading screen through the seeded backlog.
  if (/■ scene closed|▶ port \d+: starting/.test(line)) {
    pending = []
    building = false
    if (health !== null) set(null)
    return
  }
  // a new compile cycle: forget the previous cycle's error lines. "Bundling
  // file" is the start of a full server (re)start's build — without it, each
  // crashed start attempt would stack the same error lines again.
  if (/File change detected|Starting compilation|rebuilding\.\.\.|Bundling file/.test(line)) {
    pending = []
    building = true
    return
  }
  // error details: tsc (src/index.ts:64:1 - error TS2304: …), esbuild's
  // ✘ [ERROR] marker, and esbuild's summary location (src/index.ts:19:20: ERROR: …)
  if (/error TS\d+:|\[ERROR\]|:\d+:\d+: ERROR: /.test(line)) {
    // dedupe within the cycle — esbuild prints the same location line in its
    // failure block and again inside the CliError wrapper
    if (!pending.includes(line)) {
      pending.push(line)
      // already showing this cycle's build error — keep the details live
      if (health?.kind === 'build') setBuild(pending.slice(-8))
    }
    return
  }
  // build summaries, authoritative for build state: tsc's watch line, and
  // esbuild's hard failure (which kills `sdk-commands start` at server start —
  // tsc's summary never comes on that path)
  const summary = /Found (\d+) errors?\./.exec(line)
  const bundleFailed = /Build failed with \d+ errors?/.test(line)
  if (summary !== null || bundleFailed) {
    building = false
    const n = bundleFailed ? 1 : Number(summary?.[1])
    if (n > 0) setBuild(pending.length > 0 ? pending.slice(-8) : [line])
    else if (health?.kind === 'build') set(null)
    return
  }
  // The scene's bundle threw at load — the runtime is gone until the next reload.
  // The crash message names WHAT ("congoel is not defined") but never where, and
  // it arrives after the compile error that does ("src/index.ts:64:1 - error
  // TS2304") — tsc reports, the bundle saves anyway, the scene reloads and dies.
  // Carry those lines along so the banner can still offer a jump to the code.
  const crash = /terminated with error: (.+)/.exec(line)
  if (crash !== null) {
    const context = health?.kind === 'build' ? health.lines : pending
    const lines = [crash[1], ...context.filter((l) => l !== crash[1])]
    const unchanged =
      health?.kind === 'runtime' && health.lines.length === lines.length && health.lines.every((l, i) => l === lines[i])
    if (!unchanged) set({ kind: 'runtime', lines })
    return
  }
  // Stack frames printed after a crash. The message alone ("congoel is not
  // defined") doesn't say WHERE — keep the frames so the banner can offer to
  // open the file at the line. Only the first few: the tail is SDK internals.
  if (health?.kind === 'runtime' && health.lines.length < 6 && /^\s*at\s/.test(line) && LOCATION.test(line)) {
    set({ kind: 'runtime', lines: [...health.lines, line] })
    return
  }
  // the engine reloads the scene with a fresh bundle — assume recovered; a
  // still-broken bundle re-reports `terminated` a moment later
  if (health?.kind === 'runtime' && /Change detected for scene.*reloading/.test(line)) {
    set(null)
  }
}

let wired = false
export function wireSceneHealth(): void {
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
      wireSceneHealth()
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => health
  )
}
