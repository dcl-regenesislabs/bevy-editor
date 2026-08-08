// Which copy of the scene printed a console line. The runtime modules already
// tag their own output — `[game]` from the shared copy, `[you]` from this
// player's screen — so the drawer never guesses: it reads the tag the line
// carries and colours it, or leaves the line untagged.
//
// `[player 2]` is here because the vocabulary has three tags and a second
// client's lines arrive already carrying theirs; nothing in the editor mints one
// today (there is no second player in Play yet).
//
// Pure: log text in, rows out.
import { isGameLifeLine } from '../play/game-life'

export type LogRole = 'game' | 'you' | 'player'

export interface LogLine {
  /** null when the line carries no tag — most of a scene's own console output */
  role: LogRole | null
  /** the tag as written, e.g. `player 2` — kept so the number survives */
  tag: string
  /** the line with its tag removed, so the tag is rendered once, not twice */
  text: string
  /** where the line sits on the scene clock, in seconds; null when unknown */
  at: number | null
}

const TAG = /\[(game|you|player \d+)\]\s*/
// Every line the engine console hands back is stamped with the scene clock:
// `[12.34] Log: …`. Anchored, digits only, so the `[game]` tag can never be read
// as a stamp.
const STAMP = /^\s*\[(\d+(?:\.\d+)?)\]/

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

export function taggedLine(line: string, at: number | null = null): LogLine {
  const seconds = at ?? lineSeconds(line)
  const m = TAG.exec(line)
  if (m === null) return { role: null, tag: '', text: line, at: seconds }
  const tag = m[1]
  const role: LogRole = tag === 'game' ? 'game' : tag === 'you' ? 'you' : 'player'
  return { role, tag, text: line.slice(0, m.index) + line.slice(m.index + m[0].length), at: seconds }
}

/** The Game tab's rows: every console line, minus the editor's own machinery. */
export function taggedLines(logs: string): LogLine[] {
  return logs
    .split('\n')
    .filter((line) => !isGameLifeLine(line))
    .map((line) => taggedLine(line))
}

// The shared copy of the scene runs in the Multiplayer Server process, which the
// desktop shell spawns — its console goes to the build stream, not to this
// screen's. So the Game tab reads that stream too and keeps the lines the
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

/** The `[game]` rows hiding in the build stream. */
export function serverGameLines(relayed: RelayedLine[]): LogLine[] {
  const rows: LogLine[] = []
  for (const entry of relayed) {
    for (const line of entry.text.split(/\r?\n/)) {
      if (isGameLifeLine(line)) continue
      const row = taggedLine(line, entry.at)
      if (row.role !== null) rows.push(row)
    }
  }
  return rows
}

// The Game tab has two sources and one story to tell: a message leaves this
// player's screen and the shared copy answers it. Concatenating the sources put
// every server line before every screen line, which reads as the answer arriving
// before the question — so both sides get a key on the same clock and are merged
// on it.
//
// The clocks are not the same instrument, though. A screen line is stamped by the
// engine itself; a server line is stamped by the editor when it arrives, which is
// after the shell has piped it. So the merge is right to within a beat, never to
// the millisecond — GAME_TAB_ORDER says so where the creator can read it rather
// than letting them infer a causality that isn't there.
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
    // ties go to the screen: it is the side that asks, and the server's key is
    // the later-measured of the two
    const takeScreen = j >= server.length || (i < screen.length && screen[i].key <= server[j].key)
    if (takeScreen) out.push(screen[i++].row)
    else out.push(server[j++].row)
  }
  return out
}

/** True when both copies printed — the only case where the merge can read wrong. */
export function bothCopiesPrinted(sceneLogs: string, relayed: RelayedLine[]): boolean {
  if (serverGameLines(relayed).length === 0) return false
  return taggedLines(sceneLogs).some((row) => row.text.trim() !== '')
}

/** Nothing has printed yet — name the gesture that fills the tab. */
export const GAME_TAB_EMPTY = 'Nothing from the game yet — press Play.'
export const BUILD_TAB_EMPTY = 'Waiting for build output…'
/** Shown only when both copies printed, because only then can they read wrong. */
export const GAME_TAB_ORDER = 'Lines from the server are placed by when the editor received them, not when the server printed them.'
