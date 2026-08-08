import { beforeEach, describe, expect, it, vi } from 'vitest'
import { layoutSeed } from '../runtime-modules/pure/gameCore'
import { createRng } from '../runtime-modules/pure/rng'

// The SDK-facing half of the `game` module, tested the way the scene runs it:
// a MUTABLE isServer (false at module load, truthful at the first tick) and a
// second module instance via vi.resetModules() — which is precisely what a
// second carried prefab copy is, sharing only globalThis. The pure rules
// (direction, FIFO, guards, boot order) are covered by game-harness.test.ts;
// this suite covers only what game.ts owns: the singleton, exactly-once schema
// registration, the lazy role fork, SharedFact wiring, and the tell envelope.

const host = vi.hoisted(() => {
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const registered: string[] = []
  const subs = new Map<string, Array<(value: unknown, context?: { from: string }) => void>>()
  const sent: Array<{ name: string; value: unknown; opts?: unknown }> = []
  const synced: Array<{ entity: number; componentIds: number[]; syncId: number | undefined }> = []
  const components = new Map<string, FakeComponent>()
  const pointer: Array<{ entity: number; fn: () => void }> = []
  let server = false
  let nextEntity = 900

  interface FakeComponent {
    componentId: number
    componentName: string
    values: Map<number, Record<string, unknown>>
    guards: Map<number, (change: { entity: number; newValue: unknown; senderAddress: string }) => boolean>
    create(entity: number, value?: Record<string, unknown>): void
    createOrReplace(entity: number, value?: Record<string, unknown>): void
    get(entity: number): Record<string, unknown>
    getOrNull(entity: number): Record<string, unknown> | null
    getMutable(entity: number): Record<string, unknown>
    getMutableOrNull(entity: number): Record<string, unknown> | null
    has(entity: number): boolean
    validateBeforeChange(...args: unknown[]): void
    globalGuard?: (change: { entity: number; newValue: unknown; senderAddress: string }) => boolean
  }

  function define(name: string): FakeComponent {
    const values = new Map<number, Record<string, unknown>>()
    const guards = new Map<number, (change: { entity: number; newValue: unknown; senderAddress: string }) => boolean>()
    const definition: FakeComponent = {
      componentId: components.size + 1,
      componentName: name,
      values,
      guards,
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
      validateBeforeChange: (...args: unknown[]) => {
        // two real overloads, and BOTH must be recorded: the per-entity form
        // (entity, cb) guards entities this run created; the component-global
        // form (cb) is the only thing covering an entity the SDK mints for an
        // id it has never seen — which is how a forged fact would arrive
        if (typeof args[0] === 'number' && typeof args[1] === 'function') {
          guards.set(
            args[0],
            args[1] as (change: { entity: number; newValue: unknown; senderAddress: string }) => boolean
          )
        } else if (typeof args[0] === 'function') {
          definition.globalGuard = args[0] as (change: {
            entity: number
            newValue: unknown
            senderAddress: string
          }) => boolean
        }
      }
    }
    components.set(name, definition)
    return definition
  }

  const engine = {
    PlayerEntity: 1,
    defineComponent: (name: string) => define(name),
    getComponentOrNull: (name: string) => components.get(name) ?? null,
    getEntityState: () => 0,
    addEntity: () => ++nextEntity,
    removeEntity: (entity: number) => {
      for (const definition of components.values()) definition.values.delete(entity)
    },
    addSystem: (fn: (dt: number) => void, _priority: unknown, name: string) => systems.push({ fn, name }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    getEntitiesWith: (first: FakeComponent, ...rest: FakeComponent[]) =>
      [...first.values.entries()]
        .filter(([entity]) => rest.every((definition) => definition.values.has(entity)))
        .map(([entity, value]) => [entity, value, ...rest.map((definition) => definition.values.get(entity))])
  }

  // The SDK's predefined components: their module exports must survive reset,
  // so only their contents are cleared and they re-register by name.
  const identity = define('PlayerIdentityData')
  const transform = define('core::Transform')
  const triggerArea = define('core::TriggerArea')
  const persistent = [identity, transform, triggerArea]

  const storage = { world: new Map<string, unknown>(), players: new Map<string, unknown>() }

  return {
    engine,
    systems,
    registered,
    subs,
    sent,
    synced,
    components,
    pointer,
    identity,
    transform,
    triggerArea,
    storage,
    isServer: (): boolean => server,
    setServer: (next: boolean): void => void (server = next),
    tick: (dt = 1 / 30): void => {
      for (const system of [...systems]) system.fn(dt)
    },
    deliver: (name: string, value: unknown, context?: { from: string }): void => {
      for (const cb of subs.get(name) ?? []) cb(value, context)
    },
    room: () => ({
      send: (name: string, value: unknown, opts?: unknown) => void sent.push({ name, value, opts }),
      onMessage: (name: string, cb: (value: unknown, context?: { from: string }) => void) => {
        const list = subs.get(name) ?? []
        list.push(cb)
        subs.set(name, list)
      }
    }),
    reset: (): void => {
      systems.length = 0
      registered.length = 0
      subs.clear()
      sent.length = 0
      synced.length = 0
      components.clear()
      pointer.length = 0
      storage.world.clear()
      storage.players.clear()
      server = false
      nextEntity = 900
      for (const definition of persistent) {
        definition.values.clear()
        definition.guards.clear()
        components.set(definition.componentName, definition)
      }
    }
  }
})

vi.mock('@dcl/asset-packs', () => ({ getActionEvents: () => ({ emit: () => {} }) }))
vi.mock('@dcl/sdk/ecs', () => ({
  engine: host.engine,
  EntityState: { Removed: 2 },
  GltfContainer: { getMutableOrNull: () => null },
  PlayerIdentityData: {
    ...host.identity,
    getOrNull: (entity: number) =>
      entity === host.engine.PlayerEntity ? { address: '0xAda' } : host.identity.getOrNull(entity)
  },
  Transform: host.transform,
  TriggerArea: host.triggerArea,
  pointerEventsSystem: {
    onPointerDown: (spec: { entity: number }, fn: () => void) => void host.pointer.push({ entity: spec.entity, fn })
  },
  InputAction: { IA_POINTER: 1 },
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
    add: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
      x: a.x + b.x,
      y: a.y + b.y,
      z: a.z + b.z
    }),
    // tests place zones and avatars unrotated at the scene root
    rotate: (v: { x: number; y: number; z: number }) => ({ ...v })
  }
}))
vi.mock('@dcl/sdk/network', () => ({
  isServer: () => host.isServer(),
  syncEntity: (entity: number, componentIds: number[], syncId?: number) =>
    void host.synced.push({ entity, componentIds, syncId }),
  registerMessages: (schemas: Record<string, unknown>) => {
    host.registered.push(...Object.keys(schemas))
    return host.room()
  }
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({
  AUTH_SERVER_PEER_ID: '0x0000000000000000000000000000000000000000'
}))
vi.mock('@dcl/sdk/server', () => ({
  Storage: {
    get: async (key: string) => host.storage.world.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      host.storage.world.set(key, value)
      return true
    },
    player: {
      get: async (address: string, key: string) => host.storage.players.get(`${address}|${key}`) ?? null,
      set: async (address: string, key: string, value: unknown) => {
        host.storage.players.set(`${address}|${key}`, value)
        return true
      }
    }
  }
}))
// Preview is the realm the editor plays in, and the realm the ladder line the
// Game strip reads is gated on.
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: true } }) }))

