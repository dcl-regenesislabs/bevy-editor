import { beforeEach, describe, expect, it, vi } from 'vitest'

// The two things a runtime module can only get right at BOOT, both invisible to
// every other suite because every other suite mocks isServer() to a constant:
//
//  1. WHICH SIDE a module installs. isServer() answers false until the platform
//     has resolved it, and consumers create their hubs at module scope, so a
//     module that picks its half there installs the CLIENT half on the
//     Multiplayer Server. outcomes did exactly that: no 'report'/'since' handler
//     ever registered, every hit report timed out into a swallowed catch, and
//     zombies were unkillable on a real deploy.
//  2. WHEN the server announces itself. Two prefabs carry two copies of
//     serverLife; module-scope state made each copy its own heartbeat driver, so
//     the copy that armed first beat while its neighbour was still rehydrating.
//
// Both are reproduced the way the scene does it: a MUTABLE isServer, and a second
// module instance obtained through vi.resetModules() — which is precisely what a
// second vendored copy of the file is, sharing only globalThis.

const host = vi.hoisted(() => {
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const subscribed: string[] = []
  const components = new Map<string, FakeComponent>()
  let server = false

  interface FakeComponent {
    componentId: number
    componentName: string
    values: Map<number, Record<string, unknown>>
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
    const definition: FakeComponent = {
      componentId: components.size + 1,
      componentName: name,
      values,
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
      validateBeforeChange: () => {}
    }
    components.set(name, definition)
    return definition
  }

  const engine = {
    defineComponent: (name: string) => define(name),
    getComponentOrNull: (name: string) => components.get(name) ?? null,
    addEntity: () => 900 + components.size,
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
    subscribed,
    components,
    isServer: (): boolean => server,
    setServer: (next: boolean): void => void (server = next),
    tick: (dt = 1 / 30): void => {
      for (const system of [...systems]) system.fn(dt)
    },
    reset: (): void => {
      systems.length = 0
      subscribed.length = 0
      components.clear()
      server = false
    }
  }
})

vi.mock('@dcl/sdk/ecs', () => ({
  engine: host.engine,
  GltfContainer: { getMutableOrNull: () => null },
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
  syncEntity: () => {},
  registerMessages: () => ({
    send: () => {},
    onMessage: (name: string) => void host.subscribed.push(name)
  })
}))
vi.mock('@dcl/sdk/network/message-bus-sync', () => ({
  AUTH_SERVER_PEER_ID: '0x0000000000000000000000000000000000000000'
}))
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: false } }) }))

interface OutcomesModule {
  outcomes(key: string): {
    validate(kind: string, fn: () => { ok: true; value: number }): void
    onOutcome(handler: () => void): () => void
    isSynced(): boolean
  }
}

interface ServerLifeModule {
  startServerLife(id?: string): void
  markServerReady(id?: string): void
  serverLifeState(): string
}

interface ProtectedSyncModule {
  protectedSync(options: {
    entity: number
    syncId: number
    components: unknown[]
    validate: () => boolean
  }): void
}

const GLOBAL_KEYS = ['__dclOutcomes_v1', '__dclServerLife_v1', '__dclProtectedSync_v1']

beforeEach(() => {
  host.reset()
  vi.resetModules()
  const globals = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) delete globals[key]
})

// rpc.handle() is the only thing that subscribes to '<ns>.rpc.req'; installServer
// is the only caller of rpc.handle in outcomes. So this one string is the exact
// evidence that the server half is live.
const SERVER_HALF = 'outcomes.rpc.req'
const CLIENT_HALF = 'runtime.outcomes'

async function loadOutcomes(): Promise<OutcomesModule> {
  return await vi.importActual<OutcomesModule>('../runtime-modules/outcomes')
}

async function loadServerLife(): Promise<ServerLifeModule> {
  return await vi.importActual<ServerLifeModule>('../runtime-modules/serverLife')
}

