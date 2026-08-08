// The board's reading and rendering, with no SDK and no I/O.
//
// A Leaderboard is a pure reader: the game writes rows into a `game.state` key
// and this turns them into panel text. Creators name those fields themselves —
// one game writes `{ player, seconds }`, the next `{ p, pts }` — so a row is
// anything with a player-ish string and a number, and anything else is skipped
// rather than painted as [object Object].

export type BoardSort = 'desc' | 'asc'

export interface BoardRow {
  rank: number
  player: string
  score: number
}

const PLAYER_FIELDS = ['player', 'p', 'address', 'wallet', 'name']
const SCORE_FIELDS = ['score', 'points', 'pts', 'value', 'seconds', 'time', 'best']

export const MAX_ROWS = 25

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Wallets are long; a board row reads better with the tail. */
export function shortName(player: string): string {
  return player.startsWith('0x') && player.length > 10 ? `${player.slice(0, 6)}…${player.slice(-4)}` : player
}

/** Whole seconds as m:ss — how an 'asc' board's times want to read. */
export function formatScore(score: number, sort: BoardSort): string {
  if (sort === 'desc') return `${Math.round(score)}`
  const total = Math.max(0, Math.floor(score))
  const rest = total % 60
  return `${Math.floor(total / 60)}:${rest < 10 ? '0' : ''}${rest}`
}

export function clampRows(value: number): number {
  if (!Number.isFinite(value)) return 8
  return Math.min(MAX_ROWS, Math.max(1, Math.round(value)))
}

/**
 * The visible rows of whatever sits under the board key. Sorting here rather than
 * trusting the writer's order is what lets one key feed a "highest wins" board and
 * a "lowest wins" board at once.
 */
export function boardRows(value: unknown, sort: BoardSort, limit: number): BoardRow[] {
  if (!Array.isArray(value)) return []
  const rows: { player: string; score: number }[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const playerKey = PLAYER_FIELDS.find((key) => typeof item[key] === 'string' && item[key] !== '')
    const scoreKey = SCORE_FIELDS.find((key) => typeof item[key] === 'number' && Number.isFinite(item[key]))
    if (playerKey === undefined || scoreKey === undefined) continue
    rows.push({ player: String(item[playerKey]), score: Number(item[scoreKey]) })
  }
  rows.sort((a, b) => (sort === 'desc' ? b.score - a.score : a.score - b.score))
  return rows.slice(0, clampRows(limit)).map((row, index) => ({ rank: index + 1, ...row }))
}

export function renderPanel(title: string, rows: BoardRow[], sort: BoardSort, placeholder: string): string {
  const lines = [title.trim().toUpperCase(), '']
  if (rows.length === 0) {
    lines.push(placeholder)
    return lines.join('\n')
  }
  for (const row of rows) lines.push(`${row.rank}. ${shortName(row.player)}   ${formatScore(row.score, sort)}`)
  return lines.join('\n')
}
