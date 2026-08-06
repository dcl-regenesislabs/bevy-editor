import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Cloning, run against the real spawner instead of read as text: the thing that
// broke in the live probe — "[spawner] unknown component 'core::Billboard' —
// clones will not carry it" — is invisible to a source assertion, because the
// file was right and the SCENE was missing the component.
//
// @dcl/sdk/ecs defines every component behind a /* @__PURE__ */ call, so a scene
// whose own code never imports Billboard does not have it and the engine cannot
// answer for it by name. The generated registry now hands the definitions over
// with the snapshots; these tests pin both halves and the fallback for the
// components no registry can import (asset-packs::…, defined by their composite).
//
// The SDK is faked, as it is for the other runtime modules: a static import of
// spawner.ts would drag @dcl/sdk into this package's program, where it does not
// exist, so the module is loaded by path and typed through the shims below.

interface ChangeProbe {
  entity: number
  newValue: unknown
  senderAddress: string
}

interface FakeComponent {
  componentId: number
  componentName: string
  createOrReplace(entity: number, value?: unknown): unknown
  create(entity: number, value?: unknown): unknown
  getOrNull(entity: number): unknown
  get(entity: number): unknown
  has(entity: number): boolean
  deleteFrom(entity: number): void
  validateBeforeChange(entity: number, cb: (change: ChangeProbe) => boolean): void
  guards: Map<number, (change: ChangeProbe) => boolean>
  entities: Map<number, unknown>
}

const AUTH_SERVER = vi.hoisted(() => '0x0000000000000000000000000000000000000000')

const sdk = vi.hoisted(() => {
  const registered = new Map<string, FakeComponent>()
  const removed = new Set<number>()
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const synced: Array<{ entity: number; componentIds: number[] }> = []
  let roster: Array<{ address: string; local: boolean }> = []
  let server = false
  let nextComponentId = 1
  let nextEntity = 512

  /**
   * `inBundle: false` is the tree-shaken SDK component: a real definition the
   * registry can hand over, that the engine cannot find by name.
   */
  function defineFake(name: string, inBundle = true): FakeComponent {
    const values = new Map<number, unknown>()
    const guards = new Map<number, (change: ChangeProbe) => boolean>()
    const definition: FakeComponent = {
      componentId: nextComponentId++,
      componentName: name,
      createOrReplace: (entity: number, value: unknown = {}) => {
        values.set(entity, value)
        return value
      },
      create: (entity: number, value: unknown = {}) => {
        values.set(entity, value)
        return value
      },
      getOrNull: (entity: number) => values.get(entity) ?? null,
      get: (entity: number) => values.get(entity) ?? null,
      has: (entity: number) => values.has(entity),
      deleteFrom: (entity: number) => void values.delete(entity),
      validateBeforeChange: (entity: number, cb: (change: ChangeProbe) => boolean) => void guards.set(entity, cb),
      guards,
      entities: values
    }
    if (inBundle) registered.set(name, definition)
    return definition
  }

  const engine = {
    RootEntity: 0,
    PlayerEntity: 1,
    defineComponent: (name: string) => defineFake(name),
    getComponentOrNull: (name: string) => registered.get(name) ?? null,
    componentsIter: () => registered.values(),
    addEntity: () => nextEntity++,
    removeEntity: (entity: number) => {
      removed.add(entity)
      for (const component of registered.values()) component.entities.delete(entity)
    },
    getEntityState: (entity: number) => (removed.has(entity) ? 2 : 1),
    addSystem: (fn: (dt: number) => void, _priority: unknown, name?: string) =>
      systems.push({ fn, name: name ?? '' }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    getEntitiesWith: (definition: FakeComponent) => [...definition.entities.entries()]
  }

  function tick(dt = 1 / 30): void {
    for (const system of [...systems]) system.fn(dt)
  }

  return {
    engine,
    defineFake,
    registered,
    tick,
    synced,
    systemNames: (): string[] => systems.map((system) => system.name),
    isServer: (): boolean => server,
    setServer: (next: boolean): void => void (server = next),
    players: (): Array<{ address: string; local: boolean }> => roster,
    setPlayers: (next: Array<{ address: string; local: boolean }>): void => void (roster = next),
    noteSync: (entity: number, componentIds: number[]): void => void synced.push({ entity, componentIds })
  }
})

vi.mock('@dcl/sdk/ecs', () => ({
  engine: sdk.engine,
  EntityState: { Unknown: 0, UsedEntity: 1, Removed: 2, Reserved: 3 },
  Schemas: {
    Boolean: 'boolean',
    Int: 'int',
    Int64: 'int64',
    String: 'string',
    Map: (spec: unknown) => spec
  },
  PlayerIdentityData: sdk.defineFake('core::PlayerIdentityData'),
  // the scene always has these two: something in every bundle imports them
  Transform: sdk.defineFake('core::Transform'),
  GltfContainer: sdk.defineFake('core::GltfContainer')
}))
vi.mock('@dcl/sdk/network', () => ({
  isServer: () => sdk.isServer(),
  syncEntity: (entity: number, componentIds: number[]) => sdk.noteSync(entity, componentIds),
  registerMessages: () => ({ send: () => {}, onMessage: () => {} })
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({ AUTH_SERVER_PEER_ID: AUTH_SERVER }))
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: false } }) }))
vi.mock('@dcl/asset-packs', () => ({ getActionEvents: () => ({ emit: () => {} }) }))
// The roster the per-player pool drives off; the real module reads avatar
// entities, which is a different module's contract, not this one's.
vi.mock('../runtime-modules/playerPositions', () => ({
  playerPositions: () => sdk.players().map((player, index) => ({ ...player, entity: 100 + index, position: null }))
}))

