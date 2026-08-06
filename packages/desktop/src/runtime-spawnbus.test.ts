import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stableId } from '../runtime-modules/pure/poolState'
import { zoneKey } from '../runtime-modules/pure/zoneRegistry'
import { effectiveScatter, scatterOffset } from '../runtime-modules/pure/spawnScatter'
import {
  DESPAWN_KIND,
  SPAWN_KIND,
  aliveCount,
  aliveIn,
  alivePairs,
  applyEntry,
  emptyFold,
  foldEntries,
  hasSeen,
  isAlive,
  spotOfInstance,
  type OutcomeEntryLike
} from '../runtime-modules/pure/spawnFold'
import { composeWorld, identityTransform, mulQuat, rotateVec } from '../runtime-modules/pure/worldTransform'

// The spawn bus, run against a fake engine rather than read as text. What breaks
// in a real room is never visible to a source assertion: a client that folds the
// catch-up walk in the wrong order materialises copies the room already retired,
// a server that restarts and renumbers its ledger from 1 goes silently deaf to
// every client still holding a higher sequence number, and an rpc retry that is
// not deduped turns one press into two copies.
//
// Both halves run here, one peer at a time. The transport is driven by hand —
// the test IS the other peer — which is what makes the nasty orderings
// (a broadcast before the walk lands, a walk that skips forward, a restart)
// constructible at all.

interface ChangeProbe {
  entity: number
  newValue: unknown
  senderAddress: string
}

interface FakeComponent {
  componentId: number
  componentName: string
  entities: Map<number, Record<string, unknown>>
  create(entity: number, value?: Record<string, unknown>): void
  createOrReplace(entity: number, value?: Record<string, unknown>): void
  get(entity: number): Record<string, unknown>
  getOrNull(entity: number): Record<string, unknown> | null
  getMutable(entity: number): Record<string, unknown>
  getMutableOrNull(entity: number): Record<string, unknown> | null
  has(entity: number): boolean
  deleteFrom(entity: number): void
  validateBeforeChange(...args: unknown[]): void
}

const host = vi.hoisted(() => {
  const components = new Map<string, FakeComponent>()
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const handlers = new Map<string, (raw: unknown, context?: { from: string }) => void>()
  const sent: Array<{ name: string; payload: Record<string, unknown> }> = []
  const storage = new Map<string, unknown>()
  let storageBroken = false
  const removed = new Set<number>()
  let server = false
  let nextEntity = 512
  let nextComponentId = 1

  function define(name: string): FakeComponent {
    const values = new Map<number, Record<string, unknown>>()
    const definition: FakeComponent = {
      componentId: nextComponentId++,
      componentName: name,
      entities: values,
      create: (entity, value = {}) => void values.set(entity, { ...value }),
      createOrReplace: (entity, value = {}) => void values.set(entity, { ...value }),
      get: (entity) => values.get(entity) ?? {},
      getOrNull: (entity) => values.get(entity) ?? null,
      getMutable: (entity) => {
        const existing = values.get(entity) ?? {}
        values.set(entity, existing)
        return existing
      },
      getMutableOrNull: (entity) => values.get(entity) ?? null,
      has: (entity) => values.has(entity),
      deleteFrom: (entity) => void values.delete(entity),
      validateBeforeChange: () => {}
    }
    components.set(name, definition)
    return definition
  }

  const engine = {
    RootEntity: 0,
    PlayerEntity: 1,
    defineComponent: (name: string) => define(name),
    getComponentOrNull: (name: string) => components.get(name) ?? null,
    componentsIter: () => components.values(),
    addEntity: () => nextEntity++,
    removeEntity: (entity: number) => {
      removed.add(entity)
      for (const component of components.values()) component.entities.delete(entity)
    },
    getEntityState: (entity: number) => (removed.has(entity) ? 2 : 1),
    addSystem: (fn: (dt: number) => void, _priority: unknown, name?: string) => systems.push({ fn, name: name ?? '' }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    getEntitiesWith: (definition: FakeComponent) => [...definition.entities.entries()]
  }

  return {
    engine,
    components,
    handlers,
    sent,
    storage,
    get storageBroken() {
      return storageBroken
    },
    set storageBroken(value: boolean) {
      storageBroken = value
    },
    define,
    isServer: (): boolean => server,
    setServer: (next: boolean): void => void (server = next),
    tick: (dt = 1): void => {
      for (const system of [...systems]) system.fn(dt)
    },
    systemNames: (): string[] => systems.map((system) => system.name),
    register: (spec: Record<string, unknown>) => {
      const names = Object.keys(spec)
      return {
        send: (name: string, payload: Record<string, unknown>) => void sent.push({ name, payload }),
        onMessage: (name: string, cb: (raw: unknown, context?: { from: string }) => void) => {
          if (names.includes(name)) handlers.set(name, cb)
        }
      }
    },
    reset: (): void => {
      // the definitions survive — the mock factory hands out fixed objects and
      // runs once — but every entity a previous run wrote is gone, which is what
      // "a second process loading the same scene" actually looks like
      for (const component of components.values()) component.entities.clear()
      systems.length = 0
      handlers.clear()
      sent.length = 0
      removed.clear()
      server = false
      nextEntity = 512
      nextComponentId = 1
    }
  }
})

vi.mock('@dcl/sdk/ecs', () => ({
  engine: host.engine,
  EntityState: { Unknown: 0, UsedEntity: 1, Removed: 2, Reserved: 3 },
  Schemas: {
    Boolean: 'boolean',
    Int: 'int',
    Int64: 'int64',
    String: 'string',
    Array: (spec: unknown) => spec,
    Map: (spec: unknown) => spec
  },
  PlayerIdentityData: host.define('core::PlayerIdentityData'),
  Transform: host.define('core::Transform'),
  GltfContainer: host.define('core::GltfContainer')
}))
vi.mock('@dcl/sdk/network', () => ({
  isServer: () => host.isServer(),
  syncEntity: () => {},
  registerMessages: (spec: Record<string, unknown>) => host.register(spec)
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({
  AUTH_SERVER_PEER_ID: '0x0000000000000000000000000000000000000000'
}))
vi.mock('@dcl/sdk/server', () => ({
  Storage: {
    get: async (key: string) => {
      if (host.storageBroken) throw new Error('storage unavailable')
      return host.storage.get(key) ?? null
    },
    set: async (key: string, value: unknown) => {
      host.storage.set(key, JSON.parse(JSON.stringify(value)))
      return true
    }
  }
}))
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: false } }) }))
vi.mock('@dcl/asset-packs', () => ({ getActionEvents: () => ({ emit: () => {} }) }))
vi.mock('../runtime-modules/playerPositions', () => ({ playerPositions: () => [] }))

