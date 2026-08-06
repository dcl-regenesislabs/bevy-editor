// The board itself: the Multiplayer Server owns every score, clients only ask.
//
//   const result = await submitScore('Points', 1240)     // consumer script, client side
//   const view = await fetchBoard('Points', 8)           // either side, for a panel of your own
//   await awardScore('Points', address, 1240)            // server side, the trustworthy path
//
// Identity is never in a payload — the caller is context.from, the wallet the
// transport already authenticated — so a client can only ever submit for itself.
// The submitted NUMBER is client-reported: it is range-checked, rate-limited and
// kept only when it beats that player's own best. When a score is worth cheating
// for, compute it in a server handler and call awardScore there instead.
//
// Two persistence layers, both server-side:
//   Storage.player (through runtime/playerStore) — every player's personal best,
//     the long tail behind the visible board, keyed `leaderboard:<board>`.
//   Storage (scene-scoped) — the visible top table, so a board that outlives a
//     server nap still has names on it before anyone rejoins.
//
// Boards are namespaced by NAME, so two Leaderboard instances in one scene are
// two independent boards. Two instances sharing a name share the board, and the
// first one's sort/rollover win.
import { engine } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { Storage } from '@dcl/sdk/server'
import { createPlayerStore, type PlayerStore } from './runtime/playerStore'
import { createRpc } from './runtime/rpc'
import {
  beats,
  boardSlug,
  boardStoreKey,
  boardTableKey,
  defaultPlayerRow,
  mergeEntry,
  parseEntries,
  periodKey,
  rankOf,
  repairPlayerRow,
  safeScore,
  sanitizeName,
  topRows,
  BOARD_SCHEMA_VERSION,
  type BoardEntry,
  type BoardPlayerRow,
  type BoardRollover,
  type BoardRow,
  type BoardSort
} from './pure/board'

// Namespace and method names are the wire contract with consumer scripts; they
// outlive this file. createRpc registers schemas, so it runs at module scope.
const rpc = createRpc('board')

const TICK_S = 1
/** The visible table is rewritten at most this often — storage writes are capped. */
const TABLE_WRITE_MS = 10_000
/** One player may not push the server harder than this. */
const SUBMIT_COOLDOWN_MS = 500
/** Cooldown bookkeeping for a player who stopped submitting is dropped, so a
 *  long session does not grow a row per visitor forever. */
const COOLDOWN_FORGET_MS = 60_000

export interface BoardConfig {
  board: string
  sort: BoardSort
  rollover: BoardRollover
}

export interface BoardView {
  board: string
  period: string
  rows: BoardRow[]
  /** the caller's own standing, null when they have no score in this period */
  you: { rank: number; score: number } | null
  /** false when the Multiplayer Server did not answer */
  live: boolean
}

export interface SubmitResult {
  ok: boolean
  best: number
  rank: number
  reason?: string
}

interface BoardRuntime {
  config: BoardConfig
  period: string
  entries: BoardEntry[]
  store: PlayerStore<BoardPlayerRow>
  tableDirty: boolean
  lastTableWriteMs: number
  lastSubmitMs: Map<string, number>
  loading: Promise<void> | null
  loaded: boolean
}

const boards = new Map<string, BoardRuntime>()
let serverStarted = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boardOf(body: unknown): string {
  return isRecord(body) && typeof body.board === 'string' ? body.board : ''
}

function limitOf(body: unknown): number {
  const raw = isRecord(body) ? body.limit : null
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 10
}

function runtimeOf(board: string): BoardRuntime | null {
  return boards.get(boardSlug(board)) ?? null
}

/**
 * The prefab's own entry point — never call it from a consumer script. It claims
 * the board name, its Storage keys and the rpc handlers; a second call for the
 * same board is a no-op so a duplicated instance cannot fight the first.
 */
export function installLeaderboard(config: BoardConfig): void {
  if (!isServer()) return
  const key = boardSlug(config.board)
  if (boards.has(key)) return
  const runtime: BoardRuntime = {
    config,
    period: periodKey(config.rollover, Date.now()),
    entries: [],
    store: createPlayerStore<BoardPlayerRow>({
      key: boardStoreKey(config.board),
      schemaVersion: BOARD_SCHEMA_VERSION,
      defaults: defaultPlayerRow,
      repair: repairPlayerRow
    }),
    tableDirty: false,
    lastTableWriteMs: 0,
    lastSubmitMs: new Map(),
    loading: null,
    loaded: false
  }
  boards.set(key, runtime)
  startServer()
  void ensureLoaded(runtime)
  console.log('[leaderboard] serving', config.board, config.sort, 'rollover', config.rollover)
}

