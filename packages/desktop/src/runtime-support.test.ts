import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  advancePhase,
  cycleMsOf,
  durationOf,
  phaseElapsedMs,
  phaseEndsAtMs,
  phaseIndexOf,
  phaseOf,
  phaseRemainingMs,
  phaseStartMsOf,
  PhaseWatcher,
  type PhaseTuple
} from '../runtime-modules/pure/phase'
import { createRng, rngInt, seededSequence } from '../runtime-modules/rng'

// The SDK-bound runtime modules (serverLife, playerStore, schedule) compile
// against the scene's auth-server pin, never against this package's tsconfig —
// a static import here would drag @dcl/sdk/server and isServer() into the
// desktop program, where they do not exist. So they are loaded by path at run
// time and typed through the shims below, which double as an assertion that the
// modules still expose the API their header documents. Their SDK dependencies
// are faked: engine systems, isServer, Storage.player. Nothing else is touched
// by the logic under test.

const systems: Array<{ fn: (dt: number) => void; name: string }> = []
const storageRows = new Map<string, unknown>()
let storageOk = true
let storageWrites = 0

vi.mock('@dcl/sdk/ecs', () => {
  const components = new Map<string, unknown>()
  const engine = {
    defineComponent: (name: string) => {
      const values = new Map<number, { beat: number }>()
      const definition = {
        componentId: components.size + 1,
        create: (entity: number, value: { beat: number }) => values.set(entity, { ...value }),
        get: (entity: number) => values.get(entity) ?? { beat: 0 },
        getMutable: (entity: number) => {
          const existing = values.get(entity) ?? { beat: 0 }
          values.set(entity, existing)
          return existing
        },
        validateBeforeChange: () => {},
        entities: values
      }
      components.set(name, definition)
      return definition
    },
    getComponentOrNull: (name: string) => components.get(name) ?? null,
    addSystem: (fn: (dt: number) => void, _priority: unknown, name: string) => systems.push({ fn, name }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    addEntity: () => 1000 + components.size,
    getEntitiesWith: (definition: { entities: Map<number, unknown> }) =>
      [...definition.entities.entries()].map(([entity, value]) => [entity, value])
  }
  return { engine, Schemas: { Int64: 'int64', Int: 'int', String: 'string' } }
})

vi.mock('@dcl/sdk/network', () => ({ isServer: () => false, syncEntity: () => {} }))
// serverLife seals the protected-sync ledger when it arms the heartbeat, and
// that module asks the platform whether this is a preview realm at import time.
vi.mock('~system/Runtime', () => ({
  getRealm: async () => ({ realmInfo: { isPreview: false } })
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({
  AUTH_SERVER_PEER_ID: '0x0000000000000000000000000000000000000000'
}))
vi.mock('@dcl/sdk/server', () => ({
  Storage: {
    player: {
      get: async <T>(address: string, key: string): Promise<T | null> =>
        (storageRows.get(`${address}:${key}`) as T | undefined) ?? null,
      set: async (address: string, key: string, value: unknown): Promise<boolean> => {
        storageWrites++
        if (!storageOk) return false
        storageRows.set(`${address}:${key}`, value)
        return true
      }
    }
  }
}))

type ServerLifeState = 'running' | 'waking' | 'degraded' | 'asleep' | 'unreachable'

interface Ladder {
  start(nowMs: number): void
  observe(value: number | null, nowMs: number): boolean
  state(nowMs: number): ServerLifeState
  ageMs(nowMs: number): number
  everAlive(): boolean
}

interface ServerLifeModule {
  ServerLifeLadder: new () => Ladder
  SERVER_LIFE_THRESHOLDS: { degradedAfterMs: number; asleepAfterMs: number; wakeTimeoutMs: number }
}

interface Progress {
  schemaVersion: number
  hp: number
}

interface Debouncer {
  mark(nowMs: number): void
  pending(): boolean
  isDue(nowMs: number): boolean
  clear(): void
}

interface Store {
  readonly key: string
  load(address: string): Promise<Progress>
  mutate(address: string, mutator: (value: Progress) => void): boolean
  markDirty(address: string): void
  flushIfDue(nowMs?: number): Promise<string[]> | null
  flushNow(): Promise<string[]>
  readonly dirtyCount: number
  flushPending(): boolean
}

interface PlayerStoreModule {
  FlushDebouncer: new (policy: { debounceMs: number; maxDelayMs: number }) => Debouncer
  createPlayerStore: (options: {
    key: string
    schemaVersion: number
    defaults: () => Progress
    repair: (value: Partial<Progress>, defaults: Progress) => Progress
    flush?: { debounceMs?: number; maxDelayMs?: number }
    now?: () => number
  }) => Store
  releasePlayerStoreKey: (key: string) => void
}

interface ScheduleModule {
  onPhaseBoundary: (
    read: () => { tuple: PhaseTuple; durationsMs: readonly number[] } | null,
    onEnter: (phase: number, tuple: PhaseTuple) => void,
    name?: string
  ) => () => void
  phaseOf: (tuple: PhaseTuple, durationsMs: readonly number[], nowMs: number) => number
}

let serverLife: ServerLifeModule
let playerStore: PlayerStoreModule
let schedule: ScheduleModule

beforeAll(async () => {
  serverLife = await vi.importActual<ServerLifeModule>('../runtime-modules/serverLife')
  playerStore = await vi.importActual<PlayerStoreModule>('../runtime-modules/playerStore')
  schedule = await vi.importActual<ScheduleModule>('../runtime-modules/schedule')
})

const LOBBY = 10_000
const WAVE = 30_000
const BREAK = 5_000
const ROUND = [LOBBY, WAVE, BREAK]

describe('_runtime phase (deadline-as-state)', () => {
  it('holds the phase until its deadline passes', () => {
    const tuple = { phase: 0, phaseStartMs: 1_000 }
    expect(phaseOf(tuple, ROUND, 1_000)).toBe(0)
    expect(phaseOf(tuple, ROUND, 10_999)).toBe(0)
    expect(phaseOf(tuple, ROUND, 11_000)).toBe(1)
  })

  it('cycles the duration table and keeps counting phases up', () => {
    const tuple = { phase: 0, phaseStartMs: 0 }
    expect(phaseOf(tuple, ROUND, LOBBY + WAVE + BREAK)).toBe(3)
    expect(phaseIndexOf(3, ROUND.length)).toBe(0)
    expect(durationOf({ phase: 4, phaseStartMs: 0 }, ROUND)).toBe(WAVE)
    expect(cycleMsOf(ROUND)).toBe(45_000)
  })

  it('settles a long sleep in one step and lands on the right phase start', () => {
    const tuple = { phase: 0, phaseStartMs: 0 }
    const weekMs = 7 * 24 * 60 * 60 * 1000
    const settled = advancePhase(tuple, ROUND, weekMs)
    expect(settled.phase).toBe(phaseOf(tuple, ROUND, weekMs))
    expect(settled.phaseStartMs).toBeLessThanOrEqual(weekMs)
    expect(phaseEndsAtMs(settled, ROUND)).toBeGreaterThan(weekMs)
    expect(phaseStartMsOf(tuple, ROUND, weekMs)).toBe(settled.phaseStartMs)
  })

  it('parks on a non-positive duration instead of spinning', () => {
    const tuple = { phase: 0, phaseStartMs: 0 }
    const durations = [0, WAVE]
    expect(phaseOf(tuple, durations, 10 ** 9)).toBe(0)
    expect(phaseEndsAtMs(tuple, durations)).toBe(Number.POSITIVE_INFINITY)
    expect(phaseRemainingMs(tuple, durations, 10 ** 9)).toBe(Number.POSITIVE_INFINITY)
  })

  it('never reports negative elapsed or remaining time', () => {
    const tuple = { phase: 1, phaseStartMs: 5_000 }
    expect(phaseElapsedMs(tuple, 0)).toBe(0)
    expect(phaseRemainingMs(tuple, ROUND, 10 ** 9)).toBe(0)
  })

  it('leaves an empty duration table alone', () => {
    const tuple = { phase: 2, phaseStartMs: 42 }
    expect(advancePhase(tuple, [], 10 ** 9)).toEqual(tuple)
  })
})

describe('_runtime phase watcher', () => {
  it('enters the phase in progress on the first step', () => {
    const watcher = new PhaseWatcher()
    expect(watcher.step(7)).toEqual({ entered: [7], skipped: 0 })
    expect(watcher.step(7)).toBeNull()
    expect(watcher.current()).toBe(7)
  })

  it('reports every crossed boundary in order, and a rewind as a single entry', () => {
    const watcher = new PhaseWatcher()
    watcher.step(1)
    expect(watcher.step(4)).toEqual({ entered: [2, 3, 4], skipped: 0 })
    expect(watcher.step(0)).toEqual({ entered: [0], skipped: 0 })
  })

  it('collapses a gap larger than the catch-up budget', () => {
    const watcher = new PhaseWatcher(3)
    watcher.step(0)
    expect(watcher.step(400)).toEqual({ entered: [400], skipped: 399 })
  })
})

describe('_runtime schedule phase hooks', () => {
  beforeEach(() => {
    systems.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  it('re-exports the pure derivation', () => {
    expect(schedule.phaseOf({ phase: 0, phaseStartMs: 0 }, ROUND, LOBBY)).toBe(1)
  })

  it('fires once per boundary and parks while the tuple is unknown', () => {
    let source: { tuple: PhaseTuple; durationsMs: readonly number[] } | null = null
    const entered: number[] = []
    const stop = schedule.onPhaseBoundary(
      () => source,
      (phase) => entered.push(phase),
      'test-phase'
    )
    const system = systems.find((candidate) => candidate.name === 'test-phase')
    expect(system).toBeDefined()

    system?.fn(0)
    expect(entered).toEqual([])

    source = { tuple: { phase: 0, phaseStartMs: 0 }, durationsMs: ROUND }
    system?.fn(0)
    system?.fn(0)
    expect(entered).toEqual([0])

    vi.setSystemTime(LOBBY)
    system?.fn(0)
    expect(entered).toEqual([0, 1])

    stop()
    expect(systems.some((candidate) => candidate.name === 'test-phase')).toBe(false)
  })
})

describe('_runtime rng draw order', () => {
  it('reconstructs the same sequence from the same seed', () => {
    const draw = (rng: () => number, i: number): number => rngInt(rng, 0, 10) + i
    expect(seededSequence(99, 5, draw)).toEqual(seededSequence(99, 5, draw))
    expect(seededSequence(99, 5, draw)).not.toEqual(seededSequence(100, 5, draw))
  })

  it('is prefix-stable: appending draws never re-rolls the earlier ones', () => {
    const draw = (rng: () => number): number => rng()
    const short = seededSequence(7, 3, draw)
    const long = seededSequence(7, 6, draw)
    expect(long.slice(0, 3)).toEqual(short)
  })

  it('takes exactly `count` whole draws, in index order', () => {
    const indices: number[] = []
    const rng = createRng(5)
    const expected = [rng(), rng(), rng()]
    const drawn = seededSequence(5, 3, (stream, i) => {
      indices.push(i)
      return stream()
    })
    expect(drawn).toEqual(expected)
    expect(indices).toEqual([0, 1, 2])
    expect(seededSequence(1, -4, (stream) => stream())).toEqual([])
    expect(seededSequence(1, 2.9, (stream) => stream())).toHaveLength(2)
  })
})

describe('_runtime serverLife ladder', () => {
  it('is waking before the first beat, unreachable once the cold-start window closes', () => {
    const thresholds = serverLife.SERVER_LIFE_THRESHOLDS
    const ladder = new serverLife.ServerLifeLadder()
    ladder.start(0)
    expect(ladder.state(0)).toBe('waking')
    expect(ladder.state(thresholds.wakeTimeoutMs)).toBe('waking')
    expect(ladder.state(thresholds.wakeTimeoutMs + 1)).toBe('unreachable')
    expect(ladder.everAlive()).toBe(false)
  })

  it('runs while beats land, then degrades after three missed pulses', () => {
    const thresholds = serverLife.SERVER_LIFE_THRESHOLDS
    const ladder = new serverLife.ServerLifeLadder()
    ladder.start(0)
    expect(ladder.observe(1, 100)).toBe(true)
    expect(ladder.state(100)).toBe('running')
    // the same value again is not life — a stale snapshot carries one
    expect(ladder.observe(1, 100 + thresholds.degradedAfterMs + 1)).toBe(false)
    expect(ladder.state(100 + thresholds.degradedAfterMs)).toBe('running')
    expect(ladder.state(100 + thresholds.degradedAfterMs + 1)).toBe('degraded')
  })

  it('calls a long silence asleep, and recovers to running on the next beat', () => {
    const thresholds = serverLife.SERVER_LIFE_THRESHOLDS
    const ladder = new serverLife.ServerLifeLadder()
    ladder.start(0)
    ladder.observe(1, 0)
    expect(ladder.state(thresholds.asleepAfterMs)).toBe('degraded')
    expect(ladder.state(thresholds.asleepAfterMs + 1)).toBe('asleep')
    ladder.observe(2, 60_000)
    expect(ladder.state(60_000)).toBe('running')
    expect(ladder.ageMs(60_500)).toBe(500)
  })

  it('never reports unreachable once a beat has landed, and ages from the watch start before that', () => {
    const ladder = new serverLife.ServerLifeLadder()
    ladder.start(1_000)
    expect(ladder.ageMs(4_000)).toBe(3_000)
    ladder.observe(1, 5_000)
    expect(ladder.state(10 ** 9)).toBe('asleep')
  })

  it('keeps the degraded threshold at three pulses', () => {
    expect(serverLife.SERVER_LIFE_THRESHOLDS.degradedAfterMs).toBe(6_000)
    expect(serverLife.SERVER_LIFE_THRESHOLDS.asleepAfterMs).toBeGreaterThan(6_000)
  })
})

describe('_runtime playerStore flush debounce', () => {
  it('waits for quiet, then fires', () => {
    const debouncer = new playerStore.FlushDebouncer({ debounceMs: 1_000, maxDelayMs: 10_000 })
    expect(debouncer.isDue(0)).toBe(false)
    debouncer.mark(0)
    expect(debouncer.pending()).toBe(true)
    expect(debouncer.isDue(999)).toBe(false)
    debouncer.mark(500)
    expect(debouncer.isDue(1_400)).toBe(false)
    expect(debouncer.isDue(1_500)).toBe(true)
  })

  it('checkpoints at the ceiling even while mutations keep coming', () => {
    const debouncer = new playerStore.FlushDebouncer({ debounceMs: 1_000, maxDelayMs: 3_000 })
    debouncer.mark(0)
    for (let t = 100; t <= 2_900; t += 100) debouncer.mark(t)
    expect(debouncer.isDue(2_950)).toBe(false)
    debouncer.mark(3_000)
    expect(debouncer.isDue(3_000)).toBe(true)
  })

  it('clears back to idle', () => {
    const debouncer = new playerStore.FlushDebouncer({ debounceMs: 10, maxDelayMs: 20 })
    debouncer.mark(0)
    debouncer.clear()
    expect(debouncer.pending()).toBe(false)
    expect(debouncer.isDue(10 ** 6)).toBe(false)
  })
})

const PROGRESS_VERSION = 2

function progressStore(key: string, now: () => number): Store {
  return playerStore.createPlayerStore({
    key,
    schemaVersion: PROGRESS_VERSION,
    defaults: () => ({ schemaVersion: PROGRESS_VERSION, hp: 100 }),
    repair: (value, defaults) => ({
      schemaVersion: PROGRESS_VERSION,
      hp: typeof value.hp === 'number' && Number.isFinite(value.hp) ? value.hp : defaults.hp
    }),
    flush: { debounceMs: 1_000, maxDelayMs: 5_000 },
    now
  })
}

describe('_runtime playerStore', () => {
  beforeEach(() => {
    storageRows.clear()
    storageOk = true
    storageWrites = 0
  })

  it('throws when a second store claims the same key', () => {
    const store = progressStore('claimed_v1', () => 0)
    expect(store.key).toBe('claimed_v1')
    expect(() => progressStore('claimed_v1', () => 0)).toThrow(/already claimed/)
    playerStore.releasePlayerStoreKey('claimed_v1')
    expect(() => progressStore('claimed_v1', () => 0)).not.toThrow()
    playerStore.releasePlayerStoreKey('claimed_v1')
  })

  it('repairs a stored row of an older schema version on read', async () => {
    storageRows.set('0xabc:repair_v1', { schemaVersion: 1, hp: 3 })
    const store = progressStore('repair_v1', () => 0)
    expect((await store.load('0xABC')).hp).toBe(100)
    playerStore.releasePlayerStoreKey('repair_v1')
  })

  it('repairs a corrupt field of a current-version row', async () => {
    storageRows.set('0xabc:field_v1', { schemaVersion: PROGRESS_VERSION, hp: 'lots' })
    const store = progressStore('field_v1', () => 0)
    expect((await store.load('0xabc')).hp).toBe(100)
    playerStore.releasePlayerStoreKey('field_v1')
  })

  it('coalesces a burst of mutations into one checked write', async () => {
    let nowMs = 0
    const store = progressStore('burst_v1', () => nowMs)
    await store.load('0xabc')
    storageWrites = 0

    for (let i = 0; i < 20; i++) {
      nowMs += 10
      store.mutate('0xabc', (value) => (value.hp -= 1))
      expect(store.flushIfDue()).toBeNull()
    }
    expect(storageWrites).toBe(0)

    nowMs += 1_000
    const flush = store.flushIfDue()
    expect(flush).not.toBeNull()
    expect(await flush).toEqual([])
    expect(storageWrites).toBe(1)
    expect(store.dirtyCount).toBe(0)
    expect(store.flushIfDue()).toBeNull()
    expect(storageRows.get('0xabc:burst_v1')).toEqual({ schemaVersion: PROGRESS_VERSION, hp: 80 })
    playerStore.releasePlayerStoreKey('burst_v1')
  })

  it('keeps a failed write dirty and re-arms the debounce', async () => {
    let nowMs = 0
    const store = progressStore('retry_v1', () => nowMs)
    await store.load('0xabc')
    store.mutate('0xabc', (value) => (value.hp = 42))

    storageOk = false
    nowMs += 2_000
    expect(await store.flushNow()).toEqual(['0xabc'])
    expect(store.dirtyCount).toBe(1)
    expect(store.flushPending()).toBe(true)

    storageOk = true
    nowMs += 2_000
    expect(await store.flushIfDue()).toEqual([])
    expect(store.dirtyCount).toBe(0)
    expect(storageRows.get('0xabc:retry_v1')).toEqual({ schemaVersion: PROGRESS_VERSION, hp: 42 })
    playerStore.releasePlayerStoreKey('retry_v1')
  })

  it('coalesces concurrent checkpoints into the in-flight write', async () => {
    const store = progressStore('inflight_v1', () => 0)
    await store.load('0xabc')
    store.mutate('0xabc', (value) => (value.hp = 7))
    storageWrites = 0
    const first = store.flushNow()
    const second = store.flushNow()
    expect(second).toBe(first)
    await first
    expect(storageWrites).toBe(1)
    playerStore.releasePlayerStoreKey('inflight_v1')
  })

  it('marks a player dirty when mutated through a reference from get()', async () => {
    let nowMs = 0
    const store = progressStore('ref_v1', () => nowMs)
    const loaded = await store.load('0xabc')
    await store.flushNow()
    loaded.hp = 5
    store.markDirty('0xABC')
    nowMs += 1_000
    await store.flushIfDue()
    expect(storageRows.get('0xabc:ref_v1')).toEqual({ schemaVersion: PROGRESS_VERSION, hp: 5 })
    playerStore.releasePlayerStoreKey('ref_v1')
  })
})
