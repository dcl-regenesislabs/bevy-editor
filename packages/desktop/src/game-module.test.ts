import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    getMutable(entity: number): Record<string, unknown>
    getMutableOrNull(entity: number): Record<string, unknown> | null
    has(entity: number): boolean
    validateBeforeChange(...args: unknown[]): void
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
      getMutable: (entity) => {
        const existing = values.get(entity) ?? {}
        values.set(entity, existing)
        return existing
      },
      getMutableOrNull: (entity) => values.get(entity) ?? null,
      has: (entity) => values.has(entity),
      validateBeforeChange: (...args: unknown[]) => {
        // component-level form (serverLife) takes one callback; the per-entity
        // form (protectSynced) takes (entity, callback) — record only the latter
        if (typeof args[0] === 'number' && typeof args[1] === 'function') {
          guards.set(
            args[0],
            args[1] as (change: { entity: number; newValue: unknown; senderAddress: string }) => boolean
          )
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
    addEntity: () => ++nextEntity,
    removeEntity: (entity: number) => {
      for (const definition of components.values()) definition.values.delete(entity)
    },
    addSystem: (fn: (dt: number) => void, _priority: unknown, name: string) => systems.push({ fn, name }),
    removeSystem: (name: string) => {
      const index = systems.findIndex((system) => system.name === name)
      if (index >= 0) systems.splice(index, 1)
    },
    getEntitiesWith: (definition: FakeComponent) => [...definition.values.entries()]
  }

  return {
    engine,
    systems,
    registered,
    subs,
    sent,
    synced,
    components,
    pointer,
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
      server = false
      nextEntity = 900
    }
  }
})

vi.mock('@dcl/sdk/ecs', () => ({
  engine: host.engine,
  GltfContainer: { getMutableOrNull: () => null },
  PlayerIdentityData: {
    getOrNull: (entity: number) => (entity === host.engine.PlayerEntity ? { address: '0xAda' } : null)
  },
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
vi.mock('@dcl/sdk/server', () => {
  const world = new Map<string, unknown>()
  const players = new Map<string, unknown>()
  return {
    Storage: {
      get: async (key: string) => world.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        world.set(key, value)
        return true
      },
      player: {
        get: async (address: string, key: string) => players.get(`${address}|${key}`) ?? null,
        set: async (address: string, key: string, value: unknown) => {
          players.set(`${address}|${key}`, value)
          return true
        }
      }
    }
  }
})
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: false } }) }))

interface GameModule {
  game: {
    onStart(fn: () => void | Promise<void>): void
    readonly state: Record<string, unknown>
    setState(patch: Record<string, unknown>): void
    send(name: string, data?: unknown, opts?: { to?: string }): Promise<unknown>
    onMessage(name: string, fn: (data: unknown, player: string) => unknown): void
    now(): number
  }
  onClick(entity: number, fn: () => void): void
}

const GLOBAL_KEYS = [
  '__dclGame_v1',
  '__dclServerLife_v1',
  '__dclProtectedSync_v1',
  '__dclServerState_v1',
  '__dclPlayerStoreKeys_v1'
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
    expect([...fact!.values.values()]).toEqual([{ key: 'doorOpen', json: 'true', rev: 1 }])
    const [entity] = [...fact!.values.keys()]
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
    const fresh = rows.find(([entity]) => entity !== 800)
    expect(fresh?.[1]).toEqual({ key: 'doorOpen', json: 'false', rev: 6 })

    host.tick() // the deferred removeEntity lands
    expect(fact.values.has(800)).toBe(false)
    expect(fact.values.size).toBe(1)
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
})
