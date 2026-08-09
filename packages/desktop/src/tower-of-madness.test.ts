import { beforeEach, describe, expect, it, vi } from 'vitest'

// Tower of Madness, booted the way a scene runs it.
//
// The scripts under test are the fixture's own — the very files
// packages/desktop/validate/probe-tower.mjs drops into src/scripts/ — reaching
// `game` through the real master, with the engine ticked by hand. This is the
// acceptance test for the walkthrough: a round starts, the seeded tower builds
// identically for every player, a finish is validated on the server and refused
// when it should be, and the boards come out of a closed round.
//
// Every script branches on isServer() inside start(), so the role is set BEFORE
// a script is built. A script built while the host answers "client" registers
// its client half and nothing else — which is what this test used to do, and why
// the whole round loop went quiet.
//
// Both halves are covered, but never at the same instant: the registry is a
// process-wide singleton, so a server-role test and a client-role test are two
// tests, not two peers in one. See the note on `place()`.
//
// What is NOT here: the editor's generation pass, sdk-commands' build, and the
// avatar actually climbing. Those need a real scene and a real Multiplayer
// Server — probe-tower.mjs owns them.
//
// The mock host is game-module.test.ts's, trimmed and extended (movePlayerTo,
// player Storage). vi.mock factories are hoisted, so it cannot be shared.
const host = vi.hoisted(() => {
  const systems: Array<{ fn: (dt: number) => void; name: string }> = []
  const subs = new Map<string, Array<(value: unknown, context?: { from: string }) => void>>()
  const sent: Array<{ name: string; value: unknown; opts?: unknown }> = []
  const components = new Map<string, FakeComponent>()
  let server = false
  let nextEntity = 900

  interface FakeComponent {
    componentId: number
    componentName: string
    values: Map<number, Record<string, unknown>>
    create(entity: number, value?: Record<string, unknown>): void
    createOrReplace(entity: number, value?: Record<string, unknown>): void
    deleteFrom(entity: number): void
    get(entity: number): Record<string, unknown>
    getOrNull(entity: number): Record<string, unknown> | null
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
      deleteFrom: (entity) => void values.delete(entity),
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
    PlayerEntity: 1,
    RootEntity: 0,
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

  // The SDK's predefined components: their module exports survive reset, so only
  // their contents are cleared and they re-register by name.
  const identity = define('PlayerIdentityData')
  const transform = define('core::Transform')
  const triggerArea = define('core::TriggerArea')
  const textShape = define('core::TextShape')
  const persistent = [identity, transform, triggerArea, textShape]

  const storage = { world: new Map<string, unknown>(), players: new Map<string, unknown>() }
  const moved: unknown[] = []

  return {
    engine,
    systems,
    subs,
    sent,
    components,
    identity,
    transform,
    triggerArea,
    textShape,
    storage,
    moved,
    define,
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
      subs.clear()
      sent.length = 0
      components.clear()
      moved.length = 0
      storage.world.clear()
      storage.players.clear()
      server = false
      nextEntity = 900
      for (const definition of persistent) {
        definition.values.clear()
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
  pointerEventsSystem: { onPointerDown: () => {} },
  InputAction: { IA_POINTER: 1 },
  Schemas: { Boolean: 'boolean', Int: 'int', Int64: 'int64', String: 'string', Map: (spec: unknown) => spec }
}))
vi.mock('@dcl/sdk/math', () => ({
  Vector3: {
    create: (x = 0, y = 0, z = 0) => ({ x, y, z }),
    add: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({
      x: a.x + b.x,
      y: a.y + b.y,
      z: a.z + b.z
    }),
    // the fixture places zones and avatars unrotated at the scene root
    rotate: (v: { x: number; y: number; z: number }) => ({ ...v })
  }
}))
vi.mock('@dcl/sdk/network', () => ({
  isServer: () => host.isServer(),
  syncEntity: () => {},
  registerMessages: () => host.room()
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
vi.mock('~system/Runtime', () => ({ getRealm: async () => ({ realmInfo: { isPreview: true } }) }))
vi.mock('~system/RestrictedActions', () => ({
  movePlayerTo: async (spec: unknown) => void host.moved.push(spec)
}))

const FIXTURE = '../validate/fixtures/tower-of-madness/scripts'

interface Script {
  start(): void
  update(dt: number): void
}

interface GameHandle {
  readonly state: Record<string, unknown>
  readonly round: { number: number; seed: number }
  now(): number
}

interface TowerModule {
  towerFor(seed: number): number[]
  topFor(seed: number): number
  BASE_X: number
  BASE_Y: number
  BASE_Z: number
  CHUNK_HEIGHT: number
}

interface SpawnerModule {
  registerSpawnables(snapshots: unknown[]): void
  spawnedFrom(entity: number): { prefab: string; instanceId: number } | null
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

// Every deadline in this game is game.now(), which is Date.now() on the server —
// so a test that wants a clock to run out moves the clock rather than sleeping.
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

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function pump(times = 1, dt = 0.25): Promise<void> {
  for (let i = 0; i < times; i++) {
    clockOffsetMs += Math.round(dt * 1000)
    host.tick(dt)
    await settle()
  }
}

/** The one `game` every fixture script sees — reached through their own import. */
async function gameOf(): Promise<GameHandle> {
  const module = await vi.importActual<{ game: GameHandle }>(`${FIXTURE}/runtime/game`)
  return module.game
}

const tower = (): Promise<TowerModule> => vi.importActual<TowerModule>(`${FIXTURE}/pure/tower`)

/** Run the server's boot pipeline and land round 1. The role is already set. */
async function boot(): Promise<void> {
  host.setServer(true)
  await pump(1, 1 / 30)
}

function join(entity: number, address: string, at = { x: 24, y: 2, z: 19 }): void {
  host.identity.create(entity, { address })
  host.transform.create(entity, { position: at, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } })
}

const CHUNKS = Array.from({ length: 10 }, (_, kind) => `chunk-${kind}`)
const END = 'chunk-end'

const asked = { n: 0 }

/** Deliver a request the way a client's rpc does, and hand back the answer. */
async function ask(method: string, payload: unknown = {}, from = '0xada'): Promise<unknown> {
  const id = `ask-${++asked.n}`
  host.deliver(
    'game.rpc.req',
    { id, method, body: JSON.stringify(JSON.stringify(payload)) },
    { from }
  )
  await settle()
  await settle()
  const reply = host.sent.find(
    (message) => message.name === 'game.rpc.res' && (message.value as { id: string }).id === id
  )
  if (reply === undefined) return undefined
  const { ok, body } = reply.value as { ok: boolean; body: string }
  const inner: unknown = JSON.parse(body)
  return ok && typeof inner === 'string' ? JSON.parse(inner) : inner
}

describe('the tower', () => {
  // Layouts are built by each client, so this half runs as one: the round tuple
  // arrives in the snapshot and the chunk pools place themselves. Tower Builder
  // now says so — its server half is a bare return.
  async function build(seed: number, roundNumber = 1): Promise<Map<number, string>> {
    const spawner = await vi.importActual<SpawnerModule>('../runtime-modules/spawner')
    spawner.registerSpawnables(
      [...CHUNKS, END].map((prefab) => ({
        prefab,
        alias: prefab,
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
                  scale: { x: 1, y: 1, z: 1 }
                }
              }
            ]
          }
        ],
        scripts: []
      }))
    )
    const module = await vi.importActual<{
      TowerBuilder: new (src: string, entity: number, chunks: string[], endChunk: string) => Script
    }>(`${FIXTURE}/tower-builder`)
    new module.TowerBuilder('src/scripts', 4, CHUNKS, END).start()

    const fact = host.components.get('runtime::SharedFact') ?? host.define('runtime::SharedFact')
    fact.createOrReplace(801, {
      key: 'round',
      json: JSON.stringify({ number: roundNumber, seed, phase: 0, phaseStartMs: 111, configVersion: 0 }),
      rev: roundNumber
    })
    host.tick() // fork as client
    host.tick() // the fact lands and every pool plans

    const { BASE_X, BASE_Y, BASE_Z, CHUNK_HEIGHT } = await tower()
    const byFloor = new Map<number, string>()
    for (const [entity, value] of host.transform.values) {
      const from = spawner.spawnedFrom(entity)
      if (from === null) continue
      const at = value.position as { x: number; y: number; z: number }
      expect(at.x).toBe(BASE_X)
      expect(at.z).toBe(BASE_Z)
      byFloor.set(Math.round((at.y - BASE_Y) / CHUNK_HEIGHT), from.prefab)
    }
    return byFloor
  }

  it('stacks exactly the chunks the seed asked for, capped by the end chunk', async () => {
    const { towerFor } = await tower()
    const seed = 20260808
    const wanted = towerFor(seed)
    expect(wanted.length).toBeGreaterThanOrEqual(3)
    expect(wanted.length).toBeLessThanOrEqual(8)

    const byFloor = await build(seed)
    expect(byFloor.size).toBe(wanted.length + 1)
    for (const [floor, kind] of wanted.entries()) expect(byFloor.get(floor)).toBe(CHUNKS[kind])
    expect(byFloor.get(wanted.length)).toBe(END)
  })

  it('is a pure function of the seed — the plan never reads anything else', async () => {
    const { towerFor } = await tower()
    expect(towerFor(7)).toEqual(towerFor(7))
    expect(towerFor(7)).not.toEqual(towerFor(8))
  })

  it('rebuilds the whole field when the round changes', async () => {
    const first = await build(20260808, 1)
    const { towerFor, topFor, BASE_Y, CHUNK_HEIGHT } = await tower()
    expect(topFor(20260808)).toBe(BASE_Y + CHUNK_HEIGHT * towerFor(20260808).length)

    const fact = host.components.get('runtime::SharedFact')!
    fact.createOrReplace(801, {
      key: 'round',
      json: JSON.stringify({ number: 2, seed: 99, phase: 0, phaseStartMs: 222, configVersion: 0 }),
      rev: 2
    })
    host.tick()
    const spawner = await vi.importActual<SpawnerModule>('../runtime-modules/spawner')
    const second = new Map<number, string>()
    for (const [entity, value] of host.transform.values) {
      const from = spawner.spawnedFrom(entity)
      if (from === null) continue
      const at = value.position as { y: number }
      second.set(Math.round((at.y - 2) / 6), from.prefab)
    }
    expect(second.size).toBe(towerFor(99).length + 1)
    expect([...second.values()].join(',')).not.toBe([...first.values()].join(','))
  })
})

