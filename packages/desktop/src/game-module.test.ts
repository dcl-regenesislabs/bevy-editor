import { beforeEach, describe, expect, it, vi } from 'vitest'
import { layoutSeed } from '../runtime-modules/pure/gameCore'
import { createRng } from '../runtime-modules/pure/rng'

// The SDK-facing half of the `game` module, tested the way the scene runs it:
// a MUTABLE isServer (false while module bodies evaluate, truthful by the time
// a script's start() runs) and a second module instance via vi.resetModules() —
// which is precisely what a second carried prefab copy is, sharing only
// globalThis. The pure rules (one handler per name, FIFO, the side guards, boot
// order) are covered by game-harness.test.ts; this suite covers only what
// game.ts owns: the singleton, exactly-once schema registration, the lazy role
// fork, SharedFact wiring, the broadcast envelope and the client's zone watch.

const host = vi.hoisted(() => {
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const registered: string[] = []
  const subs = new Map<string, Array<(value: unknown, context?: { from: string }) => void>>()
  const sent: Array<{ name: string; value: unknown; opts?: unknown }> = []
  const synced: Array<{ entity: number; componentIds: number[]; syncId: number | undefined }> = []
  const components = new Map<string, FakeComponent>()
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

  // failWrites is the storage host refusing everything — the fault BL7's retry
  // cap exists for; playerWrites counts the attempts it costs.
  const storage = {
    world: new Map<string, unknown>(),
    players: new Map<string, unknown>(),
    failWrites: false,
    playerWrites: 0
  }

  // What getRealm answers. Preview is one way a creator plays their own scene;
  // the editor's embedded explorer is the other, and it answers isPreview false
  // on a realm served from this machine.
  const PREVIEW_REALM = { isPreview: true }
  let realm: Record<string, unknown> = PREVIEW_REALM

  return {
    engine,
    systems,
    registered,
    subs,
    sent,
    synced,
    components,
    identity,
    transform,
    triggerArea,
    storage,
    realm: (): Record<string, unknown> => realm,
    setRealm: (next: Record<string, unknown>): void => void (realm = next),
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
      storage.world.clear()
      storage.players.clear()
      storage.failWrites = false
      storage.playerWrites = 0
      realm = PREVIEW_REALM
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
        host.storage.playerWrites += 1
        if (host.storage.failWrites) return false
        host.storage.players.set(`${address}|${key}`, value)
        return true
      }
    }
  }
}))
// The realm the evidence lines the Game strip reads are gated on. Resolved on a
// macrotask, the way the real query is: a line emitted before the answer lands
// has to be queued, which is what the queue-drop case below actually tests.
vi.mock('~system/Runtime', () => ({
  getRealm: () => new Promise((resolve) => setTimeout(() => resolve({ realmInfo: host.realm() }), 0))
}))

interface GameModule {
  game: {
    onReady(fn: () => void | Promise<void>): void
    readonly state: Record<string, unknown>
    setState(patch: Record<string, unknown>): void
    request(name: string, data?: unknown): Promise<unknown>
    onRequest(name: string, fn: (data: unknown, player: string) => unknown): void
    broadcast(name: string, data?: unknown, to?: string): void
    onBroadcast(name: string, fn: (data: unknown) => void): void
    now(): number
    playerData(player: string): { get(): Record<string, unknown>; set(patch: Record<string, unknown>): void }
    onPlayerJoin(fn: (player: string) => void | Promise<void>): void
    onPlayerLeave(fn: (player: string) => void | Promise<void>): void
    onEnterArea(zone: string, fn: (player: string) => void | Promise<void>): void
    positionOf(player: string): { x: number; y: number; z: number } | null
    every(seconds: number, fn: () => void | Promise<void>): void
    readonly round: RoundTuple
    newRound(): RoundTuple
    onRoundStart(fn: (round: RoundTuple) => void | Promise<void>): void
    layout(prefab: string, positions: (rng: () => number, round: RoundTuple) => Vec3[]): void
  }
  childrenOf(parent: number): number[]
}

