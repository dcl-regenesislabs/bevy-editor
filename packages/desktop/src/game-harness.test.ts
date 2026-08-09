import { describe, expect, it, beforeEach } from 'vitest'
import {
  GameCore,
  GameNameError,
  RateLimiter,
  layoutSeed,
  MAX_PAYLOAD_BYTES,
  MAX_SEND_BYTES,
  PLAYER_DATA_CAP_BYTES,
  PUBLISH_PER_KEY_PER_S,
  type CorePorts,
  type ErrorCard,
  type Player,
  type RoundInfo
} from '../runtime-modules/pure/gameCore'
import { createRng } from '../runtime-modules/pure/rng'

// The multi-peer world simulator: one server core + N client cores wired
// through a simulated transport with the real budgets. In-process and
// deterministic; the real-engine legs live in validate/probe-*.mjs. The
// transport mimics what the engine gives us: reliable + ordered per sender,
// targeted delivery enforced (a non-target never receives), size- and
// rate-budgeted (over-budget = silently dropped, which is what the retry layers
// exist for — here the budget tracker makes drops loud).

const MSG_BYTE_LIMIT = 13_000
const INBOUND_PER_PEER_PER_S = 300

interface BudgetLog {
  oversized: Array<{ name: string; bytes: number }>
  rateDropped: Array<{ from: string; name: string }>
}

class World {
  server: GameCore
  clients = new Map<Player, GameCore>()
  errors: ErrorCard[] = []
  warnings: string[] = []
  // players the core told the transport to forget — the leave-time eviction
  // that keeps the rpc replay cache sized by the room
  dropped: Player[] = []
  budget: BudgetLog = { oversized: [], rateDropped: [] }
  // The CRDT model: facts survive server restarts (the snapshot outlives the
  // isolate) and are replayed to every late joiner on connect.
  facts = new Map<string, { json: string; rev: number }>()
  // The Storage model: unlike facts — which boot retires — these survive both
  // the restart AND the boot wipe. JSON strings, so the serialization boundary
  // is real: a reference mutated after set never reaches storage.
  savedStore = new Map<string, string>()
  playerStorage = new Map<Player, string>()
  // The SDK half writes player records BEHIND a debounce, so between a write
  // and the flush a read still answers with the record as it was before it.
  // Off by default — the suites below want the simpler write-through world.
  writeBehind = false
  private buffered = new Map<Player, string>()
  // host calls are a scene-wide budget: blowing it makes every player's writes
  // fail, so the harness counts them
  loads = new Map<Player, number>()
  private clock = 1_000_000
  private inbound = new Map<string, { count: number; windowStart: number }>()
  private drawnSeeds = 0

  constructor() {
    this.server = new GameCore(this.portsFor('server'))
    void this.server.bootServer([]) // a fresh world wakes with an empty snapshot
  }

  adoptedFacts(): Array<{ key: string; json: string; rev: number }> {
    return [...this.facts].map(([key, f]) => ({ key, json: f.json, rev: f.rev }))
  }

  bootServer(): Promise<void> {
    return this.server.bootServer(this.adoptedFacts(), [...this.clients.keys()])
  }

  now(): number {
    return this.clock
  }

  tick(ms: number): void {
    this.clock += ms
  }

  /** the debounce window elapsing: everything buffered lands in storage */
  flushPlayerStorage(): void {
    for (const [player, json] of this.buffered) this.playerStorage.set(player, json)
    this.buffered.clear()
  }

  join(player: Player): GameCore {
    const core = new GameCore(this.portsFor(player))
    this.clients.set(player, core)
    // late joiner: the snapshot delivers every current fact, no messages —
    // and the server restores their durable record before any handler of
    // theirs can run (the SDK half awaits this; here the load is a microtask
    // that resolves before any request's FIFO dispatch)
    void this.server.restorePlayerData(player)
    for (const [key, f] of this.facts) core.applyFact(key, f.json, f.rev)
    return core
  }

  restartServer(opts?: { boot?: boolean }): GameCore {
    // the snapshot and the storage survive; only the isolate dies
    this.server = new GameCore(this.portsFor('server'))
    if (opts?.boot !== false) void this.bootServer()
    return this.server
  }

  private overRate(from: string): boolean {
    const w = this.inbound.get(from) ?? { count: 0, windowStart: this.clock }
    if (this.clock - w.windowStart >= 1000) {
      w.count = 0
      w.windowStart = this.clock
    }
    w.count += 1
    this.inbound.set(from, w)
    return w.count > INBOUND_PER_PEER_PER_S
  }

