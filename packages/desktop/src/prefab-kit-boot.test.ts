import { beforeEach, describe, expect, it, vi } from 'vitest'

// Two boot-time hazards the pure suites cannot see, both about a kit prefab's
// FIRST frames on a client:
//
//  - protectedSync creates RoundPhase with schema defaults and syncs it before the
//    server has restored anything, so the first value a client can read is an
//    all-zero tuple. Publishing it put every consumer on phaseStartMs 0.
//  - Level Slots pins one sync id for the whole scene. A second placed copy used
//    to claim the same id, and syncEntity answers that with a throw out of start().

const host = vi.hoisted(() => {
  interface Fake {
    componentId: number
    componentName: string
    values: Map<number, Record<string, unknown>>
    createOrReplace(entity: number, value?: Record<string, unknown>): void
    create(entity: number, value?: Record<string, unknown>): void
    get(entity: number): Record<string, unknown>
    getOrNull(entity: number): Record<string, unknown> | null
    getMutable(entity: number): Record<string, unknown>
    getMutableOrNull(entity: number): Record<string, unknown> | null
    has(entity: number): boolean
    validateBeforeChange(...args: unknown[]): void
  }

  const components = new Map<string, Fake>()
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const syncedIds: number[] = []
  let nextEntity = 700

  function define(name: string): Fake {
    const values = new Map<number, Record<string, unknown>>()
    const definition: Fake = {
      componentId: components.size + 1,
      componentName: name,
      values,
      createOrReplace: (entity, value = {}) => void values.set(entity, { ...value }),
      create: (entity, value = {}) => void values.set(entity, { ...value }),
      get: (entity) => values.get(entity) ?? {},
      getOrNull: (entity) => values.get(entity) ?? null,
      getMutable: (entity) => {
        const existing = values.get(entity) ?? {}
        values.set(entity, existing)
        return existing
      },
      getMutableOrNull: (entity) => values.get(entity) ?? null,
      has: (entity) => values.has(entity),
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
    removeEntity: () => {},
    getEntityState: () => 1,
    addSystem: (fn: (dt: number) => void, _priority: unknown, name?: string) =>
      systems.push({ fn, name: name ?? '' }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    getEntitiesWith: (definition: Fake) => [...definition.values.entries()]
  }

  const transform = define('core::Transform')
  const textShape = define('core::TextShape')

  return {
    engine,
    transform,
    textShape,
    components,
    syncedIds,
    // syncEntity really does throw on a reused id (@dcl/sdk/network/entities.js),
    // which is why a second Level Slots used to die instead of standing down.
    syncEntity: (_entity: number, _ids: number[], id?: number): void => {
      if (id === undefined) return
      if (syncedIds.includes(id)) throw new Error('syncEntity failed because the id provided is already in use')
      syncedIds.push(id)
    },
    reset: (): void => {
      systems.length = 0
      syncedIds.length = 0
      for (const definition of components.values()) definition.values.clear()
      nextEntity = 700
    }
  }
})

vi.mock('@dcl/sdk/ecs', () => ({
  engine: host.engine,
  Transform: host.transform,
  TextShape: host.textShape,
  GltfContainer: { getMutableOrNull: () => null },
  EntityState: { Unknown: 0, UsedEntity: 1, Removed: 2, Reserved: 3 },
  Schemas: {
    Boolean: 'boolean',
    Int: 'int',
    Int64: 'int64',
    String: 'string',
    Array: (spec: unknown) => spec,
    Map: (spec: unknown) => spec
  }
}))
vi.mock('@dcl/sdk/math', () => ({
  Vector3: { create: (x = 0, y = 0, z = 0) => ({ x, y, z }), Zero: () => ({ x: 0, y: 0, z: 0 }), One: () => ({ x: 1, y: 1, z: 1 }) },
  Quaternion: {
    create: (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w }),
    fromEulerDegrees: (x: number, y: number, z: number) => ({ x, y, z, w: 1 }),
    Identity: () => ({ x: 0, y: 0, z: 0, w: 1 })
  }
}))
vi.mock('@dcl/sdk/network', () => ({
  isServer: () => false,
  syncEntity: (entity: number, ids: number[], id?: number) => host.syncEntity(entity, ids, id),
  registerMessages: () => ({ send: () => {}, onMessage: () => {} })
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({
  AUTH_SERVER_PEER_ID: '0x0000000000000000000000000000000000000000'
}))
vi.mock('@dcl/sdk/server', () => ({ Storage: { get: async () => null, set: async () => true } }))
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: false } }) }))
vi.mock('@dcl/asset-packs', () => ({ getActionEvents: () => ({ emit: () => {} }) }))

