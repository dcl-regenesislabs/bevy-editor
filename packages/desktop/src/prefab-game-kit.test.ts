import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The three game-kit prefabs booted the way a scene runs them: the real carried
// copy of the `game` module under a mutable isServer, one placed script class,
// and the engine ticked by hand. The pure halves (flow arithmetic, health map,
// board reader) are covered in packages/ui/src/prefabs/builtin-kit.test.ts —
// what only shows up here is the WIRING: which callbacks a piece registers,
// what it publishes into game.state, and what it says to the screens.
//
// The mock host is the one from game-module.test.ts, trimmed to what these three
// touch. vi.mock factories are hoisted, so it cannot be shared through an import.
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
  const moved: unknown[] = []
  const identity = define('PlayerIdentityData')
  const transform = define('core::Transform')
  const triggerArea = define('core::TriggerArea')
  const textShape = define('core::TextShape')
  const persistent = [identity, transform, triggerArea, textShape]

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
    textShape,
    moved,
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
      moved.length = 0
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
  TextShape: host.textShape,
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

vi.mock('~system/RestrictedActions', () => ({
  movePlayerTo: async (spec: unknown) => void host.moved.push(spec)
}))

interface Script {
  start(): void
  update(dt: number): void
}

interface GameFlowModule {
  GameFlow: new (
    src: string,
    entity: number,
    roundSeconds?: number,
    countdownSeconds?: number,
    intermissionSeconds?: number,
    minPlayers?: number,
    endsWhen?: 'timer' | 'script',
    boardKey?: string
  ) => Script
}

interface HealthModule {
  HealthRespawn: new (
    src: string,
    entity: number,
    respawnAt?: number,
    maxHealth?: number,
    dieBelowHeight?: number
  ) => Script
  damage(player: string, amount: number): void
  healthOf(player: string): number
}

interface LeaderboardModule {
  Leaderboard: new (
    src: string,
    entity: number,
    title?: string,
    boardKey?: string,
    sort?: 'desc' | 'asc',
    rows?: number
  ) => Script
}

interface GameHandle {
  readonly state: Record<string, unknown>
  setState(patch: Record<string, unknown>): void
  onMessage(name: string, fn: (data: unknown, player: string) => unknown): void
  newRound(): { number: number }
  now(): number
}

const GLOBAL_KEYS = [
  '__dclGame_v1',
  '__dclServerLife_v1',
  '__dclProtectedSync_v1',
  '__dclServerState_v1',
  '__dclPlayerStoreKeys_v1',
  '__dclSpawner_v1',
  '__dclOutcomes_v1',
  '__dclUiRendererOwner'
]

// Every deadline in the kit is `game.now()`, which is Date.now() on the game —
// so a test that wants a countdown to expire moves the clock rather than sleeping.
const realNow = Date.now
let clockOffsetMs = 0

beforeEach(() => {
  host.reset()
  vi.resetModules()
  clockOffsetMs = 0
  vi.spyOn(Date, 'now').mockImplementation(() => realNow.call(Date) + clockOffsetMs)
  const globals = globalThis as unknown as Record<string, unknown>
  for (const key of GLOBAL_KEYS) delete globals[key]
})

afterEach(() => {
  vi.restoreAllMocks()
})

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// Every kit script reaches `game` through its own carried copy; loading that copy
// is what proves the folder is self-contained, so tests never load the master.
async function gameOf(folder: string): Promise<GameHandle> {
  const module = await vi.importActual<{ game: GameHandle }>(`../prefabs/${folder}/scripts/runtime/game`)
  return module.game
}

// Presence, playerData restores and green handlers are all awaited chains behind
// a tick, so a test advances the world rather than calling one tick and hoping.
async function pump(times = 1, dt = 0.25): Promise<void> {
  for (let i = 0; i < times; i++) {
    clockOffsetMs += Math.round(dt * 1000)
    host.tick(dt)
    await settle()
  }
}