  private portsFor(peer: Player | 'server'): CorePorts {
    return {
      now: () => this.clock,
      isServerNow: () => peer === 'server',
      sendRequest: async (name, json) => {
        const bytes = name.length + json.length
        if (bytes > MSG_BYTE_LIMIT) {
          // the transport's silent drop — the budget log is how the harness
          // makes silence loud
          this.budget.oversized.push({ name, bytes })
          return new Promise<string>(() => {})
        }
        if (this.overRate(peer)) {
          this.budget.rateDropped.push({ from: peer, name })
          return new Promise<string>(() => {})
        }
        return this.server.handleRequest(name, json, peer)
      },
      sendBroadcast: (name, json, to) => {
        const bytes = name.length + json.length
        if (bytes > MSG_BYTE_LIMIT) {
          this.budget.oversized.push({ name, bytes })
          return
        }
        for (const [player, core] of this.clients) {
          if (to !== undefined && player !== to) continue
          core.handleBroadcast(name, json)
        }
      },
      publishFact: (key, json, rev) => {
        if (peer !== 'server') throw new Error('only the server publishes facts')
        this.facts.set(key, { json, rev })
        for (const core of this.clients.values()) core.applyFact(key, json, rev)
      },
      retireFact: (key, rev) => {
        if (peer !== 'server') throw new Error('only the server retires facts')
        this.facts.delete(key)
        for (const core of this.clients.values()) core.applyRetire(key, rev)
      },
      emitError: (card) => this.errors.push(card),
      devWarn: (message) => this.warnings.push(message),
      loadSaved: async () => {
        if (peer !== 'server') throw new Error('only the server loads saved data')
        return Object.fromEntries([...this.savedStore].map(([k, json]) => [k, JSON.parse(json)]))
      },
      storeSaved: (key, value) => {
        if (peer !== 'server') throw new Error('only the server stores saved data')
        this.savedStore.set(key, JSON.stringify(value ?? null))
      },
      loadPlayerData: async (player) => {
        if (peer !== 'server') throw new Error('only the server loads player data')
        this.loads.set(player, (this.loads.get(player) ?? 0) + 1)
        const json = this.playerStorage.get(player)
        return json === undefined ? {} : JSON.parse(json)
      },
      storePlayerData: (player, data) => {
        if (peer !== 'server') throw new Error('only the server stores player data')
        const json = JSON.stringify(data)
        if (this.writeBehind) this.buffered.set(player, json)
        else this.playerStorage.set(player, json)
      },
      // Presence and zones are exercised through the SDK half's engine wiring
      // (game-module.test.ts); this world is write-through, so the leave-time
      // flush has nothing left to do, and the transport's per-player memory is
      // the SDK half's rpc cache, which this world does not model.
      flushPlayerData: () => {},
      dropPlayer: (player) => void this.dropped.push(player),
      findZones: () => [],
      playerPosition: () => null,
      // deterministic stand-in for the SDK half's serverState stash
      takeNextSeed: () => {
        if (peer !== 'server') throw new Error('only the server draws round seeds')
        this.drawnSeeds += 1
        return this.drawnSeeds * 1000 + 7
      }
    }
  }
}

let world: World

beforeEach(() => {
  world = new World()
})

/** Every card, with the "in Class.method, file.ts" the report appends stripped. */
function cards(): ErrorCard[] {
  return world.errors.map((card) => ({ ...card, name: card.name.split(' in ')[0] }))
}

describe('harness: request and broadcast across one server and two clients', () => {
  it('a client asks, the server decides once, the answer returns to the asker only', async () => {
    const seen: Array<{ data: unknown; player: Player }> = []
    world.server.onRequest('openChest', (data, player) => {
      seen.push({ data, player })
      return { ok: true, gold: 5 }
    }, 'chest.ts')

    const ana = world.join('0xana')
    world.join('0xbo')

    const answer = await ana.request('openChest', { chest: 517 })
    expect(answer).toEqual({ ok: true, gold: 5 })
    expect(seen).toEqual([{ data: { chest: 517 }, player: '0xana' }])
  })

  it('the server broadcasts to every client; {to} reaches only the target', () => {
    const got: Record<string, unknown[]> = { '0xana': [], '0xbo': [] }
    const ana = world.join('0xana')
    const bo = world.join('0xbo')
    ana.onBroadcast('goal', (d) => void got['0xana'].push(d))
    bo.onBroadcast('goal', (d) => void got['0xbo'].push(d))
    ana.onBroadcast('whisper', (d) => void got['0xana'].push(d))
    bo.onBroadcast('whisper', (d) => void got['0xbo'].push(d))

    world.server.broadcast('goal', { by: '0xana' })
    world.server.broadcast('whisper', { text: 'psst' }, '0xbo')

    expect(got['0xana']).toEqual([{ by: '0xana' }])
    expect(got['0xbo']).toEqual([{ by: '0xana' }, { text: 'psst' }])
  })

  it('a client that hears a broadcast is handed the data and nothing else', () => {
    const args: unknown[][] = []
    const ana = world.join('0xana')
    ana.onBroadcast('goal', (...rest: unknown[]) => void args.push(rest))
    world.server.broadcast('goal', { by: '0xana' })
    // the old shape passed an always-empty player alongside — a lie with a
    // creator-visible name on it
    expect(args).toEqual([[{ by: '0xana' }]])
  })

  it('identity is the connection, never the payload', async () => {
    let seenPlayer = ''
    world.server.onRequest('pray', (data, player) => {
      seenPlayer = player
      return { ok: true }
    }, 'shrine.ts')
    const mallory = world.join('0xmallory')
    await mallory.request('pray', { player: '0xvictim' })
    expect(seenPlayer).toBe('0xmallory')
  })
})

