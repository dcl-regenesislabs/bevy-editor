import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Wave Director run as a script, not read as text: the three things that go
// wrong here are all about WHEN it spawns, and none of them are visible to the
// pure-module suite next door.
//
//  - A Round Loop counts lobby (0), waves (odd) and intermissions (even) on one
//    phase counter. Indexing the wave table by the raw phase spawned a full wave
//    into the lobby players were still waiting in, and again at every intermission.
//  - phaseStartMs is not part of the plan's identity, so a held lobby that rebases
//    it left two clients holding schedules minutes apart for the same phase.
//  - A joiner's dead-set arrives one rpc round trip after start(), so spawning
//    immediately materialised every clone the room had already killed.
//
// The SDK and the ledger are faked; the plan, the pool and the director are real.

const host = vi.hoisted(() => {
  interface Fake {
    componentId: number
    componentName: string
    values: Map<number, Record<string, unknown>>
    createOrReplace(entity: number, value?: Record<string, unknown>): void
    create(entity: number, value?: Record<string, unknown>): void
    get(entity: number): Record<string, unknown> | null
    getOrNull(entity: number): Record<string, unknown> | null
    getMutable(entity: number): Record<string, unknown>
    getMutableOrNull(entity: number): Record<string, unknown> | null
    has(entity: number): boolean
    deleteFrom(entity: number): void
    validateBeforeChange(...args: unknown[]): void
  }

  const components = new Map<string, Fake>()
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const removed = new Set<number>()
  let nextEntity = 512

  function define(name: string): Fake {
    const values = new Map<number, Record<string, unknown>>()
    const definition: Fake = {
      componentId: components.size + 1,
      componentName: name,
      values,
      createOrReplace: (entity, value = {}) => void values.set(entity, { ...value }),
      create: (entity, value = {}) => void values.set(entity, { ...value }),
      get: (entity) => values.get(entity) ?? null,
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
    defineComponent: (name: string) => define(name),
    getComponentOrNull: (name: string) => components.get(name) ?? null,
    componentsIter: () => components.values(),
    addEntity: () => nextEntity++,
    removeEntity: (entity: number) => {
      removed.add(entity)
      for (const definition of components.values()) definition.values.delete(entity)
    },
    getEntityState: (entity: number) => (removed.has(entity) ? 2 : 1),
    addSystem: (fn: (dt: number) => void, _priority: unknown, name?: string) =>
      systems.push({ fn, name: name ?? '' }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    getEntitiesWith: (definition: Fake) => [...definition.values.entries()]
  }

  const transform = define('core::Transform')

  return {
    engine,
    transform,
    components,
    tick: (dt = 0.2): void => {
      for (const system of [...systems]) system.fn(dt)
    },
    reset: (): void => {
      systems.length = 0
      removed.clear()
      for (const definition of components.values()) definition.values.clear()
      nextEntity = 512
    }
  }
})

// The ledger is faked so the catch-up walk is something this test can hold open
// and release on purpose — over a real rpc it is a promise that never settles here.
const ledger = vi.hoisted(() => {
  let caughtUp = true
  const handlers: Array<(entry: { seq: number; instanceId: number; kind: string; value: number }) => void> = []
  return {
    setSynced: (next: boolean): void => void (caughtUp = next),
    handlers,
    api: {
      report: () => {},
      validate: () => {},
      onOutcome: (handler: (entry: { seq: number; instanceId: number; kind: string; value: number }) => void) => {
        handlers.push(handler)
        return () => {}
      },
      snapshot: () => [],
      fastForward: () => {},
      isSynced: () => caughtUp
    },
    reset: (): void => {
      caughtUp = true
      handlers.length = 0
    }
  }
})

vi.mock('@dcl/sdk/ecs', () => ({
  engine: host.engine,
  Transform: host.transform,
  GltfContainer: { getMutableOrNull: () => null },
  EntityState: { Unknown: 0, UsedEntity: 1, Removed: 2, Reserved: 3 },
  Schemas: {
    Boolean: 'boolean',
    Int: 'int',
    Int64: 'int64',
    String: 'string',
    Map: (spec: unknown) => spec
  }
}))
vi.mock('@dcl/sdk/math', () => ({
  Vector3: {
    create: (x = 0, y = 0, z = 0) => ({ x, y, z }),
    Zero: () => ({ x: 0, y: 0, z: 0 })
  },
  Quaternion: {
    fromEulerDegrees: (x: number, y: number, z: number) => ({ x, y, z, w: 1 }),
    Identity: () => ({ x: 0, y: 0, z: 0, w: 1 })
  }
}))
vi.mock('@dcl/sdk/network', () => ({
  isServer: () => false,
  syncEntity: () => {},
  registerMessages: () => ({ send: () => {}, onMessage: () => {} })
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({
  AUTH_SERVER_PEER_ID: '0x0000000000000000000000000000000000000000'
}))
vi.mock('@dcl/sdk/server', () => ({ Storage: { get: async () => null, set: async () => true } }))
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: false } }) }))
vi.mock('@dcl/asset-packs', () => ({ getActionEvents: () => ({ emit: () => {} }) }))
vi.mock('../prefabs/wave-director/scripts/runtime/outcomes', () => ({ outcomes: () => ledger.api }))