interface Pool {
  readonly prefab: string
  readonly max: number
  acquire(instanceId?: number, init?: Record<string, unknown>): number | null
  alive(): number[]
}

interface SpawnSpot {
  request(): void
  alive(): number[]
  ready(): boolean
}

interface SpawnerModule {
  registerSpawnables(snapshots: unknown[], components?: Record<string, unknown>): void
  pool(prefab: string, mode: 'server' | 'seeded'): Pool
}

interface OutcomesModule {
  outcomes(key: string): { report(kind: string, payload: { instanceId: number; amount?: number }): void }
}

interface BusModule {
  spawnSpot(
    name: string,
    opts: { pool: Pool; spot: number; atMostAtOnce: number; lifetimeS: number; scatterRadius?: number }
  ): SpawnSpot | null
  requestSpawn(name: string): void
  retireSpawned(entity: number): void
  spotNames(): string[]
}

const PREFAB = 'crate-prefab'
const SPOT_NAME = 'Crate Spawner'
const SPOT_ID = stableId(zoneKey(SPOT_NAME))
const WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GLOBAL_KEYS = [
  '__dclSpawnBus_v1',
  '__dclSpawner_v1',
  '__dclOutcomes_v1',
  '__dclServerLife_v1',
  '__dclServerState_v1',
  '__dclProtectedSync_v1',
  '__DCL_SCRIPT_INSTANCES__'
]

let logged: string[] = []
let clock = 1_700_000_000_000