describe('harness: the verb decides the direction, nothing is inferred', () => {
  it('a name nothing answers rejects loudly, naming the verb that would answer it', async () => {
    world.server.onRequest('openChest', () => ({}), 'chest.ts')
    const ana = world.join('0xana')
    await expect(ana.request('opnChest', {})).rejects.toThrow(
      "No handler named 'opnChest'. Answer it with game.onRequest('opnChest', …) on the server."
    )
  })

  it('a name a client listens to cannot be asked of the server — the registries are separate', async () => {
    const heard: unknown[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('roundOver', (d) => void heard.push(d))
    world.server.broadcast('roundOver', { top: 'ana' })

    // a forged packet naming a broadcast can never reach the server: only
    // game.onRequest arms an inbound endpoint, and nothing registered one
    await expect(world.server.handleRequest('roundOver', '{}', '0xmallory')).rejects.toThrow(GameNameError)
    // ...and the name still reaches every client afterwards
    world.server.broadcast('roundOver', { top: 'bo' })
    expect(heard).toEqual([{ top: 'ana' }, { top: 'bo' }])
  })

  it('one name can be both verbs at once — a request to answer and a broadcast to hear', async () => {
    const heard: unknown[] = []
    world.server.onRequest('score', (_d, player) => ({ player }), 'score.ts')
    const ana = world.join('0xana')
    ana.onBroadcast('score', (d) => void heard.push(d))

    await expect(ana.request('score', {})).resolves.toEqual({ player: '0xana' })
    world.server.broadcast('score', { total: 3 })
    expect(heard).toEqual([{ total: 3 }])
    expect(world.warnings).toEqual([]) // nothing to warn about: two verbs, two meanings
  })

  it('one name has one handler: a second script claiming it reports, same script replaces', async () => {
    world.server.onRequest('pray', () => 1, 'shrine.ts')
    world.server.onRequest('pray', () => 2, 'shrine.ts') // same script: replace, prefab placed twice
    world.server.onRequest('pray', () => 3, 'other.ts')
    expect(world.errors.some((e) => e.message.includes("Two scripts both handle 'pray'"))).toBe(true)
    // the first script keeps the name rather than the scene losing a handler
    await expect(world.join('0xana').request('pray', {})).resolves.toBe(2)
  })

  it('unknown requests never dispatch and reject with GameNameError', async () => {
    const ana = world.join('0xana')
    await expect(ana.request('nothing', {})).rejects.toThrow(GameNameError)
  })
})

describe('harness: the wrong side reports once and returns', () => {
  const SET_STATE = 'game.setState only runs on the server. Put this line inside if (isServer()).'

  it('a client update() calling setState prints one card, not one per frame', () => {
    const ana = world.join('0xana')
    for (let frame = 0; frame < 50; frame++) ana.setState({ score: frame })

    expect(cards()).toEqual([{ side: 'you', name: 'game.setState', message: SET_STATE }])
    expect('score' in ana.state).toBe(false)
    // and it names the method a creator has to open, not just the rule
    expect(world.errors[0].name).toContain('game-harness.test.ts')
  })

  it('the card carries the class and method, so the creator opens the right line', () => {
    const ana = world.join('0xana')
    class ClockBoard {
      update(): void {
        ana.setState({ seconds: 12 })
      }
    }
    new ClockBoard().update()
    expect(world.errors[0].name).toContain('ClockBoard.update')
  })

  it('every wrong-side verb names the gesture that exists, and none of them throw', () => {
    const ana = world.join('0xana')
    expect(() => {
      ana.onRequest('open', () => ({}), 'door.ts')
      ana.onReady(() => {})
      ana.onPlayerJoin(() => {})
      ana.onPlayerLeave(() => {})
      ana.onEnterArea('Start', () => {})
      ana.onRoundStart(() => {})
      ana.broadcast('goal', {})
      ana.newRound()
      ana.positionOf('0xana')
      ana.saved.get('highScore')
      ana.saved.set('highScore', 1)
      ana.playerData('0xana').get()
      ana.playerData('0xana').set({ coins: 1 })
      world.server.onBroadcast('goal', () => {})
    }).not.toThrow()

    for (const card of world.errors) {
      expect(card.message).toMatch(/^game\.\w/)
      expect(card.message).toContain('isServer()')
    }
    expect(cards().map((c) => c.name)).toEqual([
      'game.onRequest',
      'game.onReady',
      'game.onPlayerJoin',
      'game.onPlayerLeave',
      'game.onEnterArea',
      'game.onRoundStart',
      'game.broadcast',
      'game.newRound',
      'game.positionOf',
      'game.saved.get',
      'game.saved.set',
      'game.playerData.get',
      'game.playerData.set',
      'game.onBroadcast'
    ])
  })

  it('a request from the server reports instead of quietly asking nobody', async () => {
    await expect(world.server.request('openChest', {})).resolves.toBeUndefined()
    expect(cards()).toEqual([
      {
        side: 'server',
        name: 'game.request',
        message: 'game.request only runs on the client. Move this line out of if (isServer()).'
      }
    ])
  })

  it('game.saved read in start() says where it is loaded instead of returning nothing', () => {
    const fresh = world.restartServer({ boot: false }) // the server exists, but has not woken

    expect(fresh.saved.get('highScore')).toBeUndefined()
    expect(cards()).toEqual([
      {
        side: 'server',
        name: 'game.saved.get:waking',
        message: 'game.saved is loaded when the server wakes. Read it inside game.onReady, not in start().'
      }
    ])
  })

  it('the reserved round key teaches and leaves the rest of the patch alone', () => {
    world.server.setState({ round: 3, score: 1 })
    expect(world.server.round.number).toBe(1) // the real round survived the write
    expect(world.server.state.score).toBe(1)
    expect(cards()).toEqual([
      {
        side: 'server',
        name: 'game.state.round',
        message: 'game.state.round is the round itself. Use game.newRound(), or pick another name for your key.'
      }
    ])
  })
})

describe('harness scenario: spam', () => {
  it('a flooding player is throttled per name; another player is untouched', async () => {
    let handled = 0
    world.server.onRequest('hit', () => {
      handled += 1
      return handled
    }, 'gun.ts')
    const spammer = world.join('0xspam')
    const honest = world.join('0xok')

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => spammer.request('hit', {}))
    )
    const rejected = results.filter((r) => r.status === 'rejected').length
    expect(rejected).toBeGreaterThan(0) // bucket empties inside one window
    const spamHandled = handled

    const ok = await honest.request('hit', {})
    expect(ok).toBe(spamHandled + 1) // the honest player's request landed
  })

  it('rate recovered after the window moves on', async () => {
    world.server.onRequest('hit', () => 'ok', 'gun.ts')
    const p = world.join('0xp')
    await Promise.allSettled(Array.from({ length: 20 }, () => p.request('hit', {})))
    world.tick(2000)
    await expect(p.request('hit', {})).resolves.toBe('ok')
  })
})

describe('harness scenario: crash containment', () => {
  it('a handler that throws surfaces a [server] card, rejects the asker, and the queue survives', async () => {
    const processed: number[] = []
    let n = 0
    world.server.onRequest('step', () => {
      n += 1
      if (n === 3) throw new Error('boom on 3')
      processed.push(n)
      return n
    }, 'steps.ts')
    const ana = world.join('0xana')

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => ana.request('step', {}))
    )
    expect(results[2].status).toBe('rejected')
    expect(processed).toEqual([1, 2, 4, 5, 6])
    expect(world.errors).toContainEqual({
      side: 'server',
      name: 'step',
      message: 'steps.ts: boom on 3'
    })
  })
})