interface Script {
  start(): void
  update(dt: number): void
}

interface RoundLoopModule {
  RoundLoop: new (
    src: string,
    entity: number,
    lobbySeconds?: number,
    waveSeconds?: number,
    intermissionSeconds?: number,
    minPlayers?: number,
    soloMode?: boolean
  ) => Script
}

interface LevelSlotsModule {
  LevelSlots: new (src: string, entity: number, slotCount?: number, arenas?: string[]) => Script
}

const TUPLE_KEY = '__dclRoundTuple_v1'
const PHASE_COMPONENT = 'runtime::RoundPhase'

function globals(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>
}

let logged: string[] = []

beforeEach(() => {
  host.reset()
  vi.resetModules()
  logged = []
  for (const key of ['__dclRoundLoop_v1', '__dclServerLife_v1', '__dclProtectedSync_v1', '__dclLevelSlots_v1', '__dclSpawner_v1', TUPLE_KEY]) {
    delete globals()[key]
  }
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(String(args[0])))
})

describe('the Round Loop does not publish the placeholder tuple', () => {
  async function boot(): Promise<Script> {
    const module = await vi.importActual<RoundLoopModule>('../prefabs/round-loop/scripts/round-loop')
    return new module.RoundLoop('custom/round_loop/scripts', 4)
  }

  it('stays quiet while the synced component is still all zeros', async () => {
    const loop = await boot()
    loop.start()
    // what protectedSync's component.create() leaves on the wire before restore()
    host.components.get(PHASE_COMPONENT)?.create(900, {
      seed: 0,
      phase: 0,
      phaseStartMs: 0,
      configVersion: 0,
      parked: false,
      present: 0
    })
    loop.update(1)

    expect(globals()[TUPLE_KEY]).toBeUndefined()
    // and no countdown built on it: never "LOBBY 0:00" off a phase start of zero
    expect(String(host.textShape.get(4).text)).toContain('--:--')
  })

  it('publishes as soon as the server has written a real phase start', async () => {
    const loop = await boot()
    loop.start()
    host.components.get(PHASE_COMPONENT)?.create(900, {
      seed: 42,
      phase: 1,
      phaseStartMs: Date.now(),
      configVersion: 3,
      parked: false,
      present: 2
    })
    loop.update(1)

    expect(globals()[TUPLE_KEY]).toMatchObject({ seed: 42, phase: 1, configVersion: 3 })
  })
})

describe('a second Level Slots stands down instead of dying', () => {
  async function boot(): Promise<LevelSlotsModule> {
    return await vi.importActual<LevelSlotsModule>('../prefabs/level-slots/scripts/level-slots')
  }

  it('claims the shared sync id once and names the fix for the second copy', async () => {
    const { LevelSlots } = await boot()
    const first = new LevelSlots('custom/level_slots/scripts', 10, 1, [])
    const second = new LevelSlots('custom/level_slots/scripts', 11, 1, [])

    first.start()
    expect(() => second.start()).not.toThrow()
    expect(host.syncedIds).toEqual([8020])
    expect(logged.some((line) => line.includes('a second Level Slots is placed'))).toBe(true)

    // and it stays out of the way afterwards
    expect(() => second.update(1)).not.toThrow()
  })
})