beforeEach(() => {
  host.reset()
  host.storage.clear()
  host.storageBroken = false
  vi.resetModules()
  const globals = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) delete globals[key]
  logged = []
  clock = 1_700_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function load(): Promise<{ bus: BusModule; spawner: SpawnerModule; ledgers: OutcomesModule }> {
  const spawner = await vi.importActual<SpawnerModule>('../runtime-modules/spawner')
  const bus = await vi.importActual<BusModule>('../runtime-modules/spawnBus')
  const ledgers = await vi.importActual<OutcomesModule>('../runtime-modules/outcomes')
  return { bus, spawner, ledgers }
}

/** Lets every queued promise (Storage reads, rpc replies) run to completion. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function transform(): FakeComponent {
  return host.components.get('core::Transform') as FakeComponent
}

function makeSpot(position: { x: number; y: number; z: number }, parent?: number): number {
  const entity = host.engine.addEntity()
  transform().createOrReplace(entity, {
    position,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    ...(parent === undefined ? {} : { parent })
  })
  return entity
}

function registerPrefab(spawner: SpawnerModule, max = 8): void {
  spawner.registerSpawnables([
    {
      prefab: PREFAB,
      alias: 'Crate',
      max,
      instancing: 'onDemand',
      entities: [
        {
          localId: 1,
          parent: null,
          components: [
            {
              name: 'core::Transform',
              json: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }
            }
          ]
        }
      ],
      scripts: []
    }
  ])
}

async function openSpot(
  bus: BusModule,
  spawner: SpawnerModule,
  opts: { atMostAtOnce?: number; lifetimeS?: number; scatterRadius?: number; spot?: number } = {}
): Promise<SpawnSpot | null> {
  const handle = bus.spawnSpot(SPOT_NAME, {
    pool: spawner.pool(PREFAB, 'seeded'),
    spot: opts.spot ?? makeSpot({ x: 10, y: 1, z: 20 }),
    atMostAtOnce: opts.atMostAtOnce ?? 2,
    lifetimeS: opts.lifetimeS ?? 0,
    ...(opts.scatterRadius === undefined ? {} : { scatterRadius: opts.scatterRadius })
  })
  await settle()
  return handle
}

// --- driving the transport by hand ------------------------------------------

function deliver(name: string, payload: Record<string, unknown>, context?: { from: string }): void {
  host.handlers.get(name)?.(payload, context)
}

async function ask(nonce: string, from: string = WALLET, spot: number = SPOT_ID): Promise<void> {
  deliver('spawnBus.rpc.req', { id: `req-${from}-${nonce}`, method: 'ask', body: JSON.stringify({ spot, nonce }) }, { from })
  await settle()
}

function replies(): Array<{ ok: boolean; instanceId?: number; reason?: string }> {
  return host.sent
    .filter((message) => message.name === 'spawnBus.rpc.res')
    .map((message) => JSON.parse(String(message.payload.body)) as { ok: boolean; instanceId?: number; reason?: string })
}

interface WireEntry {
  seq: number
  instanceId: number
  kind: string
  value: number
}

function broadcasts(): WireEntry[] {
  const entries: WireEntry[] = []
  for (const message of host.sent) {
    if (message.name !== 'runtime.outcomes') continue
    for (const entry of JSON.parse(String(message.payload.entries)) as WireEntry[]) entries.push(entry)
  }
  return entries
}

function spawnsOnTheWire(): WireEntry[] {
  return broadcasts().filter((entry) => entry.kind === 'spawn')
}

/** The client's catch-up walk: answer the `since` call it made when it subscribed. */
async function answerWalk(entries: WireEntry[], firstSeq = 1): Promise<void> {
  const request = [...host.sent].reverse().find((message) => message.name === 'outcomes.rpc.req')
  expect(request, 'the client asked the server for the history it missed').toBeDefined()
  const lastSeq = entries.length === 0 ? 0 : entries[entries.length - 1].seq
  deliver('outcomes.rpc.res', {
    id: String(request?.payload.id),
    ok: true,
    body: JSON.stringify({ entries, firstSeq, lastSeq })
  })
  await settle()
}

function pushBroadcast(entries: WireEntry[]): void {
  deliver('runtime.outcomes', { key: PREFAB, entries: JSON.stringify(entries) })
}

function heartbeat(): void {
  const beat = host.components.get('runtime::Heartbeat')
  beat?.createOrReplace(4242, { beat: clock })
  host.tick()
}

function entry(seq: number, instanceId: number, kind: string, value = SPOT_ID): WireEntry {
  return { seq, instanceId, kind, value }
}

// --- the server -------------------------------------------------------------

describe('the server mints every copy', () => {
  it('numbers copies monotonically and broadcasts one entry per press', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 3 })

    await ask('n1', '0xa1')
    await ask('n2', '0xa2')

    expect(replies().map((reply) => reply.instanceId)).toEqual([1, 2])
    expect(spawnsOnTheWire().map((wire) => wire.instanceId)).toEqual([1, 2])
    expect(spawnsOnTheWire().every((wire) => wire.value === SPOT_ID)).toBe(true)
  })

  it('answers a resent request with the id it already minted, and appends once', async () => {
    // rpc resends the SAME body on a timeout, and the handler is given (body, from)
    // with no request id — so the nonce in the body is the only thing that can
    // tell a retry apart from a second press.
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 3 })

    await ask('same-nonce')
    await ask('same-nonce')

    const answers = replies()
    expect(answers).toHaveLength(2)
    expect(answers[0].instanceId).toBe(answers[1].instanceId)
    expect(spawnsOnTheWire()).toHaveLength(1)
  })

  it('refuses a press once the spot is holding as many copies as it allows', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 2 })

    await ask('n1', '0xa1')
    await ask('n2', '0xa2')
    await ask('n3', '0xa3')

    expect(spawnsOnTheWire()).toHaveLength(2)
    const last = replies()[2]
    expect(last.ok).toBe(false)
    expect(String(last.reason)).toContain('as many copies as it allows')
  })

  it('rejects a resurrection, and a despawn for a copy that is not there', async () => {
    host.setServer(true)
    const { bus, spawner, ledgers } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 3 })
    const ledger = ledgers.outcomes(PREFAB)

    await ask('n1', '0xa1')
    expect(spawnsOnTheWire()).toHaveLength(1)

    // an id that has ever existed can never be spawned again — even by the server
    ledger.report('spawn', { instanceId: 1, amount: SPOT_ID })
    expect(spawnsOnTheWire()).toHaveLength(1)

    // a despawn for a copy nobody spawned names nothing to remove
    ledger.report('despawn', { instanceId: 99 })
    expect(broadcasts().filter((wire) => wire.kind === 'despawn')).toHaveLength(0)

    // retiring the copy works exactly once, and it stays gone
    ledger.report('despawn', { instanceId: 1 })
    ledger.report('despawn', { instanceId: 1 })
    expect(broadcasts().filter((wire) => wire.kind === 'despawn')).toHaveLength(1)
    ledger.report('spawn', { instanceId: 1, amount: SPOT_ID })
    expect(spawnsOnTheWire()).toHaveLength(1)
  })

  it('refuses a press for a spawn point this scene does not have', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner)

    await ask('n1', '0xa1', stableId('nowhere'))

    expect(replies()[0].ok).toBe(false)
    expect(spawnsOnTheWire()).toHaveLength(0)
  })

  it('rate limits one wallet without throttling the server against itself', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 5 })

    await ask('n1', WALLET)
    await ask('n2', WALLET)
    expect(replies()[1].ok).toBe(false)
    expect(spawnsOnTheWire()).toHaveLength(1)

    // the drip and the scene-load spawn come through here, and share the one
    // 'server' bucket every server-side report shares — limiting them would be
    // the server throttling itself
    handle?.request()
    handle?.request()
    expect(spawnsOnTheWire()).toHaveLength(3)
  })

  it('never materialises a copy — serve() delivers to the server too', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })
    const before = transform().entities.size

    await ask('n1', '0xa1')
    host.tick()

    expect(handle?.alive()).toEqual([])
    expect(transform().entities.size).toBe(before)
  })

  it('removes a copy on request, and ignores a prefab name it never opened', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 3 })
    await ask('n1', '0xa1')
    await ask('n2', '0xa2')

    // the key arrives off the wire, so a made-up one must not open a ledger
    deliver(
      'spawnBus.rpc.req',
      { id: 'r-junk', method: 'retire', body: JSON.stringify({ key: 'not-a-prefab', instance: 2 }) },
      { from: '0xb1' }
    )
    await settle()
    expect(broadcasts().filter((wire) => wire.kind === 'despawn')).toHaveLength(0)

    deliver(
      'spawnBus.rpc.req',
      { id: 'r-real', method: 'retire', body: JSON.stringify({ key: PREFAB, instance: 2 }) },
      { from: '0xb2' }
    )
    await settle()
    expect(broadcasts().filter((wire) => wire.kind === 'despawn').map((wire) => wire.instanceId)).toEqual([2])
  })

  it('removes a copy once its lifetime is up, on the server clock', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 3, lifetimeS: 10 })

    await ask('n1', '0xa1')
    host.tick()
    expect(broadcasts().filter((wire) => wire.kind === 'despawn')).toHaveLength(0)

    clock += 11_000
    host.tick()
    expect(broadcasts().filter((wire) => wire.kind === 'despawn').map((wire) => wire.instanceId)).toEqual([1])
  })

  it('holds every press until it has read back what it already spawned', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    // no settle(): restore() has not resolved, so nothing is ready yet
    const handle = bus.spawnSpot(SPOT_NAME, {
      pool: spawner.pool(PREFAB, 'seeded'),
      spot: makeSpot({ x: 0, y: 0, z: 0 }),
      atMostAtOnce: 2,
      lifetimeS: 0
    })
    expect(handle?.ready()).toBe(false)
    await ask('n1', '0xa1')
    expect(replies()[0].ok).toBe(false)
    expect(String(replies()[0].reason)).toContain('waking')

    await settle()
    expect(handle?.ready()).toBe(true)
  })
})