const ZOMBIE = 'zombie-prefab-id'
const TUPLE_KEY = '__dclRoundTuple_v1'

interface Director {
  start(): void
  update(dt: number): void
}

interface DirectorModule {
  WaveDirector: new (src: string, entity: number, zombie: string, wavesTable: string) => Director
}

interface SpawnerModule {
  registerSpawnables(snapshots: unknown[], components?: Record<string, unknown>): void
  poolFor(prefab: string): { alive(): number[] } | null
}

interface View {
  wave: number
  planned: number
  alive: number
}

function globals(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>
}

function publishTuple(phase: number, phaseStartMs: number): void {
  globals()[TUPLE_KEY] = { seed: 7, phase, phaseStartMs, configVersion: 1 }
}

function view(): View {
  return globals().__dclWaveDirector_v1 as View
}

async function boot(): Promise<{ director: Director; spawner: SpawnerModule }> {
  const spawner = await vi.importActual<SpawnerModule>('../prefabs/wave-director/scripts/runtime/spawner')
  spawner.registerSpawnables([
    {
      prefab: ZOMBIE,
      alias: 'ZombieBasic',
      max: 64,
      instancing: 'onDemand',
      entities: [{ localId: 512, parent: null, components: [{ name: 'core::Transform', json: {} }] }],
      scripts: []
    }
  ])
  const module = await vi.importActual<DirectorModule>('../prefabs/wave-director/scripts/wave-director')
  return { director: new module.WaveDirector('custom/wave_director/scripts', 4 as number, ZOMBIE, 'waves'), spawner }
}

function aliveCount(spawner: SpawnerModule): number {
  return spawner.poolFor(ZOMBIE)?.alive().length ?? 0
}

beforeEach(() => {
  host.reset()
  ledger.reset()
  vi.resetModules()
  for (const key of ['__dclSpawner_v1', '__dclServerLife_v1', '__dclProtectedSync_v1', TUPLE_KEY, '__dclWaveDirector_v1']) {
    delete globals()[key]
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('a Round Loop phase is not automatically a wave', () => {
  it('spawns nothing while the round is still in the lobby', async () => {
    publishTuple(0, Date.now() - 10_000)
    const { director, spawner } = await boot()
    director.start()
    director.update(1)
    expect(aliveCount(spawner)).toBe(0)
    expect(view().planned).toBe(0)
    expect(view().wave).toBe(0)
  })

  it('spawns nothing during an intermission', async () => {
    publishTuple(2, Date.now() - 10_000)
    const { director, spawner } = await boot()
    director.start()
    director.update(1)
    expect(aliveCount(spawner)).toBe(0)
    expect(view().wave).toBe(0)
  })

  it('runs wave 1 on phase 1 and wave 2 on phase 3', async () => {
    publishTuple(1, Date.now() - 10_000)
    const { director, spawner } = await boot()
    director.start()
    expect(view().wave).toBe(1)
    expect(aliveCount(spawner)).toBeGreaterThan(0)

    publishTuple(3, Date.now() - 10_000)
    director.update(1)
    expect(view().wave).toBe(2)
  })

  it('still treats every free-running phase as a wave without a Round Loop', async () => {
    const { director, spawner } = await boot()
    director.start()
    director.update(1)
    expect(aliveCount(spawner)).toBeGreaterThan(0)
    expect(view().wave).toBeGreaterThan(0)
  })
})

describe('the plan is re-timed when the phase start moves', () => {
  it('follows a rebased lobby without dropping the wave it is already running', async () => {
    const start = Date.now() - 10_000
    publishTuple(1, start)
    const { director, spawner } = await boot()
    director.start()
    const spawned = aliveCount(spawner)
    expect(spawned).toBeGreaterThan(0)
    expect(view().planned).toBeGreaterThan(0)

    // same phase, same seed, a start pushed into the future: nothing is due now
    publishTuple(1, Date.now() + 60_000)
    director.update(1)
    expect(view().planned).toBeGreaterThan(0)
    expect(view().alive).toBe(0)
    // live clones are not dropped by a re-time — only a real phase change does that
    expect(aliveCount(spawner)).toBe(spawned)
  })
})

describe('a joiner waits for the ledger before materialising a wave', () => {
  it('holds back while the catch-up walk is still in flight', async () => {
    ledger.setSynced(false)
    publishTuple(1, Date.now() - 10_000)
    const { director, spawner } = await boot()
    director.start()
    director.update(1)
    expect(view().planned).toBeGreaterThan(0)
    expect(aliveCount(spawner)).toBe(0)

    ledger.setSynced(true)
    director.update(1)
    expect(aliveCount(spawner)).toBeGreaterThan(0)
  })

  it('does not spawn the instances the walk reports dead', async () => {
    ledger.setSynced(false)
    publishTuple(1, Date.now() - 10_000)
    const { director, spawner } = await boot()
    director.start()
    director.update(1)

    const planned = view().planned
    for (let index = 0; index < planned; index++) {
      for (const handler of ledger.handlers) {
        handler({ seq: index + 1, instanceId: 1024 + index, kind: 'hit', value: 0 })
      }
    }
    ledger.setSynced(true)
    director.update(1)
    expect(aliveCount(spawner)).toBe(0)
    expect(view().alive).toBe(0)
  })
})