/** Client: submit a score for this player. Never throws — a dead server is `ok: false`. */
export async function submitScore(board: string, score: number): Promise<SubmitResult> {
  const name = sanitizeName(getPlayer()?.name)
  try {
    const reply = await rpc.call<unknown>('board.submit', { board, score, name })
    return submitResult(reply)
  } catch {
    return { ok: false, best: 0, rank: 0, reason: 'no server' }
  }
}

/** Server: record a score the server itself computed. The trustworthy path. */
export async function awardScore(board: string, address: string, score: number): Promise<SubmitResult> {
  if (!isServer()) return { ok: false, best: 0, rank: 0, reason: 'server only' }
  const runtime = runtimeOf(board)
  const value = safeScore(score)
  if (runtime === null) return { ok: false, best: 0, rank: 0, reason: 'unknown board' }
  if (value === null) return { ok: false, best: 0, rank: 0, reason: 'invalid score' }
  return applyScore(runtime, address, value, '')
}

/** Either side: the board as it stands. On a client this is one rpc round trip. */
export async function fetchBoard(board: string, limit = 10): Promise<BoardView> {
  if (isServer()) {
    const runtime = runtimeOf(board)
    if (runtime === null) return emptyView(board)
    await ensureLoaded(runtime)
    return viewOf(runtime, limit, '')
  }
  try {
    return parseView(board, await rpc.call<unknown>('board.top', { board, limit }))
  } catch {
    return emptyView(board)
  }
}

function startServer(): void {
  if (serverStarted) return
  serverStarted = true

  rpc.handle('board.submit', async (body, from) => {
    const runtime = runtimeOf(boardOf(body))
    if (runtime === null) return { ok: false, best: 0, rank: 0, reason: 'unknown board' }
    const score = safeScore(isRecord(body) ? body.score : null)
    if (score === null) return { ok: false, best: 0, rank: 0, reason: 'invalid score' }
    const now = Date.now()
    const address = from.toLowerCase()
    const last = runtime.lastSubmitMs.get(address) ?? 0
    if (now - last < SUBMIT_COOLDOWN_MS) return { ok: false, best: 0, rank: 0, reason: 'too fast' }
    runtime.lastSubmitMs.set(address, now)
    return applyScore(runtime, address, score, sanitizeName(isRecord(body) ? body.name : ''))
  })

  rpc.handle('board.top', async (body, from) => {
    const runtime = runtimeOf(boardOf(body))
    if (runtime === null) return emptyView(boardOf(body))
    await ensureLoaded(runtime)
    return viewOf(runtime, limitOf(body), from)
  })

  let accum = 0
  engine.addSystem(
    (dt: number) => {
      accum += dt
      if (accum < TICK_S) return
      accum = 0
      const now = Date.now()
      for (const runtime of boards.values()) {
        rolloverIfDue(runtime, now)
        void runtime.store.flushIfDue()
        if (runtime.tableDirty && now - runtime.lastTableWriteMs >= TABLE_WRITE_MS) void saveTable(runtime)
        for (const [address, at] of runtime.lastSubmitMs) {
          if (now - at > COOLDOWN_FORGET_MS) runtime.lastSubmitMs.delete(address)
        }
      }
    },
    undefined,
    'leaderboard-checkpoint'
  )
}

function ensureLoaded(runtime: BoardRuntime): Promise<void> {
  if (runtime.loaded) return Promise.resolve()
  if (runtime.loading !== null) return runtime.loading
  const key = boardTableKey(runtime.config.board, runtime.period)
  const load = Storage.get<unknown>(key)
    .then((raw) => {
      runtime.entries = parseEntries(raw, runtime.config.sort)
      runtime.loaded = true
      runtime.loading = null
    })
    .catch((error: unknown) => {
      // A board that cannot read its table still takes scores; it starts empty.
      console.log('[leaderboard] could not read', key, String(error))
      runtime.loaded = true
      runtime.loading = null
    })
  runtime.loading = load
  return load
}