describe('a server that restarts', () => {
  async function firstRun(): Promise<void> {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner, { atMostAtOnce: 3 })
    await ask('n1', '0xa1')
    await ask('n2', '0xa2')
    // the sweep is what checkpoints the store
    host.tick()
    await settle()
  }

  it('carries its numbering forward instead of handing out ids that already existed', async () => {
    await firstRun()
    expect(spawnsOnTheWire().map((wire) => wire.instanceId)).toEqual([1, 2])

    host.reset()
    vi.resetModules()
    for (const key of GLOBAL_KEYS) delete (globalThis as unknown as Record<string, unknown>)[key]
    host.setServer(true)
    const restarted = await load()
    registerPrefab(restarted.spawner)
    await openSpot(restarted.bus, restarted.spawner, { atMostAtOnce: 3 })

    // reset() emptied the wire with the old process, so this is everything the
    // restarted one has said: the next copy is #3, not a second #1 — which would
    // be refused as a resurrection and never appear for anyone.
    await ask('n3', '0xa3')
    expect(spawnsOnTheWire().map((wire) => wire.instanceId)).toEqual([3])
  })

  it('continues the ledger sequence, so a client still holding seq 2 is not deaf to it', async () => {
    await firstRun()
    const lastSeqBefore = broadcasts()[broadcasts().length - 1].seq

    host.reset()
    vi.resetModules()
    for (const key of GLOBAL_KEYS) delete (globalThis as unknown as Record<string, unknown>)[key]
    host.setServer(true)
    const restarted = await load()
    registerPrefab(restarted.spawner)
    await openSpot(restarted.bus, restarted.spawner, { atMostAtOnce: 3 })

    // the boot marker is appended AND broadcast: a client that never disconnected
    // sees the jump, asks for the gap, and lands on the restored alive set
    const afterRestart = broadcasts()
    expect(afterRestart).toHaveLength(1)
    expect(afterRestart[0].kind).toBe('spawnRestart')
    expect(afterRestart[0].seq).toBeGreaterThan(lastSeqBefore)
  })

  it('restarts blind when the store is unreadable, far ahead of any sequence a client holds', async () => {
    await firstRun()
    const lastSeqBefore = broadcasts()[broadcasts().length - 1].seq

    host.reset()
    vi.resetModules()
    for (const key of GLOBAL_KEYS) delete (globalThis as unknown as Record<string, unknown>)[key]
    host.storageBroken = true
    host.setServer(true)
    const restarted = await load()
    registerPrefab(restarted.spawner)
    const handle = await openSpot(restarted.bus, restarted.spawner, { atMostAtOnce: 3 })

    // A blind server still answers — silence would leave every client "waking"
    // forever — and its restart marker lands far past anything a survivor holds,
    // so the jump reads as an ordinary restart gap instead of already-seen noise.
    expect(handle?.ready()).toBe(true)
    const marker = broadcasts().find((wire) => wire.kind === 'spawnRestart')
    expect(marker).toBeDefined()
    expect(Number(marker?.seq)).toBeGreaterThan(1_000_000)
    expect(Number(marker?.seq)).toBeGreaterThan(lastSeqBefore)

    await ask('n9', '0xa9')
    expect(spawnsOnTheWire().map((wire) => wire.instanceId)).toEqual([1])
  })

  it('still knows how many copies are out, so the cap holds across the restart', async () => {
    await firstRun()

    host.reset()
    vi.resetModules()
    for (const key of GLOBAL_KEYS) delete (globalThis as unknown as Record<string, unknown>)[key]
    host.setServer(true)
    const restarted = await load()
    registerPrefab(restarted.spawner)
    await openSpot(restarted.bus, restarted.spawner, { atMostAtOnce: 2 })

    await ask('n3', '0xa3')
    expect(spawnsOnTheWire()).toHaveLength(0)
    expect(String(replies()[0].reason)).toContain('as many copies as it allows')
  })
})

