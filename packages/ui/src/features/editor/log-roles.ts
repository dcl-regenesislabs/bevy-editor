// Which copy of the scene printed a console line. The runtime modules already
// tag their own output — `[server]` from the Multiplayer Server, `[you]` from
// this player's client — so the drawer never guesses: it reads the tag the line
// carries and colours it, or leaves the line untagged.
//
// Pure: log text in, rows out.
import { isGameLifeLine } from '../play/game-life'

export type LogRole = 'server' | 'you'

export interface LogLine {
  /** null when the line carries no tag — most of a scene's own console output */
  role: LogRole | null
  /** the line with its tag removed, so the tag is rendered once, not twice */
  text: string
  /** where the line sits on the scene clock, in seconds; null when unknown */
  at: number | null
  /** the engine called it an error — the only rows a creator must act on */
  error: boolean
}

const TAG = /\[(server|you)\]\s*/
// The mark the runtime puts on a line it wrote as an error card, in the same
// `[studio] …` machine namespace as the game-life line — and stripped here, so
// the row shows the sentence the runtime wrote and not the machinery.
//
// It has to be a mark and not a shape. The Multiplayer Server's console reaches
// the editor down the shell's build stream, which relays stdout and stderr
// through one callback (`servers.ts` `onLine`), so `console.error` and
// `console.log` arrive identical; and the text alone cannot stand in for the
// difference, because the lines are not all the runtime's. A kit script's own
// notice (`[server] Game Flow: The round hit its time ceiling — …`) and a
// creator's `console.log('[server] openChest: already open')` have exactly the
// card's `name: message` shape, and reading that shape as an error told a
// creator their game was broken by a line written to say it was fine.
export const PROBLEM_MARKER = '[studio] problem'
// Every line the engine console hands back is stamped with the scene clock:
// `[12.34] Log: …`. Anchored, digits only, so the `[server]` tag can never be
// read as a stamp.
const STAMP = /^\s*\[(\d+(?:\.\d+)?)\]/
// The engine writes its verb in front of the message — `Log:` or `Error:`. On
// this client's console that verb names a card, so it is read here and kept as a
// field instead of being thrown away with the stamp; the Multiplayer Server's
// console has no verb in front of anything, which is what the mark above is for.
const ERROR_VERB = /^\s*(?:\[\d+(?:\.\d+)?\]\s*)?Error:/

/** The scene clock a line is stamped with, or null when it carries no stamp. */
export function lineSeconds(line: string): number | null {
  const m = STAMP.exec(line)
  return m === null ? null : Number(m[1])
}

/** The newest stamp in a block of console output — the clock's reading now. */
export function lastSeconds(logs: string): number | null {
  let found: number | null = null
  for (const line of logs.split('\n')) {
    const seconds = lineSeconds(line)
    if (seconds !== null) found = seconds
  }
  return found
}

/** The line without its problem mark, and whether it carried one. */
function unmarked(line: string): { text: string; marked: boolean } {
  const at = line.indexOf(PROBLEM_MARKER)
  if (at === -1) return { text: line, marked: false }
  return { text: line.slice(0, at) + line.slice(at + PROBLEM_MARKER.length).replace(/^\s+/, ''), marked: true }
}

function taggedLine(line: string, at: number | null = null): LogLine {
  const seconds = at ?? lineSeconds(line)
  const { text, marked } = unmarked(line)
  const error = marked || ERROR_VERB.test(text)
  const m = TAG.exec(text)
  if (m === null) return { role: null, text, at: seconds, error }
  const role: LogRole = m[1] === 'server' ? 'server' : 'you'
  return { role, text: text.slice(0, m.index) + text.slice(m.index + m[0].length), at: seconds, error }
}

/** The Game tab's rows: every console line, minus the editor's own machinery. */
function taggedLines(logs: string): LogLine[] {
  return logs
    .split('\n')
    .filter((line) => !isGameLifeLine(line))
    .map((line) => taggedLine(line))
}