async function saveTable(runtime: BoardRuntime): Promise<void> {
  const key = boardTableKey(runtime.config.board, runtime.period)
  runtime.lastTableWriteMs = Date.now()
  runtime.tableDirty = false
  const ok = await Storage.set(key, runtime.entries)
  if (!ok) runtime.tableDirty = true
}

// A weekly board starts empty when the week turns over; the players' own rows
// carry their period, so a stale personal best is replaced rather than beaten.
// The closing week's table is captured BEFORE the reset — writing it afterwards
// would file an empty table under the new week's key.
function rolloverIfDue(runtime: BoardRuntime, nowMs: number): void {
  const period = periodKey(runtime.config.rollover, nowMs)
  if (period === runtime.period) return
  const closing = { key: boardTableKey(runtime.config.board, runtime.period), entries: runtime.entries }
  runtime.period = period
  runtime.entries = []
  runtime.tableDirty = false
  runtime.lastTableWriteMs = nowMs
  runtime.loaded = false
  runtime.loading = null
  void closeOut(runtime.store, closing)
  void ensureLoaded(runtime)
}

async function closeOut(
  store: PlayerStore<BoardPlayerRow>,
  closing: { key: string; entries: BoardEntry[] }
): Promise<void> {
  await store.flushNow()
  await Storage.set(closing.key, closing.entries)
}

async function applyScore(
  runtime: BoardRuntime,
  address: string,
  score: number,
  name: string
): Promise<SubmitResult> {
  await ensureLoaded(runtime)
  const wallet = address.toLowerCase()
  const row = await runtime.store.load(wallet)
  const fresh = row.at === 0 || row.period !== runtime.period
  const improved = fresh || beats(runtime.config.sort, score, row.best)
  const at = Date.now()
  if (improved) {
    runtime.store.mutate(wallet, (value) => {
      value.best = score
      value.at = at
      value.period = runtime.period
      if (name !== '') value.name = name
    })
    const kept = fresh ? runtime.entries.filter((entry) => entry.address !== wallet) : runtime.entries
    runtime.entries = mergeEntry(
      kept,
      { address: wallet, name: name === '' ? row.name : name, score, at },
      runtime.config.sort
    )
    runtime.tableDirty = true
  } else if (name !== '' && name !== row.name) {
    runtime.store.mutate(wallet, (value) => {
      value.name = name
    })
  }
  const best = improved ? score : row.best
  return { ok: true, best, rank: rankOf(runtime.entries, runtime.config.sort, wallet) }
}

function viewOf(runtime: BoardRuntime, limit: number, address: string): BoardView {
  const wallet = address.toLowerCase()
  const rank = wallet === '' ? 0 : rankOf(runtime.entries, runtime.config.sort, wallet)
  const mine = runtime.entries.find((entry) => entry.address === wallet)
  return {
    board: runtime.config.board,
    period: runtime.period,
    rows: topRows(runtime.entries, runtime.config.sort, limit, wallet),
    you: rank > 0 && mine !== undefined ? { rank, score: mine.score } : null,
    live: true
  }
}

function emptyView(board: string): BoardView {
  return { board, period: '', rows: [], you: null, live: false }
}

// The reply crossed a network as JSON: rebuild it field by field rather than
// trusting its shape into the renderer.
function parseView(board: string, value: unknown): BoardView {
  if (!isRecord(value) || !Array.isArray(value.rows)) return emptyView(board)
  const rows: BoardRow[] = []
  for (const item of value.rows) {
    if (!isRecord(item)) continue
    rows.push({
      rank: typeof item.rank === 'number' ? item.rank : rows.length + 1,
      name: typeof item.name === 'string' ? item.name : '',
      score: typeof item.score === 'number' ? item.score : 0,
      address: typeof item.address === 'string' ? item.address : '',
      you: item.you === true
    })
  }
  const you = isRecord(value.you) ? value.you : null
  return {
    board,
    period: typeof value.period === 'string' ? value.period : '',
    rows,
    you:
      you !== null && typeof you.rank === 'number' && typeof you.score === 'number'
        ? { rank: you.rank, score: you.score }
        : null,
    live: true
  }
}

function submitResult(value: unknown): SubmitResult {
  if (!isRecord(value)) return { ok: false, best: 0, rank: 0, reason: 'bad reply' }
  return {
    ok: value.ok === true,
    best: typeof value.best === 'number' ? value.best : 0,
    rank: typeof value.rank === 'number' ? value.rank : 0,
    reason: typeof value.reason === 'string' ? value.reason : undefined
  }
}
