// A Play run's window over the two places a problem can print. Neither place is
// cleared when a run ends: the shell's backlog spans the whole project session
// (main.ts empties it only on open/close), and this client's console spans the
// scene instance. So a strip that read either whole inherited the previous run's
// problems — a handler that threw, was fixed, and re-Played still counted, and
// the strip stayed red with a Logs button for a bug that no longer exists.
//
// One rule — a run counts the problems that are its own — read off different
// evidence on each side, because the two sources carry different evidence.
//
// The shell has no clock, so its lines are windowed by ARRIVAL: a run counts what
// was pushed to it since it began (`onStackLog`), plus the part of the backlog
// that was already there before the editor started listening. That prefix is the
// project's boot — the Multiplayer Server is spawned with the scene dev server at
// project open (servers.ts), so its start-up cards print long before the first
// Play — and it belongs to no run in particular: it describes the same server
// every run talks to, so every run counts it. The prefix is measured rather than
// remembered (the backlog, minus the lines we heard arrive), which also means it
// empties itself as the shell's own cap scrolls the boot out. Lines that arrived
// while an EARLIER run was on screen are that run's, and go when the next begins.
//
// This client's console is stamped with the scene clock, so its lines are
// windowed by that clock — with the catch that made the first version of this
// file wrong. Play reloads the scene whenever the bundle moved (playback.ts), and
// a reloaded scene is a new instance: fresh log, clock back at 0. The first tail
// such a run reads is therefore already full of its own start()-time output — the
// guard cards, a throw out of a script's start() — so taking the floor from that
// tail dropped exactly the problems the strip exists to show, and the strip read
// `Game running` with no chip in the one case the chip is for.
//
// The clock only moves forward within one instance, which makes a reading BELOW
// the highest one seen proof of a NEW instance rather than of old lines: the
// window then opens at the bottom of the tail and the whole of it counts. A
// reading above it means the same instance is still running, so everything
// already in its log printed before this run pressed Play — the floor is the
// tail's newest stamp. And with no previous reading at all (the first run of the
// page) there is no earlier run to inherit from, so nothing is floored off.
import { allProblemLines, lastSeconds, lineSeconds, relayedLines } from '../editor/log-roles'

// Same cap as the shell's own backlog (main.ts): a run can outlive a whole
// failed build's worth of output without the buffer growing without bound.
const RUN_LINES_MAX = 4000

// The backlog as it stood before the editor was listening — the project's boot.
let carried: string[] = []
// Shell lines pushed since this run began, and the count since the listener went
// on; the difference between that count and the backlog's length is the prefix.
let heard: string[] = []
let heardEver = 0
let listening = false
// Where this run's console window opens on the scene clock; null counts the whole
// tail. `opening` is true until a poll has enough evidence to place it.
let floor: number | null = null
let opening = true
// The newest reading seen on this client's console, kept ACROSS runs — a drop is
// how a reloaded scene announces itself.
let high: number | null = null
let seen = new Set<string>()

function listen(): Promise<void> {
  const shell = window.editorShell
  if (shell === undefined) return Promise.resolve()
  // The shell offers no way to remove a listener, so one is registered for the
  // page's life; the buffer behind it is what a run resets.
  if (!listening) {
    listening = true
    shell.onStackLog((line) => {
      heardEver++
      heard.push(line)
      if (heard.length > RUN_LINES_MAX) heard.splice(0, heard.length - RUN_LINES_MAX)
    })
  }
  const heardSoFar = heardEver
  return shell.getState().then((s) => {
    carried = s.logs.slice(0, Math.max(0, s.logs.length - heardSoFar))
  })
}

// exported for the unit test only — a page gets one listener for its whole life
export function resetForTest(): void {
  carried = []
  heard = []
  heardEver = 0
  listening = false
  floor = null
  opening = true
  high = null
  seen = new Set()
}

/**
 * Open a window for the run starting now — what an earlier run heard is an
 * earlier run's. Resolves once the project's boot output is in the window, which
 * the caller polls on: a server that failed at open shows on the strip at once
 * rather than a poll later.
 */
export function beginRun(): Promise<void> {
  heard = []
  seen = new Set()
  floor = null
  opening = true
  return listen()
}

/**
 * How many distinct problems THIS run has printed, across both copies of the
 * scene. The console it reads is a rolling tail, so a problem that has scrolled
 * out must not un-count itself: each line's own text is its identity and the
 * set only grows, until the next run opens its own window.
 */
export function runProblems(tail: string): number {
  const newest = lastSeconds(tail)
  const restarted = newest !== null && high !== null && newest < high
  if (restarted) {
    floor = null
    opening = false
  } else if (opening && (high === null || newest !== null)) {
    floor = high === null ? null : newest
    opening = false
  }
  if (newest !== null) high = newest
  for (const line of allProblemLines(tail, [])) {
    const at = lineSeconds(line)
    if (floor !== null && at !== null && at <= floor) continue
    seen.add(line)
  }
  for (const line of allProblemLines('', relayedLines([...carried, ...heard]))) seen.add(line)
  return seen.size
}