interface GameModule {
  game: {
    onStart(fn: () => void | Promise<void>): void
    readonly state: Record<string, unknown>
    setState(patch: Record<string, unknown>): void
    send(name: string, data?: unknown, opts?: { to?: string }): Promise<unknown>
    onMessage(name: string, fn: (data: unknown, player: string) => unknown): void
    now(): number
    playerData(player: string): { get(): Record<string, unknown>; set(patch: Record<string, unknown>): void }
    onPlayerJoin(fn: (player: string) => void | Promise<void>): void
    onPlayerLeave(fn: (player: string) => void | Promise<void>): void
    onEnterZone(zone: string, fn: (player: string) => void | Promise<void>): void
    onExitZone(zone: string, fn: (player: string) => void | Promise<void>): void
    positionOf(player: string): { x: number; y: number; z: number } | null
    every(seconds: number, fn: () => void | Promise<void>): void
    readonly round: RoundTuple
    newRound(): RoundTuple
    onRoundStart(fn: (round: RoundTuple) => void | Promise<void>): void
    layout(prefab: string, positions: (rng: () => number, round: RoundTuple) => Vec3[]): void
  }
  onClick(entity: number, fn: () => void): void
  childrenOf(parent: number): number[]
}

interface Vec3 {
  x: number
  y: number
  z: number
}

