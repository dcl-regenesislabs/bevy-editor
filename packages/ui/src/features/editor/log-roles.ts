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
}

const TAG = /\[(game|you|player \d+)\]\s*/

export function taggedLine(line: string): LogLine {
  const m = TAG.exec(line)
  if (m === null) return { role: null, tag: '', text: line }
  const tag = m[1]
  const role: LogRole = tag === 'game' ? 'game' : tag === 'you' ? 'you' : 'player'
  return { role, tag, text: line.slice(0, m.index) + line.slice(m.index + m[0].length) }
}

/** The Game tab's rows: every console line, minus the editor's own machinery. */
export function taggedLines(logs: string): LogLine[] {
  return logs
    .split('\n')
    .filter((line) => !isGameLifeLine(line))
    .map(taggedLine)
}