describe('the round loop', () => {
  interface Placed {
    game: GameHandle
    flow: Script
    results: Script
    race: Script
  }

  /**
   * The three placed scripts, built on the Multiplayer Server.
   *
   * One peer, not two: the registry is a process-wide singleton, and a
   * server-role `game` never subscribes to the broadcast channel at all. So the
   * client half of round-results is a separate test with its own fresh registry
   * (the last one in this block), not a second peer talking to this one. What
   * that leaves uncovered is a real round trip between the two.
   */
  async function place(): Promise<Placed> {
    host.setServer(true)
    const game = await gameOf()
    const flowModule = await vi.importActual<{
      GameFlow: new (
        src: string,
        entity: number,
        roundSeconds: number,
        countdownSeconds: number,
        intermissionSeconds: number,
        minPlayers: number,
        endsWhen: 'timer' | 'script',
        boardKey: string
      ) => Script
    }>('../prefabs/game-flow/scripts/game-flow')
    const resultsModule = await vi.importActual<{
      RoundResults: new (src: string, entity: number, roundSeconds: number, breakSeconds: number, home: number) => Script
    }>(`${FIXTURE}/round-results`)
    const raceModule = await vi.importActual<{
      MadnessRace: new (src: string, entity: number) => Script
    }>(`${FIXTURE}/madness-race`)

    // the Start gate, exactly as the fixture composite places it
    host.textShape.create(517, {})
    const names = host.engine.getComponentOrNull('core-schema::Name') ?? host.define('core-schema::Name')
    names.create(515, { value: 'Start' })
    host.triggerArea.create(515, { mesh: 0 })
    host.transform.create(515, {
      position: { x: 24, y: 3.5, z: 19 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 6, y: 3, z: 6 }
    })

    const flow = new flowModule.GameFlow('custom/game_flow/scripts', 517, 180, 3, 10, 1, 'script', 'leaderboard')
    const results = new resultsModule.RoundResults('src/scripts', 517, 60, 5, 514)
    const race = new raceModule.MadnessRace('src/scripts', 516)
    flow.start()
    results.start()
    race.start()
    return { game, flow, results, race }
  }

  const clockOf = (game: GameHandle): { at: number; left: number; speed: number } =>
    game.state.clock as { at: number; left: number; speed: number }

  it('parks in the lobby, then Game Flow starts the round the whole scene keys on', async () => {
    const { game } = await place()
    await boot()
    expect((game.state.flow as { phase: string }).phase).toBe('lobby')
    expect(clockOf(game).left).toBe(60)

    join(700, '0xAda')
    await pump(20)
    expect((game.state.flow as { phase: string; round: number }).phase).toBe('round')
    expect(game.round.number).toBe(2) // round 1 is the round the scene boots into
  })

  it('refuses a finish from a player who never came through the gate', async () => {
    const { game } = await place()
    await boot()
    join(700, '0xAda')
    await pump(20)
    const { topFor } = await tower()
    host.transform.getMutable(700).position = { x: 24, y: topFor(game.round.seed), z: 24 }

    expect(await ask('finish')).toEqual({ ok: false, why: 'start again from the gate' })
    expect(game.state.finishers).toEqual([])
  })

  it('refuses a finish from a player the server can see is nowhere near the summit', async () => {
    const { game } = await place()
    await boot()
    join(700, '0xAda')
    await pump(20)
    await ask('game.zone', { zone: 'Start', kind: 'enter' })

    expect(await ask('finish')).toEqual({ ok: false, why: 'not at the summit' })
    expect(game.state.finishers).toEqual([])
  })

  it('accepts a summit reached from the gate, times it on the server, and speeds the clock up', async () => {
    const { game } = await place()
    await boot()
    join(700, '0xAda')
    await pump(20)
    await ask('game.zone', { zone: 'Start', kind: 'enter' })
    const before = clockOf(game)
    expect(before.speed).toBe(1)

    await pump(8, 1) // eight seconds of climbing
    const { topFor } = await tower()
    host.transform.getMutable(700).position = { x: 24, y: topFor(game.round.seed), z: 24 }
    host.sent.length = 0
    const verdict = (await ask('finish')) as { ok: boolean; time: number }

    expect(verdict.ok).toBe(true)
    expect(verdict.time).toBeGreaterThan(7)
    expect(game.state.finishers).toEqual([{ p: '0xada', time: verdict.time }])
    expect(clockOf(game).speed).toBe(2)
    expect(clockOf(game).left).toBeLessThan(before.left)
    const broadcast = host.sent.find((message) => message.name === 'game.broadcast')
    expect((broadcast?.value as { name: string }).name).toBe('announce')
    expect(String((broadcast?.value as { body: string }).body)).toContain('x2')

    // one run per player per round
    expect(await ask('finish')).toEqual({ ok: false, why: 'already finished this round' })
  })

  it('closes the round when the clock runs out: boards, a broadcast, and the next round', async () => {
    const { game } = await place()
    await boot()
    join(700, '0xAda')
    await pump(20)
    await ask('game.zone', { zone: 'Start', kind: 'enter' })
    const { topFor } = await tower()
    host.transform.getMutable(700).position = { x: 24, y: topFor(game.round.seed), z: 24 }
    await ask('finish')
    const roundBefore = game.round.number

    host.sent.length = 0
    clockOffsetMs += 70_000 // past the deadline, however fast it was draining
    await pump(6, 1)

    const board = game.state.leaderboard as Array<{ p: string; time: number }>
    expect(board).toHaveLength(1)
    expect(board[0].p).toBe('0xada')
    expect(game.state.seasonBoard).toEqual([{ p: '0xada', pts: 100 }])
    const roundOver = host.sent.filter(
      (message) => message.name === 'game.broadcast' && (message.value as { name: string }).name === 'roundOver'
    )
    expect(roundOver).toHaveLength(1)
    expect(game.round.number).toBeGreaterThan(roundBefore)
    expect(game.state.finishers).toEqual([]) // the next round starts empty
    expect(clockOf(game).left).toBe(60)

    // the run survives the server going to sleep: it is in saved, not just in state
    await pump(6, 1) // past the write-behind window
    expect(host.storage.world.get('serverState:game.saved')).toMatchObject({
      bestTimes: board,
      season: [{ p: '0xada', pts: 100 }]
    })
  })

  // The other half of the same file, on the one machine that can run it: only a
  // player's own client may move that player, so the podium and the trip home
  // live under the else. A fresh registry per test is what makes this reachable
  // — the server-role tests above share theirs, and a server never subscribes to
  // the broadcast channel at all.
  it('lands a player home and prints the podium when the round-over broadcast arrives', async () => {
    const said: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => void said.push(args.join(' '))
    try {
      host.transform.create(514, { position: { x: 24, y: 2, z: 19 } })
      const resultsModule = await vi.importActual<{
        RoundResults: new (src: string, entity: number, roundSeconds: number, breakSeconds: number, home: number) => Script
      }>(`${FIXTURE}/round-results`)
      new resultsModule.RoundResults('src/scripts', 517, 60, 5, 514).start()
      host.tick() // fork as a client

      host.deliver('game.broadcast', {
        name: 'roundOver',
        body: JSON.stringify({ top: [{ p: '0xada', time: 12.5 }] }),
        to: ''
      })
    } finally {
      console.log = original
    }

    expect(host.moved).toEqual([{ newRelativePosition: { x: 24, y: 2, z: 19 } }])
    expect(said.some((line) => line.includes('round over') && line.includes('12.50s'))).toBe(true)
  })
})