// The shared copy of the scene runs in the Multiplayer Server process, which the
// desktop shell spawns — its console goes to the build stream, not to this
// client's. So the Game tab reads that stream too and keeps the lines the
// runtime tagged; everything else there is build output and stays in Build.
//
// servers.ts relays that stream one whole line per entry, but the shell's own
// notices (a spawn failure, a stack) are written straight to the same channel and
// can still hold several lines — hence the split.
export interface RelayedLine {
  text: string
  /** the arrival time mapped onto the scene clock; null when it cannot be */
  at: number | null
}

// The Multiplayer Server runs outside the engine console, so nothing stamps a
// verb in front of its lines: the shell relays what the process printed, word
// for word. What names an error card there is `PROBLEM_MARKER`, which
// `taggedLine` already reads — nothing else about a server line is the
// editor's to interpret.
/** The `[server]` rows hiding in the build stream. */
function serverGameLines(relayed: RelayedLine[]): LogLine[] {
  const rows: LogLine[] = []
  for (const entry of relayed) {
    for (const line of entry.text.split(/\r?\n/)) {
      if (isGameLifeLine(line)) continue
      const row = taggedLine(line, entry.at)
      if (row.role === null) continue
      rows.push(row)
    }
  }
  return rows
}

// The Game tab has two sources and one story to tell: a message leaves this
// player's client and the shared copy answers it. Concatenating the sources put
// every server line before every client line, which reads as the answer arriving
// before the question — so both sides get a key on the same clock and are merged
// on it.
//
// The clocks are not the same instrument, though: a client line is stamped by the
// engine itself, a server line by the editor when it arrives. So the merge is
// right to within a beat, never to the millisecond — the Game tab's own tooltip
// says so, where it costs the pane nothing.
//
// Within one source the order is never in doubt, so a row with no key of its own
// inherits the last known one and stays where its source put it.
function keyed(rows: LogLine[]): Array<{ row: LogLine; key: number }> {
  const out: Array<{ row: LogLine; key: number }> = []
  let last = -Infinity
  for (const row of rows) {
    if (row.at !== null) last = row.at
    out.push({ row, key: last })
  }
  return out
}

/** Both copies of the scene, in one reading order. */
export function gameTabLines(sceneLogs: string, relayed: RelayedLine[]): LogLine[] {
  const screen = keyed(taggedLines(sceneLogs))
  const server = keyed(serverGameLines(relayed))
  const out: LogLine[] = []
  let i = 0
  let j = 0
  while (i < screen.length || j < server.length) {
    // ties go to the client: it is the side that asks, and the server's key is
    // the later-measured of the two
    const takeScreen = j >= server.length || (i < screen.length && screen[i].key <= server[j].key)
    if (takeScreen) out.push(screen[i++].row)
    else out.push(server[j++].row)
  }
  return out
}

// Every card the runtime stamps `server` — dropped messages, an oversize
// broadcast, a handler that threw — prints inside the Multiplayer Server
// process and reaches the editor on the relayed build stream, never on this
// client's console. Counting only the console would miss exactly the failures
// the strip exists to surface.
// The strip only needs each line's text to spot an error card; ordering against
// the scene clock is the Game tab's job, so the timestamp stays unset here.
/** Shell log texts as relayed rows. */
export function relayedLines(texts: string[]): RelayedLine[] {
  return texts.map((text) => ({ text, at: null }))
}

// The strip counts what it is handed, and the console it reads is a rolling tail
// — so a problem that has scrolled out must not un-count itself. Each row is
// returned as written, which makes its text its own identity: the caller keeps
// the set, this only names what is in it.
/** The error rows across both copies: this client's console and the server's. */
export function allProblemLines(sceneLogs: string, relayed: RelayedLine[]): string[] {
  return [...taggedLines(sceneLogs), ...serverGameLines(relayed)]
    .filter((row) => row.error)
    .map((row) => row.text.trim())
}

/** Nothing has printed yet — name the gesture that fills the tab. */
export const GAME_TAB_EMPTY = 'Nothing from the game yet — press Play.'
export const BUILD_TAB_EMPTY = 'Waiting for build output…'
/** Why a server line sits where it does, on the tab button rather than the pane. */
export const GAME_TAB_TIP = 'Both copies of the scene, in the order the editor saw them.'