interface RoundTuple {
  number: number
  seed: number
  phase: number
  phaseStartMs: number
  configVersion: number
}

// Local shape for the same reason as GameModule: a `typeof import` annotation
// would pull the SDK-typed module graph into this tsconfig.
interface SpawnerModule {
  registerSpawnables(
    snapshots: Array<{
      prefab: string
      alias: string
      max: number
      entities: Array<{
        localId: number
        parent: number | null
        components: Array<{ name: string; json: unknown }>
      }>
      scripts: never[]
    }>
  ): void
}

const GLOBAL_KEYS = [
  '__dclGame_v1',
  '__dclServerLife_v1',
  '__dclProtectedSync_v1',
  '__dclServerState_v1',
  '__dclPlayerStoreKeys_v1',
  '__dclSpawner_v1',
  '__dclOutcomes_v1'
]

beforeEach(() => {
  host.reset()
  vi.resetModules()
  const globals = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) delete globals[key]
})

async function loadGame(): Promise<GameModule> {
  return await vi.importActual<GameModule>('../runtime-modules/game')
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('the game singleton across carried copies', () => {
  it('two byte-identical copies resolve to one driver and one state mirror', async () => {
    const first = await loadGame()
    vi.resetModules()
    const second = await loadGame()
    expect(second).not.toBe(first)
    expect(second.game.state).toBe(first.game.state)
    expect(host.systems.filter((system) => system.name === 'runtime-game')).toHaveLength(1)
  })

  it('the envelopes register at module scope exactly once — siblings adopt, never re-register', async () => {
    await loadGame()
    vi.resetModules()
    await loadGame()
    expect(host.registered.filter((name) => name === 'game.tell')).toHaveLength(1)
    expect(host.registered.filter((name) => name === 'game.rpc.req')).toHaveLength(1)
  })
})

describe('the lazy role fork', () => {
  it('installs the server half on the first tick, when isServer() finally answers true', async () => {
    // module load: isServer() lies (false) — nothing may install yet
    const { game } = await loadGame()
    game.onMessage('open', () => ({ ok: true }))
    expect(host.subs.has('game.rpc.req')).toBe(false)

    host.setServer(true)
    host.tick()
    expect(host.subs.has('game.rpc.req')).toBe(true)
    expect(host.subs.has('game.tell')).toBe(false) // the game tells, it never listens
  })

  it('an ask from the wire dispatches green with the lowercased wallet and replies to the asker only', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    const seen: Array<{ data: unknown; player: string }> = []
    game.onMessage('open', (data, player) => {
      seen.push({ data, player })
      return { ok: true }
    })
    host.tick()
    await settle() // boot completes, queued asks would drain

    const body = JSON.stringify(JSON.stringify({ chest: 5 })) // rpc wire shape: stringified json-string payload
    host.deliver('game.rpc.req', { id: 'a1', method: 'open', body }, { from: '0xAda' })
    await settle()

    expect(seen).toEqual([{ data: { chest: 5 }, player: '0xada' }])
    const res = host.sent.find((message) => message.name === 'game.rpc.res')
    expect(res?.opts).toEqual({ to: ['0xAda'] })
    const reply = res?.value as { ok: boolean; body: string }
    expect(reply.ok).toBe(true)
    expect(JSON.parse(reply.body)).toBe(JSON.stringify({ ok: true }))
  })
})

describe('shared facts on the wire', () => {
  it('a green setState publishes a SharedFact entity: auto sync id, refuse-all guard fused', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    game.onStart(() => game.setState({ doorOpen: true }))
    host.tick()
    await settle()

    const fact = host.components.get('runtime::SharedFact')
    expect(fact).toBeDefined()
    const rows = [...fact!.values.entries()]
    const door = rows.find(([, value]) => value.key === 'doorOpen')
    expect(door?.[1]).toEqual({ key: 'doorOpen', json: 'true', rev: 1 })
    const entity = door![0]
    expect(host.synced).toContainEqual({ entity, componentIds: [fact!.componentId], syncId: undefined })

    const guard = fact!.guards.get(entity)
    expect(guard).toBeDefined() // protectSynced armed in the same breath as syncEntity
    expect(guard!({ entity, newValue: { json: 'false' }, senderAddress: '0xhacker' })).toBe(false)
    expect(guard!({ entity, newValue: { json: 'false' }, senderAddress: '0x0000000000000000000000000000000000000000' })).toBe(true)
  })

  it('boot adopts the surviving snapshot facts, outruns them, and retires them a tick later', async () => {
    const { game } = await loadGame() // defines SharedFact
    const fact = host.components.get('runtime::SharedFact')!
    fact.create(800, { key: 'doorOpen', json: 'true', rev: 4 }) // stale, from the dead run's snapshot
    game.onStart(() => game.setState({ doorOpen: false }))

    host.setServer(true)
    host.tick()
    await settle()

    // fresh publish outran the stale rev; the stale entity still exists this tick
    const rows = [...fact.values.entries()]
    expect(rows).toContainEqual([800, { key: 'doorOpen', json: 'true', rev: 4 }])
    const fresh = rows.find(([entity, value]) => entity !== 800 && value.key === 'doorOpen')
    expect(fresh?.[1]).toEqual({ key: 'doorOpen', json: 'false', rev: 6 })

    host.tick() // the deferred removeEntity lands
    expect(fact.values.has(800)).toBe(false)
    expect([...fact.values.values()].map((value) => value.key).sort()).toEqual(['doorOpen', 'round'])
  })
})