describe('the outcomes hub picks its transport half on first USE, not on creation', () => {
  it('installs the server half for a hub built at module scope, before isServer() resolved', async () => {
    host.setServer(false)
    const { outcomes } = await loadOutcomes()
    // exactly what wave-director.ts does at module scope, where isServer() lies
    const ledger = outcomes('wave')
    expect(host.subscribed).toEqual([])

    // the platform answers, and only then does a script's start() run
    host.setServer(true)
    ledger.validate('hit', () => ({ ok: true, value: 1 }))

    expect(host.subscribed).toContain(SERVER_HALF)
    expect(host.subscribed).not.toContain(CLIENT_HALF)
  })

  it('still installs the client half on a client', async () => {
    host.setServer(false)
    const { outcomes } = await loadOutcomes()
    const ledger = outcomes('wave')
    ledger.onOutcome(() => {})

    expect(host.subscribed).toContain(CLIENT_HALF)
    expect(host.subscribed).not.toContain(SERVER_HALF)
  })

  it('installs once, whichever ledger and whichever carried copy asks first', async () => {
    host.setServer(false)
    const first = await loadOutcomes()
    const hub = first.outcomes('wave')
    vi.resetModules()
    const second = await loadOutcomes()
    expect(second).not.toBe(first)

    host.setServer(true)
    hub.validate('hit', () => ({ ok: true, value: 1 }))
    second.outcomes('rig').validate('damage', () => ({ ok: true, value: 1 }))

    expect(host.subscribed.filter((name) => name === SERVER_HALF)).toHaveLength(1)
  })

  it('reports a client as caught up only once its first walk has resolved', async () => {
    host.setServer(false)
    const { outcomes } = await loadOutcomes()
    const ledger = outcomes('wave')
    // nobody subscribed: there is no walk to wait for
    expect(ledger.isSynced()).toBe(true)
    ledger.onOutcome(() => {})
    expect(ledger.isSynced()).toBe(false)
  })
})

describe('serverLife drives one heartbeat for the whole scene', () => {
  function beats(): number {
    return host.components.get('runtime::Heartbeat')?.values.size ?? 0
  }

  function beatValue(): number {
    const rows = [...(host.components.get('runtime::Heartbeat')?.values.values() ?? [])]
    return rows.length === 0 ? 0 : Number(rows[0].beat)
  }

  it('runs one driver across two carried copies, and waits for BOTH to be ready', async () => {
    host.setServer(true)
    const roundLoop = await loadServerLife()
    vi.resetModules()
    // a second prefab folder's byte-identical copy: another module, same globals
    const waveDirector = await loadServerLife()
    expect(waveDirector).not.toBe(roundLoop)

    roundLoop.startServerLife('round-loop')
    waveDirector.startServerLife('wave-director')
    expect(host.systems.filter((system) => system.name === 'runtime-server-life')).toHaveLength(1)

    // wave-director arms synchronously; round-loop only after `await store.restore()`
    waveDirector.markServerReady('wave-director')
    host.tick()
    expect(beats()).toBe(0)
    expect(roundLoop.serverLifeState()).toBe('waking')

    roundLoop.markServerReady('round-loop')
    host.tick()
    expect(beats()).toBe(1)
    expect(waveDirector.serverLifeState()).toBe('running')
  })

  it('beats as soon as the only participant is ready', async () => {
    host.setServer(true)
    const life = await loadServerLife()
    life.startServerLife('wave-director')
    host.tick()
    expect(beats()).toBe(0)
    life.markServerReady('wave-director')
    host.tick()
    expect(beats()).toBe(1)
  })

  it('keeps pulsing after the first beat', async () => {
    host.setServer(true)
    const life = await loadServerLife()
    life.startServerLife('solo')
    life.markServerReady('solo')
    host.tick()
    const first = beatValue()
    host.tick(3)
    expect(beatValue()).toBeGreaterThanOrEqual(first)
    expect(beats()).toBe(1)
  })

  it('seals the protected-sync ledger on the first ready TICK, not on the first answer', async () => {
    // Script order is pinned nowhere. When wave-director's start() ran before
    // round-loop's, sealing inside markServerReady() closed the ledger before
    // RoundPhase had a validator, and every run printed a late-registration error
    // no creator could act on.
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(String(args[0])))
    host.setServer(true)
    const waveDirector = await loadServerLife()
    const { protectedSync } = await vi.importActual<ProtectedSyncModule>('../runtime-modules/protectedSync')

    waveDirector.startServerLife('wave-director')
    waveDirector.markServerReady('wave-director')

    // round-loop's start() runs second, still before any system has ticked
    vi.resetModules()
    const roundLoop = await loadServerLife()
    roundLoop.startServerLife('round-loop')
    protectedSync({
      entity: 800,
      syncId: 3101,
      components: [host.engine.defineComponent('runtime::RoundPhase')],
      validate: () => false
    })
    roundLoop.markServerReady('round-loop')

    host.tick()
    expect(errors.filter((line) => line.includes('"kind":"late"'))).toEqual([])
  })

  it('reads the ladder, not the pending set, on a client', async () => {
    host.setServer(false)
    const life = await loadServerLife()
    life.startServerLife('round-loop')
    expect(host.systems.filter((system) => system.name === 'runtime-server-life')).toHaveLength(1)
    expect(life.serverLifeState()).toBe('waking')
    host.tick()
    expect(beats()).toBe(0)
  })
})