/** Boot the game half: fork to server, run the boot pipeline, land round 1. */
async function boot(): Promise<void> {
  host.setServer(true)
  await pump(1, 1 / 30)
}

function join(entity: number, address: string): void {
  host.identity.create(entity, { address })
}

// The green door a test writes shared facts through: setState outside a handler
// throws by design, so seeding state means asking the game like a screen does.
const SEED = 'seedForTest'
let asks = 0

function armSeed(game: GameHandle): void {
  game.onMessage(SEED, (data) => game.setState(data as Record<string, unknown>))
}

async function seed(patch: Record<string, unknown>): Promise<void> {
  host.deliver(
    'game.rpc.req',
    { id: `seed-${++asks}`, method: SEED, body: JSON.stringify(JSON.stringify(patch)) },
    { from: '0xAda' }
  )
  await settle()
}

describe('Game Flow', () => {
  async function place(
    ...args: [number?, number?, number?, number?, ('timer' | 'script')?, string?]
  ): Promise<{ flow: Script; game: GameHandle }> {
    const game = await gameOf('game-flow')
    const module = await vi.importActual<GameFlowModule>('../prefabs/game-flow/scripts/game-flow')
    return { flow: new module.GameFlow('custom/game_flow/scripts', 4, ...args), game }
  }

  function flowFact(game: GameHandle): { phase: string; endsAtMs: number; round: number; present: number } {
    return game.state.flow as { phase: string; endsAtMs: number; round: number; present: number }
  }

  it('waits in a parked lobby until the scene has enough players', async () => {
    const { flow, game } = await place(300, 10, 10, 2)
    flow.start()
    await boot()
    expect(flowFact(game)).toMatchObject({ phase: 'lobby', endsAtMs: 0, round: 0, present: 0 })

    join(700, '0xAda')
    await pump(3)
    expect(flowFact(game)).toMatchObject({ phase: 'lobby', endsAtMs: 0, present: 1 })

    join(701, '0xBob')
    await pump(3)
    expect(flowFact(game).phase).toBe('lobby')
    expect(flowFact(game).present).toBe(2)
    expect(flowFact(game).endsAtMs).toBeGreaterThan(game.now())
  })

  // The boot round is the lobby's round; only a round somebody started is played.
  it('never counts the round the game boots into as round 1', async () => {
    const { flow, game } = await place(300, 1, 10, 1)
    flow.start()
    await boot()
    expect((game.state.round as { number: number }).number).toBe(1)
    expect(flowFact(game)).toMatchObject({ phase: 'lobby', round: 0 })

    join(700, '0xAda')
    await pump(12)
    expect(flowFact(game)).toMatchObject({ phase: 'round', round: 1 })
    expect((game.state.round as { number: number }).number).toBe(2)
  })

  it('closes a timed round on its deadline, announces the winners, then runs the next', async () => {
    const { flow, game } = await place(2, 1, 5, 1)
    armSeed(game)
    flow.start()
    await boot()
    join(700, '0xAda')
    await pump(10)
    await seed({ leaderboard: [{ player: '0xada', score: 9 }] })
    expect(flowFact(game)).toMatchObject({ phase: 'round', round: 1 })

    host.sent.length = 0
    await pump(9)
    expect(flowFact(game)).toMatchObject({ phase: 'intermission', round: 1 })
    const tell = host.sent.find((message) => message.name === 'game.tell')
    expect(tell?.value).toMatchObject({ name: 'announce' })
    expect(String((tell?.value as { body: string }).body)).toContain('Round over')

    // the loop keeps going: the exact tick a phase flips is arithmetic, so the
    // assertion is that round 2 was reached, not which tick reached it
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      await pump(1)
      seen.add(`${flowFact(game).phase}-${flowFact(game).round}`)
    }
    expect([...seen]).toContain('round-2')
  })

  // §12 #3: round length is a ceiling and a script's newRound owns the end. The
  // two must not both close one round.
  it('follows a script that ends the round early, announcing once', async () => {
    const { flow, game } = await place(600, 1, 1, 1, 'script')
    // the creator's own green handler, the shape §12 #3 sanctions
    game.onMessage('endItNow', () => game.newRound())
    flow.start()
    await boot()
    join(700, '0xAda')
    await pump(12)
    expect(flowFact(game)).toMatchObject({ phase: 'round', round: 1 })

    host.sent.length = 0
    host.deliver(
      'game.rpc.req',
      { id: 'end-1', method: 'endItNow', body: JSON.stringify(JSON.stringify({})) },
      { from: '0xAda' }
    )
    await settle()
    await pump(2)

    // the script owned the end; the ceiling never fired a second one
    expect(flowFact(game)).toMatchObject({ phase: 'round', round: 2 })
    expect(host.sent.filter((message) => message.name === 'game.tell')).toHaveLength(1)
  })

  it('paints the phase on its own sign, and a second copy paints without driving', async () => {
    const { flow, game } = await place(300, 1, 10, 1)
    flow.start()
    const module = await vi.importActual<GameFlowModule>('../prefabs/game-flow/scripts/game-flow')
    const second = new module.GameFlow('custom/game_flow/scripts', 5, 300, 1, 10, 1)
    second.start()
    await boot()
    join(700, '0xAda')
    await pump(12)

    flow.update(1)
    second.update(1)
    expect(String(host.textShape.get(4).text)).toContain('ROUND 1')
    expect(String(host.textShape.get(5).text)).toContain('ROUND 1')
    // one machine, one fact: the second copy never bumped the round
    expect(flowFact(game).round).toBe(1)
  })
})