// --- the client -------------------------------------------------------------

describe('a client showing what the room decided', () => {
  it('materialises the alive set and not the copies the room already retired', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })

    await answerWalk([entry(1, 1, 'spawn'), entry(2, 2, 'spawn'), entry(3, 1, 'despawn')])
    host.tick()

    expect(handle?.alive()).toHaveLength(1)
    expect(spawner.pool(PREFAB, 'seeded').alive()).toHaveLength(1)
  })

  it('holds materialisation until the walk lands, but folds what arrives meanwhile', async () => {
    // The catch-up walk replays through the same handler and flips isSynced() only
    // after its last page, so a handler that ignored entries until synced would
    // drop exactly the history it was waiting for.
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })

    pushBroadcast([entry(1, 7, 'spawn')])
    host.tick()
    expect(handle?.alive()).toEqual([])

    await answerWalk([entry(1, 7, 'spawn')])
    host.tick()
    expect(handle?.alive()).toHaveLength(1)
  })

  it('rebuilds its alive set when the sequence jumps past it', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })

    await answerWalk([entry(1, 5, 'spawn')])
    host.tick()
    expect(handle?.alive()).toHaveLength(1)

    // a restarted server: its numbering resumes far ahead, and what this client
    // holds is no longer a prefix of the truth
    pushBroadcast([entry(900, 9, 'spawn')])
    await answerWalk([entry(898, 0, 'spawnRestart'), entry(899, 11, 'spawn'), entry(900, 9, 'spawn')], 898)
    host.tick()

    expect(handle?.alive()).toHaveLength(2)
    expect(spawner.pool(PREFAB, 'seeded').alive()).toHaveLength(2)
  })

  it('puts a copy at the spawn point, scattered by its own id', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const spot = makeSpot({ x: 10, y: 1, z: 20 })
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3, scatterRadius: 4, spot })

    await answerWalk([entry(1, 3, 'spawn')])
    host.tick()

    const clone = handle?.alive()[0] as number
    const placed = transform().getOrNull(clone) as { position: { x: number; y: number; z: number } }
    const offset = scatterOffset(3, 4)
    expect(placed.position.y).toBeCloseTo(1)
    expect(placed.position.x).toBeCloseTo(10 + offset.x)
    expect(placed.position.z).toBeCloseTo(20 + offset.z)
  })

  it("keeps the prefab's own scale even when the spawn point is scaled", async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    spawner.registerSpawnables([
      {
        prefab: PREFAB,
        alias: 'Crate',
        max: 8,
        instancing: 'onDemand',
        entities: [
          {
            localId: 1,
            parent: null,
            components: [
              {
                name: 'core::Transform',
                json: {
                  position: { x: 0, y: 0, z: 0 },
                  rotation: { x: 0, y: 0, z: 0, w: 1 },
                  scale: { x: 2, y: 2, z: 2 }
                }
              }
            ]
          }
        ],
        scripts: []
      }
    ])
    const spot = host.engine.addEntity()
    transform().createOrReplace(spot, {
      position: { x: 10, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 0.1, y: 0.1, z: 0.1 }
    })
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 1, spot })

    await answerWalk([entry(1, 9, 'spawn')])
    host.tick()

    const placed = transform().getOrNull(handle?.alive()[0] as number) as {
      position: { x: number; y: number; z: number }
      scale: { x: number; y: number; z: number }
    }
    expect(placed.position).toEqual({ x: 10, y: 0, z: 10 })
    expect(placed.scale).toEqual({ x: 2, y: 2, z: 2 })
  })

  it('spawns at the point a nested spawner actually stands at, not at its local offset', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const parent = makeSpot({ x: 100, y: 0, z: 0 })
    const spot = makeSpot({ x: 5, y: 2, z: 0 }, parent)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 1, spot })

    await answerWalk([entry(1, 4, 'spawn')])
    host.tick()

    const placed = transform().getOrNull(handle?.alive()[0] as number) as {
      position: { x: number; y: number; z: number }
    }
    expect(placed.position).toEqual({ x: 105, y: 2, z: 0 })
  })

  it('asks over rpc rather than writing to the ledger itself', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })
    await answerWalk([])
    heartbeat()
    expect(handle?.ready()).toBe(true)

    bus.requestSpawn(SPOT_NAME)
    const asked = host.sent.filter((message) => message.name === 'spawnBus.rpc.req')
    expect(asked).toHaveLength(1)
    const body = JSON.parse(String(asked[0].payload.body)) as { spot: number; nonce: string }
    expect(body.spot).toBe(SPOT_ID)
    expect(body.nonce.length).toBeGreaterThan(0)
  })

  it('asks the server to remove a copy rather than removing it on its own', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })
    await answerWalk([entry(1, 6, 'spawn')])
    host.tick()

    bus.retireSpawned(handle?.alive()[0] as number)

    const asked = host.sent.filter((message) => message.name === 'spawnBus.rpc.req')
    expect(asked).toHaveLength(1)
    expect(JSON.parse(String(asked[0].payload.body))).toEqual({ key: PREFAB, instance: 6 })
    // still on screen: it goes when the server says so, for everyone at once
    expect(handle?.alive()).toHaveLength(1)
  })

  it('says so, once, when a press lands before the game server is awake', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const handle = await openSpot(bus, spawner, { atMostAtOnce: 3 })

    handle?.request()
    handle?.request()

    expect(host.sent.filter((message) => message.name === 'spawnBus.rpc.req')).toHaveLength(0)
    expect(logged.filter((line) => line.includes('still waking up'))).toHaveLength(1)
  })

  it('names the spawn points it has when a script asks for one it does not', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner)

    bus.requestSpawn('Crate Spawner 2')

    expect(logged.some((line) => line.includes('Crate Spawner 2') && line.includes(SPOT_NAME))).toBe(true)
  })
})