interface SnapshotEntity {
  localId: number
  parent: number | null
  components: Array<{ name: string; json: unknown }>
}

interface ScriptSpec {
  localId: number
  path: string
  priority: number
  layout: string
  module: Record<string, unknown>
}

interface Snapshot {
  prefab: string
  alias: string
  max: number
  instancing?: 'onDemand' | 'perPlayer'
  entities: SnapshotEntity[]
  scripts: ScriptSpec[]
}

interface Pool {
  readonly max: number
  acquire(instanceId?: number, init?: Record<string, unknown>): number | null
  release(entity: number): void
  alive(): number[]
}

interface PlanEntry {
  instanceId: number
  atMs: number
  init?: Record<string, unknown>
}

interface PlannedPool extends Pool {
  sync(tuple: { seed: number; phase: number; phaseStartMs: number; configVersion: number }): void
}

interface SpawnerModule {
  registerSpawnables(snapshots: Snapshot[], components?: Record<string, unknown>): void
  pool(prefab: string, mode: 'server' | 'seeded'): Pool
  plan(prefab: string, planFn: () => PlanEntry[], opts: { outcomes: string[] }): PlannedPool
  perPlayer(prefab: string): Pool
}

let spawner: SpawnerModule

beforeAll(async () => {
  spawner = await vi.importActual<SpawnerModule>('../runtime-modules/spawner')
})

const BILLBOARD = { billboardMode: 2 }
const ANIMATOR = { states: [{ clip: 'walk', playing: true }] }
const HEALTH = { hp: 40 }

const AUTHORED: Record<string, unknown> = {
  'core::Transform': { position: { x: 1, y: 2, z: 3 } },
  'core::Billboard': BILLBOARD,
  'core::Animator': ANIMATOR,
  'asset-packs::Health': HEALTH
}

function authored(name: string): unknown {
  return AUTHORED[name] ?? { authored: name }
}

function snapshotOf(prefab: string, names: string[]): Snapshot {
  return {
    prefab,
    alias: 'Probe',
    max: 4,
    instancing: 'onDemand',
    entities: [
      { localId: 512, parent: null, components: names.map((name) => ({ name, json: authored(name) })) }
    ],
    scripts: []
  }
}

const ALL = ['core::Transform', 'core::Billboard', 'core::Animator', 'asset-packs::Health']

function valueOn(name: string, entity: number): unknown {
  return sdk.registered.get(name)?.getOrNull(entity) ?? null
}

let logged: string[] = []
let errored: string[] = []

beforeEach(() => {
  logged = []
  errored = []
  sdk.setServer(false)
  sdk.setPlayers([])
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void logged.push(String(args[0])))
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errored.push(String(args[0])))
})

/** A snapshot whose one script throws the moment the runner constructs it. */
function throwingSnapshot(prefab: string): Snapshot {
  const snapshot = snapshotOf(prefab, ['core::Transform'])
  snapshot.scripts = [
    {
      localId: 512,
      path: `custom/${prefab}/scripts/broken.ts`,
      priority: 0,
      layout: '{"params":{},"actions":[]}',
      module: {
        Broken: class {
          constructor() {
            throw new Error('bad param')
          }
        }
      }
    }
  ]
  return snapshot
}