describe('Health & Respawn', () => {
  async function place(
    respawnAt = 0,
    maxHealth = 100,
    dieBelowHeight = 0
  ): Promise<{ rig: Script; damage: HealthModule['damage']; healthOf: HealthModule['healthOf'] }> {
    const module = await vi.importActual<HealthModule>('../prefabs/health-respawn/scripts/health-respawn')
    return {
      rig: new module.HealthRespawn('custom/health_respawn/scripts', 4, respawnAt, maxHealth, dieBelowHeight),
      damage: module.damage,
      healthOf: module.healthOf
    }
  }

  it('gives every arriving player full health and forgets them when they leave', async () => {
    const game = await gameOf('health-respawn')
    const { rig } = await place(0, 80)
    rig.start()
    await boot()

    join(700, '0xAda')
    await pump(3)
    expect(game.state.health).toEqual({ '0xada': 80 })

    host.identity.values.delete(700)
    await pump(3)
    expect(game.state.health).toEqual({})
  })

  it('respawns a player at zero health: whispered home, refilled', async () => {
    const game = await gameOf('health-respawn')
    host.transform.create(50, { position: { x: 8, y: 1, z: 8 } })
    const { rig, damage, healthOf } = await place(50, 100)
    // damage() is green code, so a test reaches it the way a scene's own handler
    // would — from inside a handler the game runs.
    game.onMessage('hurt', (data, player) => damage(player, (data as { amount: number }).amount))
    rig.start()
    await boot()
    join(700, '0xAda')
    await pump(3)

    host.deliver(
      'game.rpc.req',
      { id: 'hurt-1', method: 'hurt', body: JSON.stringify(JSON.stringify({ amount: 100 })) },
      { from: '0xAda' }
    )
    await settle()
    expect(healthOf('0xada')).toBe(0)

    host.sent.length = 0
    await pump(4)
    const tell = host.sent.find((message) => message.name === 'game.tell')
    expect(tell?.opts).toEqual({ to: ['0xada'] })
    expect(tell?.value).toMatchObject({ name: 'respawn' })
    expect((game.state.health as Record<string, number>)['0xada']).toBe(100)
  })

  // The death plane is the tower's whole failure mode, and 0 is its off switch.
  it('kills a player who falls past the death plane, and leaves them full above it', async () => {
    const game = await gameOf('health-respawn')
    const { rig } = await place(0, 100, 7)
    rig.start()
    await boot()
    join(700, '0xAda')
    await pump(3)
    host.transform.create(700, { position: { x: 0, y: 2, z: 0 } })

    host.sent.length = 0
    await pump(4)
    const tell = host.sent.find((message) => message.name === 'game.tell')
    expect(tell?.value).toMatchObject({ name: 'respawn' })
    // respawning is a refill, never a demotion
    expect((game.state.health as Record<string, number>)['0xada']).toBe(100)
  })

  it('leaves everyone alone when the death plane is off', async () => {
    await gameOf('health-respawn')
    const { rig } = await place(0, 100, 0)
    rig.start()
    await boot()
    join(700, '0xAda')
    await pump(3)
    host.transform.create(700, { position: { x: 0, y: -50, z: 0 } })

    host.sent.length = 0
    await pump(4)
    expect(host.sent.filter((message) => message.name === 'game.tell')).toEqual([])
  })

  it('moves this player home when the game whispers, and only then', async () => {
    host.transform.create(50, { position: { x: 8, y: 1, z: 8 } })
    const { rig } = await place(50)
    rig.start()
    host.tick() // fork as a screen

    host.deliver('game.tell', { name: 'respawn', body: '{}', to: '0xada' })
    expect(host.moved).toEqual([{ newRelativePosition: { x: 8, y: 1, z: 8 } }])
  })

  it('says what to do instead of teleporting nowhere when no point is picked', async () => {
    const said: string[] = []
    const original = console.log
    console.log = (message: string) => void said.push(message)
    try {
      const { rig } = await place(0)
      rig.start()
      host.tick()
      host.deliver('game.tell', { name: 'respawn', body: '{}', to: '0xada' })
    } finally {
      console.log = original
    }
    expect(host.moved).toEqual([])
    expect(said.some((line) => line.includes("won't respawn anywhere until you pick a respawn point"))).toBe(true)
  })
})