describe('harness scenario: duplicate (check-then-act inside one handler is atomic)', () => {
  it('two simultaneous requests with an await inside the handler cannot double-claim', async () => {
    let claimed = false
    const winners: Player[] = []
    world.server.onRequest('claim', async (_d, player) => {
      if (claimed) return { ok: false }
      await Promise.resolve() // the await that races detached-async dispatch
      claimed = true
      winners.push(player)
      return { ok: true }
    }, 'pickup.ts')

    const ana = world.join('0xana')
    const bo = world.join('0xbo')
    const [a, b] = await Promise.all([ana.request('claim', {}), bo.request('claim', {})])
    expect([a, b].filter((r) => (r as { ok: boolean }).ok)).toHaveLength(1)
    expect(winners).toHaveLength(1)
  })
})

describe('harness scenario: restart', () => {
  it('a fresh server core has no handlers from the old run', async () => {
    world.server.onRequest('openChest', () => ({ ok: true }), 'chest.ts')
    const ana = world.join('0xana')
    await ana.request('openChest', {})

    world.restartServer()
    await expect(ana.request('openChest', {})).rejects.toThrow(GameNameError)

    world.server.onRequest('openChest', () => ({ ok: true, round: 2 }), 'chest.ts')
    await expect(ana.request('openChest', {})).resolves.toEqual({ ok: true, round: 2 })
  })
})

describe('harness budgets', () => {
  it('payloads over the core cap are rejected before the handler', async () => {
    let reached = false
    world.server.onRequest('mid', () => {
      reached = true
      return {}
    }, 'mid.ts')
    const ana = world.join('0xana')
    const mid = { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) }
    await expect(ana.request('mid', mid)).rejects.toThrow('carries too much data')
    expect(reached).toBe(false)
  })
})

describe('harness scenario: shared facts (game.state)', () => {
  it('a server write lands on every client and each key publishes on its own', async () => {
    const ana = world.join('0xana')
    const changes: Record<string, unknown>[] = []
    ana.onStateChange((c) => changes.push(c))
    world.server.onRequest('open', () => {
      world.server.setState({ doorOpen: true, score: 1 })
      return {}
    }, 'door.ts')

    await ana.request('open', {})
    expect(ana.state.doorOpen).toBe(true)
    expect(ana.state.score).toBe(1)
    expect(world.facts.size).toBe(3) // per-key sharding: two creator facts + the module's round
    expect(changes).toEqual([{ doorOpen: true }, { score: 1 }])
  })

  it('writes to one key in one handler coalesce to one publish, last value wins', async () => {
    world.server.onRequest('spin', () => {
      for (let i = 0; i < 10; i++) world.server.setState({ n: i })
      return {}
    }, 'spin.ts')
    const ana = world.join('0xana')
    await ana.request('spin', {})
    expect(world.facts.get('n')).toEqual({ json: '9', rev: 1 })
    expect(ana.state.n).toBe(9)
  })

  it('a late joiner reads the current facts with zero messages', async () => {
    world.server.onRequest('open', () => {
      world.server.setState({ doorOpen: true })
      return {}
    }, 'door.ts')
    const ana = world.join('0xana')
    await ana.request('open', {})

    const late = world.join('0xlate')
    expect(late.state.doorOpen).toBe(true)
  })

  it('a handler reads its own writes before the flush', async () => {
    let seen: unknown = null
    world.server.onRequest('two', () => {
      world.server.setState({ a: 1 })
      seen = world.server.state.a
      return {}
    }, 'two.ts')
    await world.join('0xana').request('two', {})
    expect(seen).toBe(1)
  })

  it('an oversized key warns but still ships', async () => {
    world.server.onRequest('big', () => {
      world.server.setState({ blob: 'x'.repeat(5000) })
      return {}
    }, 'big.ts')
    const ana = world.join('0xana')
    await ana.request('big', {})
    expect(world.warnings[0]).toContain('game.state.blob')
    expect((ana.state.blob as string).length).toBe(5000)
  })

  it('the boot wipe: stale facts leave the snapshot, every mirror, and every late joiner', async () => {
    world.server.onRequest('open', () => {
      world.server.setState({ doorOpen: true })
      return {}
    }, 'door.ts')
    const ana = world.join('0xana')
    await ana.request('open', {})
    expect(ana.state.doorOpen).toBe(true)

    world.restartServer() // auto-boots: adopt → retire → onReady (none) → round 1 → open
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect([...world.facts.keys()]).toEqual(['round']) // no zombie facts, only the fresh round
    expect('doorOpen' in ana.state).toBe(false) // the connected client dropped it
    const late = world.join('0xlate')
    expect('doorOpen' in late.state).toBe(false)
  })
})

// Deleting the dynamic server-span counter legalises setState from a plain server
// update(), which is ~41 writes per key per second with nothing else in this
// path to stop them. The budget coalesces instead of dropping: the newest value
// always ships.
describe('harness scenario: the publish budget', () => {
  it('a key written every frame publishes at its budget and still ends on the newest value', () => {
    for (let frame = 0; frame < 40; frame++) {
      world.server.setState({ hp: frame })
      world.server.flushState() // the server tick, ~41 Hz, no clock movement
    }
    expect(world.facts.get('hp')?.rev).toBe(PUBLISH_PER_KEY_PER_S)
    expect(cards().find((e) => e.name === 'state.hp')?.message).toContain(
      `changes more than ${PUBLISH_PER_KEY_PER_S} times a second`
    )

    // the frames keep coming; a second later the newest value ships, and the
    // card does not repeat
    world.tick(1000)
    world.server.setState({ hp: 99 })
    world.server.flushState()
    expect(world.facts.get('hp')?.json).toBe('99')
    expect(cards().filter((e) => e.name === 'state.hp')).toHaveLength(1)
  })

  // Health & Respawn broadcasts RESPAWN to one player at a time. Keyed by name
  // alone, a wave of deaths in one frame would coalesce onto one held payload
  // and every player but the last would stand there un-respawned.
  it('a per-player broadcast is budgeted per player, so one death never eats another', () => {
    const got: Record<string, unknown[]> = { '0xana': [], '0xbo': [] }
    const ana = world.join('0xana')
    const bo = world.join('0xbo')
    ana.onBroadcast('respawn', (d) => void got['0xana'].push(d))
    bo.onBroadcast('respawn', (d) => void got['0xbo'].push(d))

    world.server.broadcast('respawn', { at: 'gate' }, '0xana')
    world.server.broadcast('respawn', { at: 'gate' }, '0xbo')

    expect(got['0xana']).toEqual([{ at: 'gate' }])
    expect(got['0xbo']).toEqual([{ at: 'gate' }])
  })

  it('the budget is per key, so a busy key never starves a quiet one', () => {
    for (let frame = 0; frame < 40; frame++) {
      world.server.setState({ hp: frame })
      world.server.flushState()
    }
    world.server.setState({ podium: ['ana'] })
    world.server.flushState()
    expect(world.facts.get('podium')?.json).toBe('["ana"]')
  })
})