describe('tells on a screen', () => {
  it('a tell reaches the client handler; {to} for another player is filtered on receive', async () => {
    const { game } = await loadGame()
    const got: unknown[] = []
    game.onMessage('goal', (data) => void got.push(data))
    host.tick() // fork as client: subscribes the tell envelope

    host.deliver('game.tell', { name: 'goal', body: '{"n":1}', to: '' })
    host.deliver('game.tell', { name: 'goal', body: '{"n":2}', to: '0xother' })
    host.deliver('game.tell', { name: 'goal', body: '{"n":3}', to: '0xada' }) // this viewer, lowercased

    expect(got).toEqual([{ n: 1 }, { n: 3 }])
  })

  it('a blue send holds while the ladder says waking and goes out after the first heartbeat', async () => {
    const { game } = await loadGame()
    host.tick() // fork as client
    void game.send('open', { chest: 5 })
    expect(host.sent.filter((message) => message.name === 'game.rpc.req')).toHaveLength(0)

    const heartbeat = host.components.get('runtime::Heartbeat')!
    heartbeat.create(600, { beat: 111 })
    host.tick() // serverLife observes the beat: waking → running
    host.tick() // the client tick drains the held ask
    expect(host.sent.filter((message) => message.name === 'game.rpc.req')).toHaveLength(1)
  })

  it('announces every ladder change once, so the editor’s Game strip has a state to draw', async () => {
    const said: string[] = []
    const original = console.log
    console.log = (message: string) => void said.push(message)
    try {
      await loadGame()
      host.tick() // fork as client
      await settle() // the preview gate answers, and the queued line goes out
      host.tick() // still waking: nothing new to say
      const heartbeat = host.components.get('runtime::Heartbeat')!
      heartbeat.create(600, { beat: 111 })
      host.tick() // serverLife observes the beat
      host.tick() // the next client tick reads the new rung
      await settle()
    } finally {
      console.log = original
    }
    expect(said.filter((line) => line.startsWith('[studio] game-life'))).toEqual([
      '[studio] game-life waking',
      '[studio] game-life running'
    ])
  })
})