describe('a clone carries every component the snapshot names', () => {
  it('restores the SDK components the scene bundle never defined, from the registry table', () => {
    // what a real bundle looks like: Transform is in it, Billboard and Animator
    // were tree-shaken, and the custom component came from its composite
    const billboard = sdk.defineFake('core::Billboard', false)
    const animator = sdk.defineFake('core::Animator', false)
    sdk.defineFake('asset-packs::Health')
    expect(sdk.engine.getComponentOrNull('core::Billboard')).toBeNull()

    spawner.registerSpawnables([snapshotOf('with-table', ALL)], {
      'core::Billboard': billboard,
      'core::Animator': animator
    })
    const entity = spawner.pool('with-table', 'seeded').acquire()
    expect(entity).not.toBeNull()

    expect(billboard.getOrNull(entity as number)).toEqual(BILLBOARD)
    expect(animator.getOrNull(entity as number)).toEqual(ANIMATOR)
    expect(valueOn('asset-packs::Health', entity as number)).toEqual(HEALTH)
    expect(valueOn('core::Transform', entity as number)).toMatchObject({ position: { x: 1, y: 2, z: 3 } })
    expect(logged.filter((line) => line.includes('unknown component'))).toEqual([])
  })

  it('drops one the registry did not hand over, and says so once — the wave-2 bug', () => {
    spawner.registerSpawnables([snapshotOf('no-table', ['core::Transform', 'core::Sparkle'])])
    const pool = spawner.pool('no-table', 'seeded')
    const first = pool.acquire()
    pool.release(first as number)
    pool.acquire()

    expect(valueOn('core::Sparkle', first as number)).toBeNull()
    expect(logged.filter((line) => line.includes("unknown component 'core::Sparkle'"))).toHaveLength(1)
  })

  it('picks up a custom component defined after the first clone asked for it', () => {
    spawner.registerSpawnables([snapshotOf('late', ['core::Transform', 'asset-packs::Late'])])
    const pool = spawner.pool('late', 'seeded')
    const early = pool.acquire()
    expect(valueOn('asset-packs::Late', early as number)).toBeNull()

    // a composite that loads after the first spawn — the reason a miss is never cached
    sdk.defineFake('asset-packs::Late')
    const late = pool.acquire()
    expect(valueOn('asset-packs::Late', late as number)).toEqual({ authored: 'asset-packs::Late' })
  })

  it('ignores a table entry that is not a component definition', () => {
    const sparkle = sdk.defineFake('core::Sparkle2', false)
    spawner.registerSpawnables([snapshotOf('junk', ['core::Transform', 'core::Sparkle2'])], {
      'core::Sparkle2': sparkle,
      'core::Nonsense': { componentName: 'core::Nonsense' }
    })
    const entity = spawner.pool('junk', 'seeded').acquire()
    expect(sparkle.getOrNull(entity as number)).toEqual({ authored: 'core::Sparkle2' })
  })
})

describe("a plan entry's init", () => {
  // A planned pool's init doubles as the consumer's per-instance data (the Wave
  // Director places its own clones from init.x/y/z), so the six gameplay keys of
  // one entry used to print six "unknown component" lines on the first spawn.
  it('writes the keys that name components and stays quiet about the ones that do not', () => {
    spawner.registerSpawnables([snapshotOf('planned', ['core::Transform'])])
    const pool = spawner.plan(
      'planned',
      () => [
        {
          instanceId: 1,
          atMs: 0,
          init: { 'core::Transform': { position: { x: 9, y: 0, z: 9 } }, x: 9, speedMult: 1.4, wave: 3 }
        }
      ],
      { outcomes: ['died'] }
    )
    const before = new Set(sdk.registered.get('core::Transform')?.entities.keys() ?? [])
    pool.sync({ seed: 1, phase: 1, phaseStartMs: 0, configVersion: 1 })
    sdk.tick()

    const spawned = [...(sdk.registered.get('core::Transform')?.entities.keys() ?? [])].filter(
      (entity) => !before.has(entity)
    )
    expect(spawned).toHaveLength(1)
    expect(valueOn('core::Transform', spawned[0])).toMatchObject({ position: { x: 9, y: 0, z: 9 } })
    expect(logged.filter((line) => line.includes('unknown component'))).toEqual([])
  })
})