describe('Leaderboard', () => {
  async function place(boardKey = 'leaderboard', sort: 'desc' | 'asc' = 'desc'): Promise<Script> {
    const module = await vi.importActual<LeaderboardModule>('../prefabs/leaderboard/scripts/leaderboard')
    return new module.Leaderboard('custom/leaderboard/scripts', 4, 'Best Times', boardKey, sort, 8)
  }

  // A board is a screen's job, so these run as a screen and the rows arrive the
  // way they really do: as SharedFact entities off the wire.
  async function arrive(key: string, rows: unknown): Promise<void> {
    const fact = host.components.get('runtime::SharedFact')
    fact?.createOrReplace(800, { key, json: JSON.stringify(rows), rev: 1 })
    await pump(2)
  }

  it('paints its empty state until the game writes the key, then the places', async () => {
    await gameOf('leaderboard')
    host.transform.create(5, { parent: 4 })
    host.textShape.create(5, { text: '' })
    const board = await place('bestTimes', 'asc')
    board.start()
    expect(String(host.textShape.get(5).text)).toContain('Nothing to show yet')

    await arrive('bestTimes', [{ p: 'bo', time: 95 }, { p: 'ana', time: 12 }])

    const painted = String(host.textShape.get(5).text)
    expect(painted).toContain('BEST TIMES')
    expect(painted).toContain('1. ana   0:12')
    expect(painted).toContain('2. bo   1:35')
  })

  it('ignores every key but its own', async () => {
    await gameOf('leaderboard')
    host.transform.create(5, { parent: 4 })
    host.textShape.create(5, { text: '' })
    const board = await place('points')
    board.start()

    await arrive('leaderboard', [{ p: 'ana', score: 3 }])
    expect(String(host.textShape.get(5).text)).toContain('Nothing to show yet')
  })
})