describe('harness scenario: boot pipeline', () => {
  it('fresh onReady state outruns the stale copy a connected client still holds', async () => {
    world.server.onRequest('open', () => {
      world.server.setState({ doorOpen: true })
      return {}
    }, 'door.ts')
    const ana = world.join('0xana')
    await ana.request('open', {})

    const fresh = world.restartServer({ boot: false })
    fresh.onReady(() => fresh.setState({ doorOpen: false }))
    await world.bootServer()

    expect(ana.state.doorOpen).toBe(false) // rev outran the stale mirror
    expect(world.facts.get('doorOpen')?.json).toBe('false')
  })

  it('requests queue while the server wakes and resolve after boot', async () => {
    const fresh = world.restartServer({ boot: false })
    fresh.onRequest('hello', () => ({ up: true }), 'greeter.ts')
    const ana = world.join('0xana')

    let settled = false
    const pending = ana.request('hello', {}).then((r) => {
      settled = true
      return r
    })
    await Promise.resolve()
    expect(settled).toBe(false) // waking: nothing dispatched yet

    await world.bootServer()
    await expect(pending).resolves.toEqual({ up: true })
  })

  it('onReady runs once, after saved has loaded, and a throwing hook never blocks boot', async () => {
    world.savedStore.set('highScore', '40')
    const fresh = world.restartServer({ boot: false })
    let runs = 0
    let savedSeen: unknown
    fresh.onReady(() => {
      runs += 1
      savedSeen = fresh.saved.get('highScore') // the whole reason this hook exists
      fresh.setState({ score: 0 })
    })
    fresh.onReady(() => {
      throw new Error('bad hook')
    })
    await world.bootServer()
    await world.bootServer() // idempotent

    expect(runs).toBe(1)
    expect(savedSeen).toBe(40)
    expect(world.facts.get('score')?.json).toBe('0')
    expect(world.errors).toContainEqual({ side: 'server', name: 'onReady', message: 'bad hook' })
  })
})

describe('harness scenario: durable memory (saved + playerData)', () => {
  it('playerData written before a restart reads back after boot, and set patches the record', async () => {
    world.server.onRequest('collect', (_d, player) => {
      const data = world.server.playerData(player)
      data.set({ coins: Number(data.get().coins ?? 0) + 1 })
      return {}
    }, 'coin.ts')
    world.server.onRequest('rename', (_d, player) => {
      world.server.playerData(player).set({ name: 'ana' })
      return {}
    }, 'coin.ts')
    const ana = world.join('0xana')
    await ana.request('collect', {})
    await ana.request('collect', {})
    await ana.request('rename', {}) // a later patch keeps earlier keys

    const fresh = world.restartServer({ boot: false })
    let record: Record<string, unknown> | null = null
    fresh.onRequest('check', (_d, player) => {
      record = fresh.playerData(player).get()
      return {}
    }, 'coin.ts')
    await world.bootServer()
    await ana.request('check', {})
    expect(record).toEqual({ coins: 2, name: 'ana' })
  })

  it('the §5 lifetimes in one restart: state is wiped, saved survives', async () => {
    world.server.onRequest('win', () => {
      world.server.setState({ score: 3 })
      world.server.saved.set('highScore', 40)
      return {}
    }, 'flow.ts')
    const ana = world.join('0xana')
    await ana.request('win', {})
    expect(ana.state.score).toBe(3)

    const fresh = world.restartServer({ boot: false })
    let savedSeen: unknown
    fresh.onReady(() => {
      savedSeen = fresh.saved.get('highScore')
    })
    await world.bootServer()

    expect('score' in ana.state).toBe(false) // state: until the server sleeps
    expect([...world.facts.keys()]).toEqual(['round'])
    expect(savedSeen).toBe(40) // saved: survives restarts and re-publishes
  })

  it('the per-player cap reports and leaves the record and storage untouched', async () => {
    world.server.onRequest('hoard', (_d, player) => {
      world.server.playerData(player).set({ blob: 'x'.repeat(PLAYER_DATA_CAP_BYTES + 1) })
      return {}
    }, 'hoard.ts')
    world.server.onRequest('peek', (_d, player) => world.server.playerData(player).get(), 'hoard.ts')
    const ana = world.join('0xana')

    await expect(ana.request('hoard', {})).resolves.toEqual({}) // reported, not thrown
    expect(world.errors.map((e) => e.message)).toContainEqual(
      expect.stringContaining('Store fewer keys per player')
    )
    expect(world.playerStorage.has('0xana')).toBe(false) // the write never landed
    await expect(ana.request('peek', {})).resolves.toEqual({})
  })

  it('onReady copies saved into state — the continuity idiom', async () => {
    world.server.onRequest('finish', () => {
      world.server.saved.set('topTimes', [12.3])
      return {}
    }, 'board.ts')
    const ana = world.join('0xana')
    await ana.request('finish', {})

    const fresh = world.restartServer({ boot: false })
    fresh.onReady(() => fresh.setState({ leaderboard: fresh.saved.get('topTimes') }))
    await world.bootServer()

    expect(ana.state.leaderboard).toEqual([12.3])
    const late = world.join('0xlate')
    expect(late.state.leaderboard).toEqual([12.3])
  })
})