describe("acquire()'s init", () => {
  // The spawn bus hands acquire() the spawn point's world transform. A script on
  // the clone that reads its own position in start() — a turret picking its
  // facing, a pickup remembering where it landed — has to see the place it was
  // put, not the place the snapshot was authored at.
  it("lands before the clone's scripts start", () => {
    const seen: unknown[] = []
    const snapshot = snapshotOf('init-first', ['core::Transform'])
    snapshot.scripts = [
      {
        localId: 512,
        path: 'custom/init-first/scripts/probe.ts',
        priority: 0,
        layout: '{"params":{},"actions":[]}',
        module: {
          Probe: class {
            entity: number
            constructor(_src: string, entity: number) {
              this.entity = entity
            }
            start(): void {
              seen.push(valueOn('core::Transform', this.entity))
            }
          }
        }
      }
    ]
    spawner.registerSpawnables([snapshot])
    const entity = spawner.pool('init-first', 'seeded').acquire(9, {
      'core::Transform': { position: { x: 4, y: 5, z: 6 } },
      // the caller's own per-instance data: it names no component and must not be reported
      speedMult: 2
    })

    expect(entity).not.toBeNull()
    expect(seen).toEqual([{ position: { x: 4, y: 5, z: 6 } }])
    expect(logged.filter((line) => line.includes('unknown component'))).toEqual([])
  })
})

describe("a 'server' pool's clone is actually read-only on clients", () => {
  // syncEntity on its own is last-write-wins: the SDK's change filter admits any
  // peer's write to a listed component id. Publishing a server clone with nothing
  // else made the editor's "Server-owned · read-only on clients" chip a claim the
  // runtime did not implement.
  it('arms a refusing validator on every component it syncs', () => {
    sdk.setServer(true)
    spawner.registerSpawnables([snapshotOf('owned', ['core::Transform'])])
    const entity = spawner.pool('owned', 'server').acquire()
    expect(entity).not.toBeNull()

    const wire = sdk.synced.filter((call) => call.entity === entity)
    expect(wire).toHaveLength(1)
    const guarded = ['runtime::SpawnedFrom', 'core::Transform'].map((name) => sdk.registered.get(name))
    for (const definition of guarded) {
      expect(wire[0].componentIds).toContain(definition?.componentId)
      const guard = definition?.guards.get(entity as number)
      expect(typeof guard).toBe('function')
      // the auth server writes freely; a wallet does not
      expect(guard?.({ entity: entity as number, newValue: {}, senderAddress: AUTH_SERVER })).toBe(true)
      expect(guard?.({ entity: entity as number, newValue: {}, senderAddress: '0xdeadbeef' })).toBe(false)
    }
  })
})

describe('a clone whose script throws does not take the frame down with it', () => {
  // spawn() rethrows on purpose (its cleanup path depends on it), but engine.update
  // has no try/catch: an escape aborts every later system AND the CRDT flush, so
  // one bad creator script would freeze the whole scene instead of losing one clone.
  it('contains a planned spawn that fails, and keeps the pool consistent', () => {
    spawner.registerSpawnables([throwingSnapshot('planned-bad')])
    const pool = spawner.plan('planned-bad', () => [{ instanceId: 1, atMs: 0 }], { outcomes: ['died'] })
    pool.sync({ seed: 1, phase: 1, phaseStartMs: 0, configVersion: 1 })

    expect(() => sdk.tick()).not.toThrow()
    expect(errored.some((line) => line.includes('planned spawn failed for planned-bad'))).toBe(true)
    expect(pool.alive()).toEqual([])
  })

  it('stops retrying a per-player rig that fails, instead of aborting a frame every 0.5s', () => {
    spawner.registerSpawnables([throwingSnapshot('rig-bad')])
    const pool = spawner.perPlayer('rig-bad')
    sdk.setPlayers([{ address: '0xaaa', local: true }])

    for (let i = 0; i < 6; i++) expect(() => sdk.tick(1)).not.toThrow()
    expect(pool.alive()).toEqual([])
    expect(errored.filter((line) => line.includes('per-player spawn failed for rig-bad'))).toHaveLength(1)
  })
})

describe('the planned driver is opt-in', () => {
  // The Wave Director schedules its own spawns off the same pure plan and never
  // calls sync(), so an eagerly installed driver cost it a per-frame system and a
  // real outcomes.since round trip for a ledger key it never reports on.
  it('installs nothing until a consumer hands it a tuple', () => {
    spawner.registerSpawnables([snapshotOf('lazy', ['core::Transform'])])
    const before = sdk.systemNames().filter((name) => name.startsWith('runtime-spawner-plan-lazy'))
    const pool = spawner.plan('lazy', () => [{ instanceId: 1, atMs: 0 }], { outcomes: ['died'] })
    expect(before).toEqual([])
    expect(sdk.systemNames().filter((name) => name.startsWith('runtime-spawner-plan-lazy'))).toEqual([])

    pool.sync({ seed: 1, phase: 1, phaseStartMs: 0, configVersion: 1 })
    expect(sdk.systemNames().filter((name) => name.startsWith('runtime-spawner-plan-lazy'))).toEqual([
      'runtime-spawner-plan-lazy'
    ])
  })
})
