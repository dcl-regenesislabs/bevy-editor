import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer, registerMessages } from '@dcl/sdk/network'
import { createRpc } from './rpc'
import {
  OutcomeLog,
  OutcomeStream,
  chunkEntries,
  readOutcomeEntries,
  type OutcomeEntry
} from './pure/outcomeLedger'

// Server-validated gameplay results for pooled instances, delivered in order.
//
//   const ledger = outcomes(prefabId)                       // both sides
//   ledger.validate('hit', (p, from) => …)                  // server, before the
//                                                           // first heartbeat
//   ledger.report('hit', { instanceId, amount: 12 })        // any client
//   ledger.onOutcome(e => …)                                // every client
//
// Why a ledger and not just entity state: in 'planned' pools the server never
// materialises the entities and each client simulates positions differently, so
// there is no canonical position and proximity/hit validation is impossible IN
// PRINCIPLE. What "server HP authority" means here, exactly: HP lives server-side
// keyed by instance id, damage requests are rate-limited and clamped by the
// validator, and the resulting HP changes flow over this sequenced channel.
// Never claim more than "damage server-tracked, hits client-reported".
//
// Delivery: the server broadcasts each entry, clients apply strictly in seq order
// and repair gaps over rpc (`outcomes.since`) — one dropped broadcast used to mean
// one client with a permanently wrong alive-set. snapshot()/fastForward() are the
// rejoin and server-restart path; persist the snapshot with serverState.
//
// Cross-copy: every prefab carries its own copy of this file, so the ledgers live
// on globalThis.__dclOutcomes_v1 and only the first copy wires the transport.

const HUB_KEY = '__dclOutcomes_v1'
const BROADCAST = 'runtime.outcomes'
/** One repair reply must stay well under the transport's ~13 KB drop threshold. */
const ENTRIES_PER_MESSAGE = 48
/** Pages one repair walk may fetch, so a long history cannot spin forever. */
const SYNC_PAGES = 8
const SYNC_RETRIES = 3
const SYNC_RETRY_S = 2
const HISTORY_MAX = 2048

export type { OutcomeEntry }

export type OutcomeValidator = (
  payload: { instanceId: number; amount?: number },
  from: string
) => { ok: true; value: number } | { ok: false; reason: string }

export interface OutcomeLedger {
  /** client → server, over rpc; never throws. */
  report(kind: string, payload: { instanceId: number; amount?: number }): void
  /** server only; register before the first heartbeat. */
  validate(kind: string, fn: OutcomeValidator): void
  /** every client; fires for each broadcast entry, in seq order, gaps repaired via rpc. */
  onOutcome(handler: (entry: OutcomeEntry) => void): () => void
  /** durable state for rejoin fast-forward. */
  snapshot(): OutcomeEntry[]
  fastForward(entries: OutcomeEntry[]): void
}

interface LedgerState {
  log: OutcomeLog
  stream: OutcomeStream
  validators: Map<string, OutcomeValidator>
  handlers: Set<(entry: OutcomeEntry) => void>
  history: OutcomeEntry[]
  synced: boolean
}

interface OutcomeHub {
  ledgers: Map<string, LedgerState>
  report(key: string, kind: string, payload: { instanceId: number; amount?: number }): void
  requestSync(key: string): void
}

// createRpc and registerMessages register schemas — module scope, before the seal.
const rpc = createRpc('outcomes')
const room = registerMessages({
  [BROADCAST]: Schemas.Map({ key: Schemas.String, entries: Schemas.String })
})

export function outcomes(key: string): OutcomeLedger {
  const shared = hub()
  const state = ledgerState(shared, key)
  return {
    report(kind, payload) {
      shared.report(key, kind, payload)
    },
    validate(kind, fn) {
      if (!isServer()) {
        console.log('[outcomes] validate() is server-only, ignored on the client:', kind)
        return
      }
      state.validators.set(kind, fn)
    },
    onOutcome(handler) {
      state.handlers.add(handler)
      if (!isServer() && !state.synced) {
        state.synced = true
        shared.requestSync(key)
      }
      return () => state.handlers.delete(handler)
    },
    snapshot() {
      return isServer() ? state.log.entries() : [...state.history]
    },
    fastForward(entries) {
      if (isServer()) {
        state.log.restore(entries)
        return
      }
      deliver(state, state.stream.fastForward(entries))
    }
  }
}

function ledgerState(shared: OutcomeHub, key: string): LedgerState {
  const existing = shared.ledgers.get(key)
  if (existing !== undefined) return existing
  const created: LedgerState = {
    log: new OutcomeLog(),
    stream: new OutcomeStream(),
    validators: new Map(),
    handlers: new Set(),
    history: [],
    synced: false
  }
  shared.ledgers.set(key, created)
  return created
}

function deliver(state: LedgerState, entries: OutcomeEntry[]): void {
  for (const entry of entries) {
    state.history.push(entry)
    for (const handler of [...state.handlers]) {
      try {
        handler(entry)
      } catch (error) {
        console.error('[outcomes] handler failed for', entry.kind, error)
      }
    }
  }
  if (state.history.length > HISTORY_MAX) state.history.splice(0, state.history.length - HISTORY_MAX)
}

