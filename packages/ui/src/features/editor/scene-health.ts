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
// Nearly every edit rebuilds the bundle — the editor writes main.composite for a
// nudged gizmo too, and the watcher rebuilds on that. Only some of it needs the
// engine to load a NEW scene instance, which costs a respawn, so Play has to tell
// the two apart rather than reload on any build.
//
// Live already, no reload: component values on existing entities (transform,
// material, …). The editor writes those into the running scene's CRDT, so the
// instance the engine holds is already showing them.
//
// Needs a reload: anything the scene's code only reads when it starts. That is
// changed SOURCE (a rebuilt bin/index.js the running instance predates) and a
// changed set of attached Scripts — main() constructs Script instances at load
// time from the composite, so an attach made afterwards never runs.
//
// Two latched booleans, not timestamps: "is the engine's instance out of date"
// and "is our last composite write still unbuilt". Each has one setter and one
// clearer, so there are no pairwise comparisons to get the wrong way round.
let building = false
let sceneStale = false
let compositeUnbuilt = false

export function buildInFlight(): boolean {
  return building
}

// Must the engine load a new scene instance before the next Play?
export function sceneNeedsReload(): boolean {
  return sceneStale
}
// Source changed (set the moment the watcher names a non-composite file, so a
// build still running already counts), or the editor changed which Scripts are
// attached — attach/detach/repoint, reported by the component-write observers
// because the composite write it triggers looks like any other one downstream.
export function noteSceneStale(): void {
  sceneStale = true
}

// main.composite has been written and no build has STARTED since, so no bundle
// embeds it yet. Cleared when a cycle begins rather than when one ends: a build
// already running when we wrote read the old file, so "a build finished" is no
// proof at all — reloading on it loads the scene without the write.
export function compositeAwaitingBuild(): boolean {
  return compositeUnbuilt
}
export function noteCompositeWritten(): void {
  compositeUnbuilt = true
}

// Block until the bundle on disk embeds every composite write the editor has
// made: first for a build to pick our write up, then for it to finish. Bounded
// so a dead watcher or a broken build can't wedge Play or Stop.
const BUILD_START_GRACE_MS = 4_000
const BUILD_TIMEOUT_MS = 30_000
const POLL_MS = 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function awaitFreshBundle(): Promise<void> {
  const graceUntil = Date.now() + BUILD_START_GRACE_MS
  const deadline = Date.now() + BUILD_TIMEOUT_MS
  while (compositeUnbuilt && Date.now() < graceUntil) await sleep(POLL_MS)
  while (building && Date.now() < deadline) await sleep(POLL_MS)
}

// The engine has just loaded a scene instance — our own cmd.reload, a Stop, or
// the initial load. The ONLY thing that clears the stale flag.
//
// Deliberately not called for the dev server's "Change detected for scene …
// reloading" line: that says the server restarted ITS instance and pushed a
// hot-reload, which the editor's engine does not act on while the scene is
// frozen. Believing that line is what made Play resume a stale instance — the
// log showed the reload, the viewport still held the scene built before the edit.
export function noteSceneUpToDate(): void {
  sceneStale = false
}

// exported for the unit test only — the app consumes useSceneHealth
export function healthForTest(): SceneHealth | null {
  return health
}
export function resetForTest(): void {
  health = null
  pending = []
  building = false
  sceneStale = false
  compositeUnbuilt = false
}

// A relayed chunk can hold several lines (pipe buffering — especially on
// Windows); parse them individually so a reset marker sharing a chunk with a
// summary can't swallow it.
export function parseChunk(chunk: string): void {
  for (const line of chunk.split(/\r?\n/)) parseLine(line)
}

export function parseLine(raw: string): void {
  const line = raw.replace(ANSI, '').trim()

  // NOTE: "Change detected for scene … reloading" is handled only at the bottom,
  // for runtime-error recovery — never as an engine pickup. See noteSceneUpToDate.

  // Session boundary: leaving a scene ("scene closed") or launching a scene
  // server ("▶ port N: starting"). Everything before it belongs to a PREVIOUS
  // project's session — main's log buffer is app-global and survives project
  // switches, so without this a crash in one scene haunted the next scene's
  // loading screen through the seeded backlog.
  if (/■ scene closed|▶ port \d+: starting/.test(line)) {
    pending = []
    building = false
    // the build/reload latches describe the PREVIOUS project's scene — carrying
    // them over makes the next project's first Play reload, or stall waiting for
    // a rebuild that belonged to a scene that is no longer open
    sceneStale = false
    compositeUnbuilt = false
    if (health !== null) set(null)
    return
  }
  // a new compile cycle: forget the previous cycle's error lines. "Bundling
  // file" is the start of a full server (re)start's build — without it, each
  // crashed start attempt would stack the same error lines again.
  if (/File change detected|Starting compilation|rebuilding\.\.\.|Bundling file/.test(line)) {
    pending = []
    building = true
    // This cycle reads main.composite as it is NOW, so it embeds anything the
    // editor has written — whatever triggered it.
    compositeUnbuilt = false
    // Does it rebuild SOURCE, or only re-embed the composite? Only lines that
    // NAME a file can say — the watcher's "File <path> changed, rebuilding..."
    // and a full build's "Bundling file <path>". tsc's own pathless start line
    // ("File change detected. Starting incremental compilation...") interleaves
    // with the esbuild cycle in either order and says nothing either way.
    const named = /^File (.+) changed,|Bundling file (\S+)/.exec(line)
    const path = named?.[1] ?? named?.[2]
    if (path !== undefined && !path.endsWith('.composite')) noteSceneStale()
    return
  }
  // esbuild finished. Composite-only changes (placing a prefab) rebuild the
  // bundle WITHOUT a tsc cycle — no "Found N errors." ever comes — so waiting
  // for the summary left `building` stuck true and every Play stalled the full
  // rebuild timeout. The tsc summary below still owns type-error display.
  if (/Bundle saved/.test(line)) {
    building = false
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
    // NOT buildDoneAt: a tsc summary is type-checking, not a new bundle — only
    // "Bundle saved" writes bin/index.js, and treating the summary as a fresh
    // build made Play believe the engine was stale forever
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
