// The leaderboard's decisions, with no SDK and no I/O: ranking, per-board key
// namespacing, the weekly rollover period, and the panel text. Everything the
// server has to agree with itself about across a restart lives here, so it can
// be unit-tested without a scene.
//
// Scores are compared through `beats` alone — 'desc' boards keep the highest
// score (points), 'asc' boards keep the lowest (best time). Nothing else in the
// prefab may compare two scores directly, or the two orders drift apart.

export type BoardSort = 'desc' | 'asc'
export type BoardRollover = 'none' | 'weekly'

export interface BoardEntry {
  address: string
  name: string
  score: number
  at: number
}

export interface BoardRow {
  rank: number
  name: string
  score: number
  address: string
  you: boolean
}

/** A player's own persisted row, the long tail behind the visible top N. */
export interface BoardPlayerRow {
  schemaVersion: number
  best: number
  at: number
  name: string
  period: string
}

export const BOARD_SCHEMA_VERSION = 1
/** Hard cap on the persisted table — the visible board is a slice of it. */
export const MAX_TABLE_ENTRIES = 100
export const MAX_NAME_CHARS = 20
/** Scores outside this range are a bug or an attack, never a game result. */
export const MAX_SCORE = 1e9
export const ALL_TIME_PERIOD = 'all'

const DAY_MS = 86_400_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Folder-safe, case-insensitive board identity — "Best Time" and "best time" are one board. */
export function boardSlug(board: string): string {
  const slug = board
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug === '' ? 'board' : slug
}

/** Storage.player key namespace for this board. One board, one store. */
export function boardStoreKey(board: string): string {
  return `leaderboard:${boardSlug(board)}`
}

/** Scene-scoped key the visible table is persisted under. */
export function boardTableKey(board: string, period: string): string {
  return `leaderboard:${boardSlug(board)}:${period}`
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

/**
 * ISO-8601 week key in UTC. The week the Thursday falls in decides the year, so
 * the turn of the year does not produce two half-weeks that share a key.
 */
export function isoWeekKey(nowMs: number): string {
  const date = new Date(nowMs)
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3)
  const isoYear = thursday.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
  return `${isoYear}-w${pad2(week)}`
}

export function periodKey(rollover: BoardRollover, nowMs: number): string {
  return rollover === 'weekly' ? isoWeekKey(nowMs) : ALL_TIME_PERIOD
}

/** True when `candidate` deserves the place `current` holds. */
export function beats(sort: BoardSort, candidate: number, current: number): boolean {
  return sort === 'asc' ? candidate < current : candidate > current
}

/**
 * Total order over entries: the better score first, ties broken by who got there
 * first and then by address, so every peer renders the same board from the same
 * data.
 */
export function sortEntries(entries: BoardEntry[], sort: BoardSort): BoardEntry[] {
  return [...entries].sort((a, b) => {
    if (a.score !== b.score) return beats(sort, a.score, b.score) ? -1 : 1
    if (a.at !== b.at) return a.at - b.at
    return a.address < b.address ? -1 : a.address > b.address ? 1 : 0
  })
}

/** Upsert a player's personal best, keeping the table sorted and capped. */
export function mergeEntry(entries: BoardEntry[], entry: BoardEntry, sort: BoardSort): BoardEntry[] {
  const address = entry.address.toLowerCase()
  const next: BoardEntry[] = []
  let merged = false
  for (const existing of entries) {
    if (existing.address.toLowerCase() !== address) {
      next.push(existing)
      continue
    }
    merged = true
    next.push(
      beats(sort, entry.score, existing.score)
        ? { ...entry, address }
        : { ...existing, name: entry.name === '' ? existing.name : entry.name }
    )
  }
  if (!merged) next.push({ ...entry, address })
  return sortEntries(next, sort).slice(0, MAX_TABLE_ENTRIES)
}

export function rankOf(entries: BoardEntry[], sort: BoardSort, address: string): number {
  const wanted = address.toLowerCase()
  const index = sortEntries(entries, sort).findIndex((entry) => entry.address.toLowerCase() === wanted)
  return index + 1
}

export function topRows(entries: BoardEntry[], sort: BoardSort, limit: number, you = ''): BoardRow[] {
  const wanted = you.toLowerCase()
  const count = Math.max(1, Math.min(Math.floor(limit), MAX_TABLE_ENTRIES))
  return sortEntries(entries, sort)
    .slice(0, count)
    .map((entry, index) => ({
      rank: index + 1,
      name: displayName(entry.name, entry.address),
      score: entry.score,
      address: entry.address,
      you: wanted !== '' && entry.address.toLowerCase() === wanted
    }))
}

export function displayName(name: string, address: string): string {
  const trimmed = name.trim()
  if (trimmed !== '') return trimmed
  return address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function formatScore(score: number): string {
  const rounded = Math.round(score * 100) / 100
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2)
}

/** Names come from clients and are cosmetic — length-capped and stripped of newlines. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\r\n\t]/g, ' ').trim().slice(0, MAX_NAME_CHARS)
}

/** A submitted score is untrusted input: finite, in range, or nothing. */
export function safeScore(raw: unknown): number | null {
  if (!isFiniteNumber(raw)) return null
  if (Math.abs(raw) > MAX_SCORE) return null
  return raw
}

export function defaultPlayerRow(): BoardPlayerRow {
  return { schemaVersion: BOARD_SCHEMA_VERSION, best: 0, at: 0, name: '', period: ALL_TIME_PERIOD }
}

export function repairPlayerRow(value: Partial<BoardPlayerRow>, defaults: BoardPlayerRow): BoardPlayerRow {
  return {
    schemaVersion: BOARD_SCHEMA_VERSION,
    best: isFiniteNumber(value.best) ? value.best : defaults.best,
    at: isFiniteNumber(value.at) ? value.at : defaults.at,
    name: sanitizeName(value.name),
    period: typeof value.period === 'string' && value.period !== '' ? value.period : defaults.period
  }
}

/** Whatever comes back from scene storage is repaired into a table, never trusted. */
export function parseEntries(raw: unknown, sort: BoardSort): BoardEntry[] {
  if (!Array.isArray(raw)) return []
  const out: BoardEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const address = typeof item.address === 'string' ? item.address.toLowerCase() : ''
    const score = safeScore(item.score)
    if (address === '' || score === null) continue
    out.push({ address, score, name: sanitizeName(item.name), at: isFiniteNumber(item.at) ? item.at : 0 })
  }
  return sortEntries(out, sort).slice(0, MAX_TABLE_ENTRIES)
}

export interface PanelText {
  title: string
  rows: BoardRow[]
  /** the viewer's own standing, when they are not already on screen */
  you: { rank: number; score: number } | null
  /** shown instead of rows while the board is empty or the server is silent */
  placeholder: string
}

export function renderPanel(panel: PanelText): string {
  const lines = [panel.title.trim().toUpperCase()]
  if (panel.rows.length === 0) {
    lines.push('', panel.placeholder)
    return lines.join('\n')
  }
  lines.push('')
  for (const row of panel.rows) {
    const mark = row.you ? '>' : ' '
    lines.push(`${mark}${row.rank}. ${row.name}   ${formatScore(row.score)}`)
  }
  if (panel.you !== null && !panel.rows.some((row) => row.you)) {
    lines.push('', `you  ${panel.you.rank}. ${formatScore(panel.you.score)}`)
  }
  return lines.join('\n')
}