describe('harness scenario: rounds', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('round 1 starts at boot; newRound bumps the number, reseeds, and runs onRoundStart once per round', async () => {
    const fresh = world.restartServer({ boot: false })
    const starts: number[] = []
    fresh.onRoundStart((round) => {
      starts.push(round.number)
      fresh.setState({ score: 0 })
    })
    fresh.onRequest('next', () => fresh.newRound(), 'flow.ts')
    await world.bootServer()
    expect(starts).toEqual([1])

    const ana = world.join('0xana')
    const first = ana.state.round as RoundInfo
    expect(first.number).toBe(1)

    await ana.request('next', {})
    await settle() // onRoundStart is deferred a microtask past the caller's own work
    expect(starts).toEqual([1, 2])
    const second = ana.state.round as RoundInfo
    expect(second.number).toBe(2)
    expect(second.seed).not.toBe(first.seed) // reseeded from the server-private stash
    expect(ana.state.score).toBe(0)
  })

  it('every onRoundStart hook can still write state when a handler started the round', async () => {
    const fresh = world.restartServer({ boot: false })
    const wrote: string[] = []
    const failures: string[] = []
    for (const who of ['flow', 'results']) {
      fresh.onRoundStart(async (round) => {
        await Promise.resolve()
        try {
          fresh.setState({ [who]: round.number })
          wrote.push(who)
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e))
        }
      })
    }
    fresh.onRequest('next', () => fresh.newRound(), 'flow.ts')
    await world.bootServer()
    const ana = world.join('0xana')
    wrote.length = 0

    await ana.request('next', {})
    await settle()
    await settle()
    expect(failures).toEqual([])
    expect(wrote).toEqual(['flow', 'results'])
    expect(ana.state.results).toBe(2)
  })

  it('a round id never repeats across a wake, though the number counts from 1 again', async () => {
    await settle() // the world's own boot: round 1
    const before = world.server.round
    expect(before.number).toBe(1)
    expect(before.id.endsWith('-1')).toBe(true)

    // the server slept and woke: the isolate is new, the snapshot and the
    // storage are not
    world.tick(45_000)
    world.restartServer()
    await settle()
    const after = world.server.round

    expect(after.number).toBe(1) // honestly per wake
    expect(after.id).not.toBe(before.id) // and never the same round twice
  })

  it('a token kept past the sleep is not mistaken for this round', async () => {
    // the tower-of-madness shape: the gate stamps the attempt, the finish
    // compares it — but this record is durable and the round it names is not
    const arm = (core: GameCore): void => {
      core.onRequest('gate', (_data, player) => core.playerData(player).set({ attempt: core.round.id }), 'race.ts')
      core.onRequest(
        'finish',
        (_data, player) => {
          const attempt = core.playerData(player).get().attempt
          return { ok: typeof attempt === 'string' && attempt === core.round.id }
        },
        'race.ts'
      )
    }
    arm(world.server)
    const ana = world.join('0xana')
    await settle()
    await ana.request('gate', {})
    expect(await ana.request('finish', {})).toEqual({ ok: true })

    world.tick(45_000)
    arm(world.restartServer({ boot: false }))
    await world.bootServer()

    expect(world.server.round.number).toBe(1) // the number the attempt would have held
    expect(await ana.request('finish', {})).toEqual({ ok: false })
  })

  it('a late joiner reads the current round from the snapshot — arithmetic, not replay', async () => {
    world.server.onRequest('next', () => world.server.newRound(), 'flow.ts')
    const ana = world.join('0xana')
    await ana.request('next', {})
    await ana.request('next', {})
    await ana.request('next', {})

    const late = world.join('0xlate')
    expect((late.state.round as RoundInfo).number).toBe(4)
    expect(late.round.number).toBe(4) // game.round — read anywhere
  })

  it('two clients derive byte-identical layout plans from one tuple, and sibling layouts get their own stream', () => {
    const planFn = (rng: () => number) =>
      Array.from({ length: 20 }, () => ({ x: rng() * 14 + 1, y: 0, z: rng() * 14 + 1 }))
    const seed = 12345
    const a = planFn(createRng(layoutSeed(seed, 'rock')))
    const b = planFn(createRng(layoutSeed(seed, 'rock')))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    const tree = planFn(createRng(layoutSeed(seed, 'tree')))
    expect(JSON.stringify(tree)).not.toBe(JSON.stringify(a))
  })
})

describe('core primitives', () => {
  it('token bucket refills with time', () => {
    const limiter = new RateLimiter(2)
    expect(limiter.allow('n', 'p', 0)).toBe(true)
    expect(limiter.allow('n', 'p', 0)).toBe(true)
    expect(limiter.allow('n', 'p', 0)).toBe(false)
    expect(limiter.allow('n', 'p', 1000)).toBe(true)
  })
})

describe('regressions the first review found', () => {
  it('reading a departed player s data is ordinary, not an error that aborts the caller', async () => {
    const ana = world.join('0xana')
    world.server.onRequest('score', (_d, player) => {
      world.server.playerData(player).set({ points: 10 })
      return {}
    }, 'score.ts')
    await ana.request('score', {})

    world.server.presentPlayers([]) // ana logs off mid-round
    await Promise.resolve()

    const after: unknown[] = []
    world.server.onRequest('close', () => {
      // a round-end tally reads every finisher, including the one who left
      after.push(world.server.playerData('0xana').get().points)
      after.push('reached the end')
      return {}
    }, 'round.ts')
    await world.join('0xbo').request('close', {})
    expect(after[1]).toBe('reached the end')
  })

  it('a value that cannot be shared costs one key, not the whole server', async () => {
    world.server.onRequest('mixed', () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      world.server.setState({ good: 1, bad: cyclic })
      return {}
    }, 'mixed.ts')
    const ana = world.join('0xana')
    await ana.request('mixed', {})

    expect(ana.state.good).toBe(1) // the healthy key still published
    expect(world.errors.some((e) => e.name === 'state.bad')).toBe(true)
    // and the next flush is clean — the bad key did not wedge publishing
    world.server.onRequest('again', () => {
      world.server.setState({ good: 2 })
      return {}
    }, 'again.ts')
    await ana.request('again', {})
    expect(ana.state.good).toBe(2)
  })

  it('a burst of requests from one player costs one storage read, not one each', async () => {
    world.server.onRequest('ping', (_d, player) => {
      world.server.playerData(player).get()
      return {}
    }, 'ping.ts')
    const fresh = new GameCore({ ...world['portsFor']('0xnew') })
    world.clients.set('0xnew', fresh)
    // five requests land in one tick before any restore resolves — the
    // host-call budget is scene-wide, so N concurrent reads would starve
    // every player
    await Promise.all(Array.from({ length: 5 }, () => fresh.request('ping', {})))
    expect(world.loads.get('0xnew') ?? 0).toBeLessThanOrEqual(1)
  })
})