// The zone bus the Trigger Area item publishes to. game.ts reads it through
// globalThis, so an actual import here is the same bus the module sees.
interface ZoneBusModule {
  publishZone(zone: string, zoneEntity: number, occupants: () => number[]): void
  emitZone(zone: string, kind: 'enter' | 'exit', who: number, zoneEntity: number): void
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
  '__dclOutcomes_v1',
  '__dclZoneBus_v1'
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
    expect(host.registered.filter((name) => name === 'game.broadcast')).toHaveLength(1)
    expect(host.registered.filter((name) => name === 'game.rpc.req')).toHaveLength(1)
  })
})

describe('the lazy role fork', () => {
  it('installs the server half on the first tick, when isServer() finally answers true', async () => {
    // module bodies evaluate before the platform can answer — nothing installs
    const { game } = await loadGame()
    expect(host.subs.has('game.rpc.req')).toBe(false)

    // by the time a script's start() runs, isServer() is the truth, which is
    // what every `if (isServer())` in a creator's script depends on
    host.setServer(true)
    game.onRequest('open', () => ({ ok: true }))

    host.tick()
    expect(host.subs.has('game.rpc.req')).toBe(true)
    expect(host.subs.has('game.broadcast')).toBe(false) // the server broadcasts, it never listens
  })

  it('a request from the wire dispatches with the lowercased wallet and answers the asker only', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    const seen: Array<{ data: unknown; player: string }> = []
    game.onRequest('open', (data, player) => {
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

describe('a request id that arrives twice', () => {
  // The caller resends the same id when a reply is dropped. Re-running the
  // handler is what tells an honest finisher they already finished the round.
  async function armFinish(): Promise<{ runs: () => number }> {
    host.setServer(true)
    const { game } = await loadGame()
    let runs = 0
    game.onRequest('finish', () => {
      runs += 1
      return { place: runs }
    })
    host.tick()
    await settle()
    return { runs: () => runs }
  }

  function repliesTo(id: string): Array<{ ok: boolean; body: string }> {
    return host.sent
      .filter((message) => message.name === 'game.rpc.res' && (message.value as { id: string }).id === id)
      .map((message) => message.value as { ok: boolean; body: string })
  }

  it('replays the stored reply instead of running the handler again', async () => {
    const { runs } = await armFinish()
    const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
    await settle()
    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' }) // the retry
    await settle()

    expect(runs()).toBe(1)
    const replies = repliesTo('f1')
    expect(replies).toHaveLength(2) // the retry is still answered — a silent server wedges the caller
    expect(replies[1]).toEqual(replies[0])
    expect(JSON.parse(replies[0].body)).toBe(JSON.stringify({ place: 1 }))
  })

  it('is remembered per caller — another player reusing the id gets their own run', async () => {
    const { runs } = await armFinish()
    const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
    await settle()
    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xBob' })
    await settle()

    expect(runs()).toBe(2)
    const bob = host.sent.filter(
      (message) => message.name === 'game.rpc.res' && (message.opts as { to: string[] }).to[0] === '0xBob'
    )
    expect(JSON.parse((bob[0].value as { body: string }).body)).toBe(JSON.stringify({ place: 2 }))
  })

  it('survives 256 messages from other players — the bound is per caller, not one shared queue', async () => {
    const { runs } = await armFinish()
    const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
    await settle()
    // one request each, from 256 other players — a shared FIFO evicted Ada's
    // record here and re-ran her handler on the resend the retry was about to
    // send. The per-player rate limit is not what is under test.
    for (let i = 0; i < 256; i++) {
      host.deliver('game.rpc.req', { id: `n${i}`, method: 'finish', body }, { from: `0xfiller${i}` })
    }
    await settle()
    const before = runs()
    expect(before).toBe(257)

    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
    await settle()
    expect(runs()).toBe(before) // replayed, not re-run
    expect(repliesTo('f1')).toHaveLength(2)
  })

  it('still replays a resend sent at the very end of the retry budget, behind the caller’s own burst', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { runs } = await armFinish()
      const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
      await settle()
      const before = runs()
      expect(before).toBe(1)

      // everything one caller can legitimately put between their first send and
      // their last retry: 8 sends a second (the sanctioned rate) for the whole
      // 12 s budget. A ring that only held the last handful lost f1 in here, and
      // the retry below re-ran a finish the player already got credit for.
      for (let second = 1; second <= 12; second++) {
        vi.setSystemTime(Date.now() + 1_000)
        for (let i = 0; i < 8; i++) {
          host.deliver('game.rpc.req', { id: `b${second}.${i}`, method: 'finish', body }, { from: '0xAda' })
        }
        await settle()
      }

      const afterBurst = runs()
      expect(afterBurst).toBe(97) // f1 plus every one of the burst

      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' }) // the last retry
      await settle()
      expect(runs()).toBe(afterBurst) // replayed, not re-run
      const replies = repliesTo('f1')
      expect(replies).toHaveLength(2)
      expect(replies[1]).toEqual(replies[0])
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps what one caller can hold, so their flood stays flat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { runs } = await armFinish()
      const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
      await settle()
      const before = runs()

      // more ids than the ring holds, all in the same instant so nothing can age
      // out: the TTL is not what is under test here, the per-caller cap is. Most
      // of these are refused by the rate limit — they are still remembered, which
      // is the point.
      for (let i = 0; i < 300; i++) {
        host.deliver('game.rpc.req', { id: `a${i}`, method: 'finish', body }, { from: '0xAda' })
      }
      await settle()

      const afterBurst = runs()
      vi.setSystemTime(Date.now() + 1_000) // the caller's rate budget refills
      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
      await settle()
      expect(runs()).toBe(afterBurst + 1) // pushed out by their own traffic — bounded beats perfect
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires a record only past every retry the caller had left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { runs } = await armFinish()
      const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
      await settle()

      // the client's whole budget is 4 s × 3 attempts: a resend at the end of it
      // still replays
      vi.setSystemTime(Date.now() + 12_000)
      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
      await settle()
      expect(runs()).toBe(1)

      // past the window, with the caller long since given up
      vi.setSystemTime(Date.now() + 10_000)
      host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
      await settle()
      expect(runs()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a player’s records when they leave, so a full room costs the room', async () => {
    const { runs } = await armFinish()
    const body = JSON.stringify(JSON.stringify({ seconds: 12 }))

    // the server sees the roster through synced identities; Ada arrives, asks, leaves
    host.identity.create(701, { address: '0xAda' })
    host.tick()
    await settle()
    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
    await settle()
    expect(runs()).toBe(1)

    host.identity.values.delete(701)
    host.tick()
    await settle()

    host.deliver('game.rpc.req', { id: 'f1', method: 'finish', body }, { from: '0xAda' })
    await settle()
    expect(runs()).toBe(2)
  })
})

describe('shared facts on the wire', () => {
  it('a setState on the server publishes a SharedFact entity: auto sync id, refuse-all guard fused', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    game.onReady(() => game.setState({ doorOpen: true }))
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

    host.setServer(true) // start() runs on the woken server
    game.onReady(() => game.setState({ doorOpen: false }))
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

describe('broadcasts on a client', () => {
  it('a broadcast reaches the client handler; {to} for another player is filtered on receive', async () => {
    const { game } = await loadGame()
    const got: unknown[] = []
    game.onBroadcast('goal', (data) => void got.push(data))
    host.tick() // fork as client: subscribes the broadcast envelope

    host.deliver('game.broadcast', { name: 'goal', body: '{"n":1}', to: '' })
    host.deliver('game.broadcast', { name: 'goal', body: '{"n":2}', to: '0xother' })
    host.deliver('game.broadcast', { name: 'goal', body: '{"n":3}', to: '0xada' }) // this viewer, lowercased

    expect(got).toEqual([{ n: 1 }, { n: 3 }])
  })

  it('a request holds while the ladder says waking and goes out after the first heartbeat', async () => {
    const { game } = await loadGame()
    host.tick() // fork as client
    void game.request('open', { chest: 5 })
    expect(host.sent.filter((message) => message.name === 'game.rpc.req')).toHaveLength(0)

    const heartbeat = host.components.get('runtime::Heartbeat')!
    heartbeat.create(600, { beat: 111 })
    host.tick() // serverLife observes the beat: waking → running
    host.tick() // the client tick drains the held request
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

// The middle is retired: the client watches every Trigger Area the scene has
// published, not the ones this copy happened to register for. That is what lets
// game.onEnterArea live inside if (isServer()) like every other hook.
describe('the client watches every placed Trigger Area', () => {
  it('claims a crossing for an area no script on this copy registered for', async () => {
    const bus = await vi.importActual<ZoneBusModule>('../runtime-modules/zoneBus')
    await loadGame() // a client: isServer() is false, so the scene's onEnterArea never ran here
    host.tick() // fork as client
    const heartbeat = host.components.get('runtime::Heartbeat')!
    heartbeat.create(600, { beat: 111 })
    host.tick() // serverLife observes the beat: waking → running
    host.tick()

    // the Trigger Area item publishes AFTER boot — the case a watch list built
    // from the script's own registrations could never pick up
    bus.publishZone('Start', 810, () => [])
    host.tick()
    bus.emitZone('Start', 'enter', host.engine.PlayerEntity, 810)
    await settle()

    const claim = host.sent.find(
      (message) => message.name === 'game.rpc.req' && (message.value as { method: string }).method === 'game.zone'
    )
    expect(claim).toBeDefined()
    expect(JSON.parse((claim!.value as { body: string }).body)).toBe(JSON.stringify({ zone: 'Start', kind: 'enter' }))
  })

  it('ignores another avatar crossing — only this player can claim their own crossing', async () => {
    const bus = await vi.importActual<ZoneBusModule>('../runtime-modules/zoneBus')
    await loadGame()
    host.tick()
    const heartbeat = host.components.get('runtime::Heartbeat')!
    heartbeat.create(600, { beat: 111 })
    host.tick()
    host.tick()

    bus.publishZone('Start', 810, () => [])
    host.tick()
    bus.emitZone('Start', 'enter', 777, 810) // somebody else's avatar
    await settle()

    expect(host.sent.some((message) => message.name === 'game.rpc.req')).toBe(false)
  })
})

describe('presence, zones and intervals on the server', () => {
  it('join and leave fire on the server as synced identities appear, and leave flushes the record', async () => {
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

  it('a Trigger Area registered inside if (isServer()) fires, and a claim from outside is refused', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    const entered: string[] = []
    // exactly what a script writes now: the registration lives in the server
    // branch, and the client's watch list comes from the zone bus instead
    game.onEnterArea('Vault', (player) => void entered.push(player))

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

    // the same claim from inside the volume is admitted and fires the callback
    host.transform.getMutable(820).position = { x: 9, y: 1, z: 8 }
    host.deliver('game.rpc.req', { id: 'z2', method: 'game.zone', body }, { from: '0xBad' })
    await settle()
    expect(entered).toEqual(['0xbad'])
    const admitted = host.sent.find(
      (message) => message.name === 'game.rpc.res' && (message.value as { id: string }).id === 'z2'
    )
    expect((admitted?.value as { ok: boolean }).ok).toBe(true)
  })

  it('the server starts round 1 at boot and newRound publishes the next tuple with a fresh seed', async () => {
    host.setServer(true)
    const { game } = await loadGame()
    game.onRequest('start', () => game.newRound())
    host.tick()
    await settle() // boot: adopt → retire → onReady → round 1

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

  it('a client rebuilds a layout from the round tuple — fast-forwarded to the current round, byte-identical to a direct recompute', async () => {
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

    // the round tuple arrived in the snapshot: this client joins mid-game, round 5
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

    // what any other client computes from the same tuple, called directly
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

  it('every(1) ticks on the server once booted, and can setState', async () => {
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

describe('the server is the only writer of shared facts', () => {
  it('arms a component-wide guard so a fact the server never created is still refused', async () => {
    const { game } = await loadGame()
    host.setServer(true)
    game.onReady(() => {})
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
    host.setServer(true)
    game.onReady(() => {})
    host.tick()
    await settle()
    host.sent.length = 0

    game.broadcast('warned', { text: 'slow down' }, '0xBob')

    const sent = host.sent.find((message) => message.name === 'game.broadcast')
    // the address rides the envelope for defence in depth, but the delivery
    // itself is the transport's job — reaching everyone would leak every whisper
    expect(sent?.opts).toEqual({ to: ['0xbob'] })
    expect((sent?.value as { to: string }).to).toBe('0xbob')
  })
})

describe('durable writes when storage refuses', () => {
  it('stops retrying after five failures and says so once', async () => {
    // Date drives the debounce window; the timers stay real so settle() works
    vi.useFakeTimers({ toFake: ['Date'] })
    const lines: string[] = []
    const original = console.log
    console.log = (message: string) => void lines.push(message)
    try {
      host.setServer(true)
      host.storage.failWrites = true
      const { game } = await loadGame()
      game.onRequest('score', (_data, player) => {
        game.playerData(player).set({ coins: 1 })
        return {}
      })
      host.tick()
      await settle()

      host.deliver(
        'game.rpc.req',
        { id: 's1', method: 'score', body: JSON.stringify('{}') },
        { from: '0xAda' }
      )
      await settle()
      host.storage.playerWrites = 0 // the restore read is not a write

      for (let i = 0; i < 8; i++) {
        vi.setSystemTime(Date.now() + 4_000) // past the debounce window
        host.tick()
        await settle()
      }

      expect(host.storage.playerWrites).toBe(5)
      const said = lines.filter((line) => line.includes("Saved data isn't being stored"))
      expect(said).toHaveLength(1)
      expect(said[0]).toContain('[game]')
      expect(said[0]).toContain('play again')
    } finally {
      console.log = original
      vi.useRealTimers()
    }
  })

  it('counts rounds, not players — a full room does not spend the budget in one pass', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const lines: string[] = []
    const original = console.log
    console.log = (message: string) => void lines.push(message)
    try {
      host.setServer(true)
      host.storage.failWrites = true
      const { game } = await loadGame()
      game.onRequest('score', (_data, player) => {
        game.playerData(player).set({ coins: 1 })
        return {}
      })
      host.tick()
      await settle()

      // six players write in the same window: the old count spent the whole
      // budget on one flush and gave up before the second
      for (let i = 0; i < 6; i++) {
        host.deliver(
          'game.rpc.req',
          { id: `s${i}`, method: 'score', body: JSON.stringify('{}') },
          { from: `0xPlayer${i}` }
        )
      }
      await settle()

      vi.setSystemTime(Date.now() + 4_000)
      host.tick()
      await settle()
      expect(lines.filter((line) => line.includes("Saved data isn't being stored"))).toHaveLength(0)

      // the host comes back: the next round lands, and the count is cleared
      host.storage.failWrites = false
      vi.setSystemTime(Date.now() + 4_000)
      host.tick()
      await settle()
      expect(host.storage.players.get('0xplayer0|game')).toEqual({ coins: 1 })

      // it refuses again — the fault reports again rather than staying quiet
      host.storage.failWrites = true
      for (let i = 0; i < 6; i++) {
        host.deliver(
          'game.rpc.req',
          { id: `t${i}`, method: 'score', body: JSON.stringify('{}') },
          { from: `0xPlayer${i}` }
        )
      }
      await settle()
      for (let i = 0; i < 8; i++) {
        vi.setSystemTime(Date.now() + 4_000)
        host.tick()
        await settle()
      }
      expect(lines.filter((line) => line.includes("Saved data isn't being stored"))).toHaveLength(1)
    } finally {
      console.log = original
      vi.useRealTimers()
    }
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

  async function layoutErrors(prefab: string): Promise<string[]> {
    const { game } = await loadGame()
    const errors: string[] = []
    const original = console.error
    console.error = (message: string) => void errors.push(message)
    try {
      game.layout(prefab, () => [{ x: 1, y: 0, z: 1 }])
      // a client builds its layout from the round it hears about
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
    return errors
  }

  it('a layout whose prefab this project no longer has sends the creator to the inspector', async () => {
    // scripts address a prefab by an id nobody typed, so quoting it back would
    // name a check the creator cannot make
    const said = (await layoutErrors('b2f1c0de-9a41-4d55-8b0e-77a2f5c31d90')).join(' ')
    expect(said).toContain('no longer in this project')
    expect(said).toContain('Pick the prefab again in the inspector')
    expect(said).not.toContain('b2f1c0de')
    expect(said).not.toContain('Check the name matches the Prefabs tab')
  })

  it('a layout the registry does know names the prefab the way the Prefabs tab does', async () => {
    const spawner = await vi.importActual<SpawnerModule>('../runtime-modules/spawner')
    spawner.registerSpawnables([
      {
        prefab: 'b2f1c0de-9a41-4d55-8b0e-77a2f5c31d90',
        alias: 'Rock',
        max: 2,
        entities: [{ localId: 1, parent: null, components: [] }],
        scripts: []
      }
    ])
    const { game } = await loadGame()
    const errors: string[] = []
    const original = console.error
    console.error = (message: string) => void errors.push(message)
    try {
      game.layout('b2f1c0de-9a41-4d55-8b0e-77a2f5c31d90', () => {
        throw new Error('plan blew up')
      })
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
    const said = errors.join(' ')
    expect(said).toContain("layout('Rock')")
    expect(said).not.toContain('b2f1c0de')
  })
})

// The Game strip draws nothing without these lines, so the gate that lets them
// out has to cover both ways a creator plays their own scene — and only those.
describe('the evidence lines the editor reads', () => {
  async function published(realmInfo: Record<string, unknown>): Promise<string[]> {
    host.setRealm(realmInfo)
    const lines: string[] = []
    const original = console.log
    console.log = (message: string) => void lines.push(message)
    try {
      const sync = await vi.importActual<{ previewLog(line: string): void }>('../runtime-modules/protectedSync')
      sync.previewLog('[studio] before the realm answers')
      // the realm query has not answered yet, so this one is queued — which is
      // what makes the public-realm case a queue DROP and not just a no-op
      expect(lines.filter((line) => line.startsWith('[studio] '))).toEqual([])
      await settle()
      sync.previewLog('[studio] after the realm answers')
      await settle()
    } finally {
      console.log = original
    }
    return lines.filter((line) => line.startsWith('[studio] '))
  }

  it('publishes in preview', async () => {
    expect(await published({ isPreview: true, baseUrl: 'http://127.0.0.1:8000', realmName: 'LocalPreview' })).toEqual([
      '[studio] before the realm answers',
      '[studio] after the realm answers'
    ])
  })

  it('publishes on the editor’s realm, which answers isPreview false from this machine', async () => {
    expect(
      await published({ isPreview: false, baseUrl: 'http://127.0.0.1:8123/', realmName: 'LocalSceneRealm' })
    ).toEqual(['[studio] before the realm answers', '[studio] after the realm answers'])
  })

  it('publishes when only the realm name is the local one', async () => {
    expect(await published({ isPreview: false, baseUrl: '', realmName: 'ws://localhost:9000' })).toEqual([
      '[studio] before the realm answers',
      '[studio] after the realm answers'
    ])
  })

  it('stays silent on a public realm and drops what it queued', async () => {
    expect(
      await published({ isPreview: false, baseUrl: 'https://realm-provider.decentraland.org/main', realmName: 'main' })
    ).toEqual([])
  })
})