// The first copy to load wires the transport; every other copy shares its ledgers
// and its rpc instance, so a request is served once and a report is validated once.
function hub(): OutcomeHub {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[HUB_KEY]
  if (isHub(current)) return current
  const ledgers = new Map<string, LedgerState>()
  const reported = new Set<string>()
  const created: OutcomeHub = {
    ledgers,
    report(key, kind, payload) {
      if (isServer()) {
        serve(created, key, kind, payload, 'server')
        return
      }
      void rpc
        .call<{ ok?: unknown; reason?: unknown }>('report', { key, kind, ...payload })
        .then((verdict) => {
          // once per kind: a validator that never fires is otherwise invisible from
          // the client, and repeating it would spam every lagging shot
          if (verdict.ok === false && !reported.has(`${key}:${kind}`)) {
            reported.add(`${key}:${kind}`)
            console.log(`[outcomes] server rejected '${kind}':`, verdict.reason)
          }
        })
        .catch(() => {
          // a lost report is a lost hit, never a thrown error inside a script
        })
    },
    requestSync(key) {
      if (isServer()) return
      syncFromServer(created, key, SYNC_RETRIES, SYNC_PAGES)
    }
  }
  globals[HUB_KEY] = created
  if (isServer()) installServer(created)
  else installClient(created)
  return created
}

function installServer(shared: OutcomeHub): void {
  rpc.handle('report', (body, from) => {
    const request = readReport(body)
    if (request === null) return { ok: false, reason: 'malformed report' }
    return serve(shared, request.key, request.kind, request, from)
  })
  rpc.handle('since', (body) => {
    const request = readSince(body)
    if (request === null) return { entries: [], firstSeq: 0, lastSeq: 0 }
    const state = ledgerState(shared, request.key)
    // one page per reply: a whole match's history in a single message would cross
    // the transport's size limit and be dropped without a word
    const page = chunkEntries(state.log.since(request.seq), ENTRIES_PER_MESSAGE)[0] ?? []
    return { entries: page, firstSeq: state.log.firstSeq, lastSeq: state.log.lastSeq }
  })
}

function serve(
  shared: OutcomeHub,
  key: string,
  kind: string,
  payload: { instanceId: number; amount?: number },
  from: string
): { ok: boolean; reason?: string; seq?: number } {
  const state = ledgerState(shared, key)
  const validator = state.validators.get(kind)
  if (validator === undefined) return { ok: false, reason: `no validator for '${kind}'` }
  const verdict = validator({ instanceId: payload.instanceId, amount: payload.amount }, from)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }
  const entry = state.log.append(payload.instanceId, kind, verdict.value)
  deliver(state, [entry])
  for (const chunk of chunkEntries([entry], ENTRIES_PER_MESSAGE)) send(key, chunk)
  return { ok: true, seq: entry.seq }
}

function installClient(shared: OutcomeHub): void {
  room.onMessage(BROADCAST, (raw) => {
    const data = raw as { key: string; entries: string }
    const state = ledgerState(shared, data.key)
    const { applied, gapFrom } = state.stream.accept(decode(data.entries))
    deliver(state, applied)
    if (gapFrom !== null) syncFromServer(shared, data.key, SYNC_RETRIES, SYNC_PAGES)
  })
}

function syncFromServer(shared: OutcomeHub, key: string, retriesLeft: number, pagesLeft: number): void {
  if (pagesLeft <= 0) return
  const state = ledgerState(shared, key)
  void rpc
    .call<{ entries?: unknown; firstSeq?: unknown; lastSeq?: unknown }>('since', { key, seq: state.stream.lastSeq })
    .then((response) => {
      const entries = readOutcomeEntries(response.entries)
      const firstSeq = typeof response.firstSeq === 'number' ? response.firstSeq : 0
      const lastSeq = typeof response.lastSeq === 'number' ? response.lastSeq : 0
      // history older than the server's window is gone: jump rather than stall
      if (firstSeq > state.stream.lastSeq + 1) deliver(state, state.stream.fastForward(entries))
      else deliver(state, state.stream.accept(entries).applied)
      // replies are paged, so keep walking until the client is level with the server
      if (entries.length > 0 && state.stream.lastSeq < lastSeq) {
        syncFromServer(shared, key, retriesLeft, pagesLeft - 1)
      }
    })
    .catch(() => {
      if (retriesLeft > 1) retry(() => syncFromServer(shared, key, retriesLeft - 1, pagesLeft))
    })
}

// The transport is not up when a script starts; a one-shot dt system is the only
// timer a scene has.
function retry(run: () => void): void {
  const name = `runtime-outcomes-retry-${Math.floor(Math.random() * 1e9)}`
  let waited = 0
  engine.addSystem(
    (dt: number) => {
      waited += dt
      if (waited < SYNC_RETRY_S) return
      engine.removeSystem(name)
      run()
    },
    undefined,
    name
  )
}

function send(key: string, entries: OutcomeEntry[]): void {
  try {
    room.send(BROADCAST, { key, entries: JSON.stringify(entries) })
  } catch {
    // transport down — clients repair the gap when the next entry lands
  }
}

function decode(raw: string): OutcomeEntry[] {
  try {
    return readOutcomeEntries(JSON.parse(raw))
  } catch {
    return []
  }
}

function readReport(body: unknown): { key: string; kind: string; instanceId: number; amount?: number } | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.key !== 'string' || typeof record.kind !== 'string') return null
  if (typeof record.instanceId !== 'number' || !Number.isFinite(record.instanceId)) return null
  const amount = record.amount
  return {
    key: record.key,
    kind: record.kind,
    instanceId: record.instanceId,
    ...(typeof amount === 'number' && Number.isFinite(amount) ? { amount } : {})
  }
}

function readSince(body: unknown): { key: string; seq: number } | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.key !== 'string') return null
  return { key: record.key, seq: typeof record.seq === 'number' ? record.seq : 0 }
}

// Two copies of this file are two classes, so instanceof would reject the shared
// hub — shape is the only identity that survives (same rule as zoneBus).
function isHub(value: unknown): value is OutcomeHub {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ledgers' in value &&
    value.ledgers instanceof Map &&
    'report' in value &&
    typeof value.report === 'function' &&
    'requestSync' in value &&
    typeof value.requestSync === 'function'
  )
}