describe('presence, zones and intervals in the game', () => {
  it('join and leave fire in the game as synced identities appear, and leave flushes the record', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    const joined: string[] = []
    const left: string[] = []
    game.onPlayerJoin((player) => {
      joined.push(player)
      game.playerData(player).set({ coins: 5 })
    })
    game.onPlayerLeave((player) => void left.push(player))
    host.tick()
    await settle() // boot

    host.identity.create(700, { address: '0xAda' })
    host.tick()
    await settle()
    expect(joined).toEqual(['0xada'])
    expect(left).toEqual([])

    host.identity.values.delete(700)
    host.tick()
    await settle()
    expect(left).toEqual(['0xada'])
    // leave checkpoints the record immediately — the debounce window would outlive the visit
    expect(host.storage.players.get('0xada|game')).toEqual({ coins: 5 })
  })

  it('a zone enter-ask from a player the server sees outside the zone is refused', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    const entered: string[] = []
    game.onEnterZone('Vault', (player) => void entered.push(player))

    // the placed Trigger Zone: a 4×3×4 box at (8,1,8) named Vault
    const names = host.engine.getComponentOrNull('core-schema::Name') ?? host.engine.defineComponent('core-schema::Name')
    names.create(810, { value: 'Vault' })
    host.triggerArea.create(810, { mesh: 0 })
    host.transform.create(810, {
      position: { x: 8, y: 1, z: 8 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 4, y: 3, z: 4 }
    })
    // the claimant's synced avatar, far away
    host.identity.create(820, { address: '0xBad' })
    host.transform.create(820, { position: { x: 30, y: 0, z: 30 } })
    host.tick()
    await settle() // boot

    const body = JSON.stringify(JSON.stringify({ zone: 'Vault', kind: 'enter' }))
    host.deliver('game.rpc.req', { id: 'z1', method: 'game.zone', body }, { from: '0xBad' })
    await settle()
    expect(entered).toEqual([])
    const refused = host.sent.find(
      (message) => message.name === 'game.rpc.res' && (message.value as { id: string }).id === 'z1'
    )
    expect((refused?.value as { ok: boolean }).ok).toBe(false)
    expect(JSON.parse((refused?.value as { body: string }).body)).toContain('outside "Vault"')

    // the same claim from inside the volume is admitted and fires the green callback
    host.transform.getMutable(820).position = { x: 9, y: 1, z: 8 }
    host.deliver('game.rpc.req', { id: 'z2', method: 'game.zone', body }, { from: '0xBad' })
    await settle()
    expect(entered).toEqual(['0xbad'])
    const admitted = host.sent.find(
      (message) => message.name === 'game.rpc.res' && (message.value as { id: string }).id === 'z2'
    )
    expect((admitted?.value as { ok: boolean }).ok).toBe(true)
  })

  it('the game starts round 1 at boot and a green newRound publishes the next tuple with a fresh seed', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    game.onMessage('start', () => game.newRound())
    host.tick()
    await settle() // boot: adopt → retire → onStart → round 1

    const fact = host.components.get('runtime::SharedFact')!
    const roundJson = () => [...fact.values.values()].find((value) => value.key === 'round')!.json as string
    const first = JSON.parse(roundJson()) as RoundTuple
    expect(first.number).toBe(1)
    expect(game.round.number).toBe(1)

    const body = JSON.stringify(JSON.stringify({}))
    host.deliver('game.rpc.req', { id: 'r1', method: 'start', body }, { from: '0xAda' })
    await settle()
    const second = JSON.parse(roundJson()) as RoundTuple
    expect(second.number).toBe(2)
    expect(second.seed).not.toBe(first.seed) // published seed comes fresh from the stash
  })

  it('a screen rebuilds a layout from the round tuple — fast-forwarded to the current round, byte-identical to a direct recompute', async () => {
    const spawner = await vi.importActual<SpawnerModule>('../runtime-modules/spawner')
    spawner.registerSpawnables([
      {
        prefab: 'rock',
        alias: 'rock',
        max: 8,
        entities: [
          {
            localId: 0,
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
    const { game } = await loadGame()
    const seen: unknown[][] = []
    game.layout('rock', (...args: [() => number, RoundTuple]) => {
      seen.push(args)
      const [rng] = args
      return [
        { x: rng() * 10, y: 0, z: rng() * 10 },
        { x: rng() * 10, y: 0, z: rng() * 10 }
      ]
    })

    // the round tuple arrived in the snapshot: this screen joins mid-game, round 5
    const fact = host.components.get('runtime::SharedFact')!
    fact.create(801, {
      key: 'round',
      json: JSON.stringify({ number: 5, seed: 77, phase: 0, phaseStartMs: 111, configVersion: 0 }),
      rev: 5
    })
    host.tick() // fork as client
    host.tick() // facts land, the layout plans — round 5 directly, rounds 1-4 never replayed

    expect(seen).toHaveLength(1)
    expect(seen[0]).toHaveLength(2) // rng and round only — nothing else to diverge on
    expect(typeof seen[0][0]).toBe('function')
    expect(seen[0][1]).toEqual({ number: 5, seed: 77, phase: 0, phaseStartMs: 111, configVersion: 0 })

    // what any other screen computes from the same tuple, called directly
    const rng = createRng(layoutSeed(77, 'rock'))
    const expected = [
      { x: rng() * 10, y: 0, z: rng() * 10 },
      { x: rng() * 10, y: 0, z: rng() * 10 }
    ]
    const placed = [...host.transform.values.values()]
    expect(JSON.stringify(placed.map((t) => t.position))).toBe(JSON.stringify(expected))
    expect(placed[0].scale).toEqual({ x: 2, y: 2, z: 2 }) // the authored scale survives placement

    // the next round replaces the field with a fresh plan
    fact.createOrReplace(801, {
      key: 'round',
      json: JSON.stringify({ number: 6, seed: 900, phase: 0, phaseStartMs: 222, configVersion: 0 }),
      rev: 6
    })
    host.tick()
    expect(seen).toHaveLength(2)
    expect((seen[1][1] as RoundTuple).number).toBe(6)
    const replaced = [...host.transform.values.values()]
    expect(replaced).toHaveLength(2) // the old copies were released
    expect(JSON.stringify(replaced.map((t) => t.position))).not.toBe(JSON.stringify(expected))
  })

  it('every(1) ticks in the game once booted, green enough to setState', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    let ticks = 0
    game.every(1, () => {
      ticks += 1
      game.setState({ ticks })
    })
    host.tick()
    await settle() // boot
    host.tick(0.5)
    expect(ticks).toBe(0)
    host.tick(0.5)
    await settle()
    expect(ticks).toBe(1)
    expect(game.state.ticks).toBe(1)
  })
})

describe('the game is the only writer of shared facts', () => {
  it('arms a component-wide guard so a fact the game never created is still refused', async () => {
    const { game } = await loadGame()
    game.onStart(() => {})
    host.setServer(true)
    host.tick()
    await settle()

    const fact = host.components.get('runtime::SharedFact')
    // the SDK mints a fresh entity for a network id it has never seen, so the
    // per-entity guard cannot cover it — only the component-wide one can
    const guard = fact?.globalGuard
    expect(guard).toBeTypeOf('function')
    expect(
      guard?.({ entity: 9001, newValue: { key: 'round', json: '{}', rev: 99 }, senderAddress: '0xMallory' })
    ).toBe(false)
    expect(
      guard?.({ entity: 9001, newValue: { key: 'round', json: '{}', rev: 99 }, senderAddress: '0x0000000000000000000000000000000000000000' })
    ).toBe(true)
  })

  it('reads a revision off the wire as data: junk never poisons the mirror', async () => {
    const { game } = await loadGame()
    const fact = host.components.get('runtime::SharedFact')
    fact?.create(700, { key: 'score', json: '1', rev: Number.NaN })

    host.setServer(false)
    host.tick()
    host.tick()
    // a revision that isn't a number can't be ordered against anything, so the
    // fact is ignored rather than admitted at an unknowable position
    expect('score' in game.state).toBe(false)

    fact?.createOrReplace(700, { key: 'score', json: '2', rev: 2 })
    host.tick()
    expect(game.state.score).toBe(2)
  })
})

describe('a whisper is addressed by the transport', () => {
  it('passes {to} to the room so non-targets never receive the packet', async () => {
    const { game } = await loadGame()
    game.onStart(() => {})
    host.setServer(true)
    host.tick()
    await settle()
    host.sent.length = 0

    await game.send('warned', { text: 'slow down' }, { to: '0xBob' })

    const tell = host.sent.find((message) => message.name === 'game.tell')
    // the address rides the envelope for defence in depth, but the delivery
    // itself is the transport's job — a broadcast would leak every whisper
    expect(tell?.opts).toEqual({ to: ['0xbob'] })
    expect((tell?.value as { to: string }).to).toBe('0xbob')
  })
})

describe('the pieces a script composes with', () => {
  it('childrenOf lists what was dragged under an entity, in the same order everywhere', async () => {
    const { childrenOf } = await loadGame()
    host.transform.create(950, { parent: 900 })
    host.transform.create(930, { parent: 900 })
    host.transform.create(940, { parent: 901 }) // another parent's child
    expect(childrenOf(900)).toEqual([930, 950])
  })

  it('a layout whose prefab is missing keeps its registration and says what to pass', async () => {
    const { game } = await loadGame()
    const errors: string[] = []
    const original = console.error
    console.error = (message: string) => void errors.push(message)
    try {
      game.layout('chunk-01', () => [{ x: 1, y: 0, z: 1 }])
      // a screen builds its layout from the round it hears about
      const fact = host.components.get('runtime::SharedFact')
      fact?.create(760, {
        key: 'round',
        json: JSON.stringify({ number: 1, seed: 7, phase: 0, phaseStartMs: 0, configVersion: 0 }),
        rev: 1
      })
      host.setServer(false)
      host.tick()
      host.tick()
    } finally {
      console.error = original
    }
    // the message names the real cause and the fix, and the layout is still
    // registered — a missing prefab must not silently end it for the session
    expect(errors.join(' ')).toContain('Spawnables')
  })
})