// --- registration -----------------------------------------------------------

describe('registering a spawn point', () => {
  it('stands down for an entity with no name rather than sharing one id with every other', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)

    const handle = bus.spawnSpot('   ', {
      pool: spawner.pool(PREFAB, 'seeded'),
      spot: makeSpot({ x: 0, y: 0, z: 0 }),
      atMostAtOnce: 1,
      lifetimeS: 0
    })

    expect(handle).toBeNull()
    expect(logged.some((line) => line.includes('needs a name'))).toBe(true)
  })

  it('stands down inside a copy this scene spawns, where its name is a clone of a name', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    const cloneRoot = makeSpot({ x: 0, y: 0, z: 0 })
    const marker = host.components.get('runtime::SpawnedFrom') as FakeComponent
    marker.createOrReplace(cloneRoot, { prefab: PREFAB, instanceId: 1 })

    const handle = bus.spawnSpot(SPOT_NAME, {
      pool: spawner.pool(PREFAB, 'seeded'),
      spot: makeSpot({ x: 0, y: 1, z: 0 }, cloneRoot),
      atMostAtOnce: 1,
      lifetimeS: 0
    })

    expect(handle).toBeNull()
    expect(logged.some((line) => line.includes('sits inside a copy this scene spawns'))).toBe(true)
  })

  it('refuses a second spawn point with the same name, and says which', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner)

    const second = bus.spawnSpot(SPOT_NAME, {
      pool: spawner.pool(PREFAB, 'seeded'),
      spot: makeSpot({ x: 1, y: 0, z: 1 }),
      atMostAtOnce: 1,
      lifetimeS: 0
    })

    expect(second).toBeNull()
    expect(logged.some((line) => line.includes('both named'))).toBe(true)
    expect(bus.spotNames()).toEqual([SPOT_NAME])
  })

  it('clamps how many copies it holds to what the prefab allows, and says so', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner, 2)
    await openSpot(bus, spawner, { atMostAtOnce: 5 })

    expect(logged.some((line) => line.includes('asks for 5 copies at once') && line.includes('using 2'))).toBe(true)

    await ask('n1', '0xa1')
    await ask('n2', '0xa2')
    await ask('n3', '0xa3')
    expect(spawnsOnTheWire()).toHaveLength(2)
  })

  it('is one bus across two carried copies of this file', async () => {
    host.setServer(false)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner)

    vi.resetModules()
    const second = await vi.importActual<BusModule>('../runtime-modules/spawnBus')
    expect(second).not.toBe(bus)
    expect(second.spotNames()).toEqual([SPOT_NAME])
  })

  it('installs one sweep, whichever side it is on', async () => {
    host.setServer(true)
    const { bus, spawner } = await load()
    registerPrefab(spawner)
    await openSpot(bus, spawner)
    await openSpot(bus, spawner)

    expect(host.systemNames().filter((name) => name === 'runtime-spawnbus')).toHaveLength(1)
  })
})