describe('regressions the second review found', () => {
  it('a player who leaves is dropped from the transport too, so a busy room costs the room', async () => {
    world.join('0xana')
    world.server.presentPlayers(['0xana'])
    await Promise.resolve()
    expect(world.dropped).toEqual([])

    world.server.presentPlayers([])
    await Promise.resolve()
    expect(world.dropped).toEqual(['0xana'])
  })

  it('a write for a departed player lands on top of what they had, never over it', async () => {
    world.playerStorage.set('0xana', JSON.stringify({ points: 4200, best: 11.2, crown: true }))
    const ana = world.join('0xana')
    world.server.presentPlayers(['0xana'])
    await Promise.resolve()
    world.server.onRequest('tally', () => {
      world.server.playerData('0xana').set({ points: 100 })
      return {}
    }, 'round.ts')
    await ana.request('tally', {})
    expect(JSON.parse(world.playerStorage.get('0xana') ?? '{}')).toEqual({
      points: 100,
      best: 11.2,
      crown: true
    })

    // they log off, then a late round-end tally names them again
    world.server.presentPlayers([])
    await Promise.resolve()
    const bo = world.join('0xbo')
    await bo.request('tally', {})

    await Promise.resolve()
    await Promise.resolve()
    // the award still lands, and the season total earned over months survives
    expect(JSON.parse(world.playerStorage.get('0xana') ?? '{}')).toEqual({
      points: 100,
      best: 11.2,
      crown: true
    })
  })

  it('a zone name nobody listens to is refused before anything is allocated', async () => {
    const seen: Player[] = []
    world.server.onEnterArea('Start', (p) => void seen.push(p))
    // every placed area is watched by the client now, so claims for areas no
    // script listens to are ordinary — they must still cost nothing
    for (let i = 0; i < 50; i++) {
      const reply = await world.server.zoneClaim(`ghost-${i}`, 'enter', '0xmallory')
      expect(reply.ok).toBe(false)
    }
    expect(seen).toEqual([])
  })

  it('one failing publish costs its key, not every later request on that name', async () => {
    world.server.onRequest('bump', (data) => {
      world.server.setState({ n: (data as { n: number }).n })
      return 'ok'
    }, 'bump.ts')
    const ana = world.join('0xana')
    // make the transport reject one publish, the way a deleted entity would
    const facts = world.facts
    const original = facts.set.bind(facts)
    facts.set = ((key: string, value: { json: string; rev: number }) => {
      if (value.json === '1') throw new Error('entity gone')
      return original(key, value)
    }) as typeof facts.set

    await expect(ana.request('bump', { n: 1 })).resolves.toBe('ok')
    facts.set = original
    // the next request on the same name still reaches its handler
    await expect(ana.request('bump', { n: 2 })).resolves.toBe('ok')
    expect(ana.state.n).toBe(2)
  })
})

// Awarding a player who is not in memory is the round-end tally's normal case,
// and the record it writes reaches storage BEHIND a debounce. Reading storage
// again for the next award would answer with the pre-award record, so the two
// awards have to compose in memory instead.
describe('regression: two awards for a player who is not in memory', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('both land — the second never replaces the first', async () => {
    world.writeBehind = true
    world.playerStorage.set('0xana', JSON.stringify({ crown: true }))
    await settle() // the world's own boot

    world.server.playerData('0xana').set({ coins: 5 })
    await settle() // the read resolves; the write only reaches the buffer
    world.server.playerData('0xana').set({ gems: 1 })
    await settle()
    world.flushPlayerStorage()

    expect(JSON.parse(world.playerStorage.get('0xana') ?? '{}')).toEqual({ crown: true, coins: 5, gems: 1 })
    expect(world.loads.get('0xana')).toBe(1) // one read per player, not per write
  })

  it('an award queued as they walk back in survives the restore', async () => {
    world.writeBehind = true
    world.playerStorage.set('0xana', JSON.stringify({ crown: true }))
    await settle()

    world.server.playerData('0xana').set({ coins: 5 }) // their read is in flight
    world.join('0xana') // and they are back, which reads their record too
    await settle()
    await settle()
    world.flushPlayerStorage()
    expect(JSON.parse(world.playerStorage.get('0xana') ?? '{}')).toEqual({ crown: true, coins: 5 })

    // and the record now in memory carries the award, so the next write keeps it
    world.server.playerData('0xana').set({ gems: 1 })
    world.flushPlayerStorage()
    expect(JSON.parse(world.playerStorage.get('0xana') ?? '{}')).toEqual({ crown: true, coins: 5, gems: 1 })
  })
})