// --- the SDK-free half -------------------------------------------------------
// The rules that decide what every client believes: which copies are alive,
// where each one stands, and what "here" means for a spawn point nested under
// three parents. Pure modules, no engine, no mocks in play.

describe('folding the spawn ledger', () => {
  const SPOT_A = 101
  const SPOT_B = 202

  function spawned(instanceId: number, spot: number): OutcomeEntryLike {
    return { instanceId, kind: SPAWN_KIND, value: spot }
  }

  function despawned(instanceId: number, spot: number): OutcomeEntryLike {
    return { instanceId, kind: DESPAWN_KIND, value: spot }
  }

  it('is idempotent: replaying the same history twice lands on the same alive set', () => {
    const history = [spawned(1, SPOT_A), spawned(2, SPOT_A), despawned(1, SPOT_A), spawned(3, SPOT_B)]
    const once = foldEntries(history)
    const twice = foldEntries([...history, ...history])

    expect(aliveIn(once, SPOT_A)).toEqual([2])
    expect(aliveIn(twice, SPOT_A)).toEqual([2])
    expect(aliveIn(twice, SPOT_B)).toEqual([3])
    expect([...twice.everSeen].sort()).toEqual([1, 2, 3])
  })

  it('folds a snapshot and a stream to the same place — a spot may register after the walk ran', () => {
    // R-1: a spot that binds after another already drove the catch-up walk gets no
    // delivery of its own, so it folds outcomes.snapshot() instead. Both routes
    // go through the same applyEntry, so both must agree.
    const history = [spawned(4, SPOT_A), spawned(5, SPOT_A), despawned(4, SPOT_A), spawned(6, SPOT_B)]
    const streamed = emptyFold()
    for (const one of history) applyEntry(streamed, one)

    expect(alivePairs(streamed)).toEqual(alivePairs(foldEntries(history)))
    expect(alivePairs(streamed)).toEqual([
      [5, SPOT_A],
      [6, SPOT_B]
    ])
  })

  it('never lets an instance id come back from the dead', () => {
    const fold = foldEntries([spawned(7, SPOT_A), despawned(7, SPOT_A), spawned(7, SPOT_A)])
    expect(aliveIn(fold, SPOT_A)).toEqual([])
    expect(hasSeen(fold, 7)).toBe(true)
    expect(isAlive(fold, 7)).toBe(false)
  })

  it('keeps everSeen after a despawn, so the id can never be minted again', () => {
    const fold = foldEntries([spawned(8, SPOT_A)])
    expect(hasSeen(fold, 8)).toBe(true)
    applyEntry(fold, despawned(8, SPOT_A))
    expect(hasSeen(fold, 8)).toBe(true)
    expect(spotOfInstance(fold, 8)).toBe(SPOT_A)
  })

  it('treats a despawn for an id it never saw as a no-op', () => {
    const fold = foldEntries([spawned(9, SPOT_A)])
    applyEntry(fold, despawned(999, SPOT_A))

    expect(aliveIn(fold, SPOT_A)).toEqual([9])
    expect(hasSeen(fold, 999)).toBe(false)
    expect(spotOfInstance(fold, 999)).toBeNull()
  })

  it('ignores kinds that are not its own — the ledger key is shared with other consumers', () => {
    const fold = foldEntries([spawned(10, SPOT_A), { instanceId: 10, kind: 'hit', value: 12 }])
    expect(aliveCount(fold, SPOT_A)).toBe(1)
  })

  it('counts per spot, so one spot at its cap does not stop another', () => {
    const fold = foldEntries([spawned(11, SPOT_A), spawned(12, SPOT_A), spawned(13, SPOT_B)])
    expect(aliveCount(fold, SPOT_A)).toBe(2)
    expect(aliveCount(fold, SPOT_B)).toBe(1)
    expect(aliveCount(fold, 303)).toBe(0)
  })
})