// A broadcast written in a server update() is ~41 messages a second on one
// name, and the room's own budget is ~40 a second for everything. The budget
// coalesces like the state path: the newest payload always ships.
describe('harness scenario: the broadcast budget', () => {
  it('a name broadcast every frame ships at its budget and reports once', () => {
    const heard: unknown[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('ghostTouching', (d) => void heard.push(d))

    for (let frame = 0; frame < 40; frame++) {
      world.server.broadcast('ghostTouching', { frame })
      world.server.flushState() // the server tick
    }
    expect(heard).toHaveLength(PUBLISH_PER_KEY_PER_S)
    expect(cards().find((c) => c.name === 'broadcast.ghostTouching')?.message).toBe(
      "'ghostTouching' is sent more than 8 times a second, so the server is sending only the newest one. " +
        'Send it on a timer with game.every, or send it once when it starts and once when it stops.'
    )

    // a second later the newest payload ships, and the card does not repeat
    world.tick(1000)
    world.server.flushState()
    expect(heard[heard.length - 1]).toEqual({ frame: 39 })
    expect(cards().filter((c) => c.name === 'broadcast.ghostTouching')).toHaveLength(1)
  })

  it('the budget is per name, so a busy name never starves a quiet one', () => {
    const heard: string[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('tick', () => void heard.push('tick'))
    ana.onBroadcast('roundOver', () => void heard.push('roundOver'))

    for (let frame = 0; frame < 40; frame++) world.server.broadcast('tick', { frame })
    world.server.broadcast('roundOver', { top: 'ana' })
    expect(heard.filter((n) => n === 'roundOver')).toHaveLength(1)
  })

  it('a targeted broadcast keeps its target when it waits for a token', () => {
    const heard: Record<string, unknown[]> = { '0xana': [], '0xbo': [] }
    const ana = world.join('0xana')
    const bo = world.join('0xbo')
    ana.onBroadcast('whisper', (d) => void heard['0xana'].push(d))
    bo.onBroadcast('whisper', (d) => void heard['0xbo'].push(d))

    for (let n = 0; n < 12; n++) world.server.broadcast('whisper', { n }, '0xbo')
    world.tick(1000)
    world.server.flushState()
    expect(heard['0xana']).toEqual([])
    expect(heard['0xbo'][heard['0xbo'].length - 1]).toEqual({ n: 11 })
  })
})

describe('harness: too much data is refused where the creator can see it', () => {
  // The number in the sentence has to be the one that actually refuses it, or a
  // creator trims to the figure they were given and is refused a second time.
  it('a request names the cap that refuses it, not the looser one', async () => {
    let reached = false
    world.server.onRequest('upload', () => {
      reached = true
      return {}
    }, 'upload.ts')
    const ana = world.join('0xana')
    await expect(ana.request('upload', { blob: 'x'.repeat(MAX_PAYLOAD_BYTES) })).rejects.toThrow(
      `'upload' carries too much data — send less than ${MAX_PAYLOAD_BYTES} bytes.`
    )
    expect(reached).toBe(false)
    expect(world.budget.oversized).toEqual([]) // it never reached the transport's silent drop
  })

  // Between the two caps: the server would have refused this, so the client must too.
  it('a request between the two caps is refused by the client, with the server’s number', async () => {
    const ana = world.join('0xana')
    await expect(ana.request('upload', { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 1000) })).rejects.toThrow(
      `send less than ${MAX_PAYLOAD_BYTES} bytes.`
    )
  })

  it('a broadcast over the send cap reports instead of vanishing', () => {
    const heard: unknown[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('podium', (d) => void heard.push(d))
    world.server.broadcast('podium', { blob: 'x'.repeat(MAX_SEND_BYTES) })
    expect(heard).toEqual([])
    expect(cards()).toContainEqual({
      side: 'server',
      name: 'game.broadcast:podium',
      message: "'podium' carries too much data — send less than 12000 bytes."
    })
  })
})

// Two prefabs reacting to one server moment is the normal case in a composed
// scene, and neither of them owns the name.
describe('harness: every listener hears a broadcast', () => {
  it('two listeners on one name both fire, in registration order', () => {
    const order: string[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('shellDropped', () => void order.push('projectile'))
    ana.onBroadcast('shellDropped', () => void order.push('hand'))
    world.server.broadcast('shellDropped', { by: '0xana' })
    expect(order).toEqual(['projectile', 'hand'])
    expect(world.errors).toEqual([]) // nothing to rename: two scripts, one moment
  })

  it('a listener that throws costs its own moment, never the next listener s', () => {
    const heard: unknown[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('flagImmunity', () => {
      throw new Error('shield model missing')
    })
    ana.onBroadcast('flagImmunity', (d) => void heard.push(d))
    world.server.broadcast('flagImmunity', { on: true })
    expect(heard).toEqual([{ on: true }])
    expect(cards()).toContainEqual({ side: 'you', name: 'flagImmunity', message: 'shield model missing' })
  })

  it('the returned function detaches one listener and leaves the other listening', () => {
    const heard: string[] = []
    const ana = world.join('0xana')
    const stop = ana.onBroadcast('goal', () => void heard.push('clone'))
    ana.onBroadcast('goal', () => void heard.push('hud'))

    world.server.broadcast('goal', {})
    stop()
    world.server.broadcast('goal', {})
    expect(heard).toEqual(['clone', 'hud', 'hud'])
  })
})

describe('harness: the anti-abuse guard stays quieter than the traffic it drops', () => {
  it('a flooded name reports once per player, not once per dropped request', async () => {
    world.server.onRequest('hit', () => 'ok', 'gun.ts')
    const spammer = world.join('0xspam')
    const other = world.join('0xalso')
    await Promise.allSettled(Array.from({ length: 30 }, () => spammer.request('hit', {})))
    await Promise.allSettled(Array.from({ length: 30 }, () => other.request('hit', {})))

    const dropped = world.errors.filter((c) => c.message.includes('too many per second'))
    expect(dropped).toHaveLength(2)
    expect(dropped.map((c) => c.side)).toEqual(['server', 'server'])
  })
})

describe('regression: a held broadcast keeps its place in line', () => {
  it('a payload waiting for a token is never overtaken by a newer one', () => {
    const heard: number[] = []
    const ana = world.join('0xana')
    ana.onBroadcast('score', (d) => void heard.push((d as { n: number }).n))

    for (let n = 0; n < 12; n++) world.server.broadcast('score', { n }) // 0..7 ship, 11 waits
    world.tick(1000) // tokens refill, but the flush has not run yet
    world.server.broadcast('score', { n: 99 })
    world.server.flushState()
    expect(heard).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 99])
  })
})