describe('scattering copies around a spawn point', () => {
  it('answers the same offset for the same copy, on every client', () => {
    expect(scatterOffset(42, 3)).toEqual(scatterOffset(42, 3))
    expect(scatterOffset(42, 3)).not.toEqual(scatterOffset(43, 3))
  })

  it('stays inside the radius', () => {
    for (let instanceId = 1; instanceId <= 200; instanceId++) {
      const offset = scatterOffset(instanceId, 5)
      expect(Math.hypot(offset.x, offset.z)).toBeLessThanOrEqual(5 + 1e-9)
    }
  })

  it('spreads over the disc instead of piling up in the middle', () => {
    let outerHalf = 0
    for (let instanceId = 1; instanceId <= 400; instanceId++) {
      if (Math.hypot(scatterOffset(instanceId, 4).x, scatterOffset(instanceId, 4).z) > 4 / Math.SQRT2) outerHalf++
    }
    // half the disc's AREA lies outside r/√2, so roughly half the draws should
    expect(outerHalf).toBeGreaterThan(140)
    expect(outerHalf).toBeLessThan(260)
  })

  it('puts everything on the point when the radius is zero or nonsense', () => {
    expect(scatterOffset(7, 0)).toEqual({ x: 0, z: 0 })
    expect(scatterOffset(7, -2)).toEqual({ x: 0, z: 0 })
    expect(scatterOffset(7, Number.NaN)).toEqual({ x: 0, z: 0 })
  })

  it('spreads several copies by default, and one copy not at all', () => {
    expect(effectiveScatter(0, 1)).toBe(0)
    expect(effectiveScatter(0, 4)).toBeCloseTo(1)
    expect(effectiveScatter(0, 16)).toBeCloseTo(2)
    expect(effectiveScatter(2.5, 16)).toBe(2.5)
    expect(effectiveScatter(-1, 4)).toBeCloseTo(1)
    expect(effectiveScatter(0, Number.NaN)).toBe(0)
  })
})

describe('composing a spawn point to world space', () => {
  const identity = identityTransform()

  function local(
    position: { x: number; y: number; z: number },
    rotation = identity.rotation,
    scale = identity.scale
  ) {
    return { position, rotation, scale, parent: 0 }
  }

  function quarterTurnY() {
    const half = Math.PI / 4
    return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }
  }

  function near(value: number, expected: number): void {
    expect(Math.abs(value - expected)).toBeLessThan(1e-6)
  }

  it('answers identity for an empty chain', () => {
    expect(composeWorld([])).toEqual(identity)
  })

  it('adds translations along the chain', () => {
    const world = composeWorld([local({ x: 1, y: 0, z: 0 }), local({ x: 0, y: 2, z: 0 }), local({ x: 0, y: 0, z: 3 })])
    expect(world.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(world.scale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it("rotates a child's offset into its parent's frame", () => {
    // a parent turned 90° about Y sends the child's +X offset to -Z
    const world = composeWorld([local({ x: 0, y: 0, z: 0 }, quarterTurnY()), local({ x: 2, y: 0, z: 0 })])
    near(world.position.x, 0)
    near(world.position.z, -2)
  })

  it("scales a child's offset by its parent's scale, and multiplies the scales", () => {
    const world = composeWorld([
      local({ x: 0, y: 0, z: 0 }, identity.rotation, { x: 2, y: 2, z: 2 }),
      local({ x: 3, y: 0, z: 0 }, identity.rotation, { x: 0.5, y: 0.5, z: 0.5 })
    ])
    expect(world.position).toEqual({ x: 6, y: 0, z: 0 })
    expect(world.scale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('composes a three-deep chain of rotation, scale and offset', () => {
    const world = composeWorld([
      local({ x: 10, y: 0, z: 0 }, quarterTurnY(), { x: 2, y: 2, z: 2 }),
      local({ x: 1, y: 0, z: 0 }),
      local({ x: 0, y: 1, z: 0 })
    ])
    // the grandparent's turn sends +X to -Z, and doubles the offsets under it
    near(world.position.x, 10)
    near(world.position.y, 2)
    near(world.position.z, -2)
  })

  it('multiplies quaternions in the parent-then-child order the engine uses', () => {
    const turn = quarterTurnY()
    const halfTurn = mulQuat(turn, turn)
    const spun = rotateVec(halfTurn, { x: 1, y: 0, z: 0 })
    near(spun.x, -1)
    near(spun.z, 0)
  })
})
