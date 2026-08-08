import { describe, expect, it, beforeEach } from 'vitest'
import {
  GameCore,
  GameNameError,
  GameDirectionError,
  RateLimiter,
  jsonDepth,
  layoutSeed,
  MAX_PAYLOAD_BYTES,
  PLAYER_DATA_CAP_BYTES,
  type CorePorts,
  type ErrorCard,
  type Player,
  type RoundInfo
} from '../runtime-modules/pure/gameCore'
import { createRng } from '../runtime-modules/pure/rng'

// The multi-peer world simulator: one game core + N screen cores wired through
// a simulated transport with the real budgets. This is the harness the shipping
// plan's PR 1 calls for — in-process and deterministic; the real-engine legs
// live in validate/probe-*.mjs. The transport mimics what the engine gives us:
// reliable + ordered per sender, targeted delivery enforced (a non-target never
// receives), size- and rate-budgeted (over-budget = silently dropped, which is
// what the retry layers exist for — here the budget tracker makes drops loud).

const MSG_BYTE_LIMIT = 13_000
const INBOUND_PER_PEER_PER_S = 300

interface BudgetLog {
  oversized: Array<{ name: string; bytes: number }>
  rateDropped: Array<{ from: string; name: string }>
}

class World {
  server: GameCore
  screens = new Map<Player, GameCore>()
  errors: ErrorCard[] = []
  warnings: string[] = []
  budget: BudgetLog = { oversized: [], rateDropped: [] }
  // The CRDT model: facts survive server restarts (the snapshot outlives the
  // isolate) and are replayed to every late joiner on connect.
  facts = new Map<string, { json: string; rev: number }>()
  // The Storage model: unlike facts — which boot retires — these survive both
  // the restart AND the boot wipe. JSON strings, so the serialization boundary
  // is real: a reference mutated after set never reaches storage.
  savedStore = new Map<string, string>()
  playerStorage = new Map<Player, string>()
  // host calls are a scene-wide budget: blowing it makes every player's writes
  // fail, so the harness counts them
  loads = new Map<Player, number>()
  private clock = 1_000_000
  private inbound = new Map<string, { count: number; windowStart: number }>()
  private drawnSeeds = 0

  constructor() {
    this.server = new GameCore(this.portsFor('server'))
    this.server.setRole(true)
    void this.server.bootServer([]) // a fresh world wakes with an empty snapshot
  }

  adoptedFacts(): Array<{ key: string; json: string; rev: number }> {
    return [...this.facts].map(([key, f]) => ({ key, json: f.json, rev: f.rev }))
  }

  bootServer(): Promise<void> {
    return this.server.bootServer(this.adoptedFacts(), [...this.screens.keys()])
  }

  now(): number {
    return this.clock
  }

  tick(ms: number): void {
    this.clock += ms
  }

  join(player: Player): GameCore {
    const core = new GameCore(this.portsFor(player))
    core.setRole(false)
    this.screens.set(player, core)
    // late joiner: the snapshot delivers every current fact, no messages —
    // and the game restores their durable record before any handler of
    // theirs can run (the SDK half awaits this; here the load is a microtask
    // that resolves before any ask's FIFO dispatch)
    void this.server.restorePlayerData(player)
    for (const [key, f] of this.facts) core.applyFact(key, f.json, f.rev)
    return core
  }

  restartServer(opts?: { boot?: boolean }): GameCore {
    // the snapshot and the storage survive; only the isolate dies
    this.server = new GameCore(this.portsFor('server'))
    this.server.setRole(true)
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
      sendAsk: async (name, json) => {
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
        return this.server.handleAsk(name, json, peer)
      },
      sendTell: (name, json, to) => {
        const bytes = name.length + json.length
        if (bytes > MSG_BYTE_LIMIT) {
          this.budget.oversized.push({ name, bytes })
          return
        }
        for (const [player, core] of this.screens) {
          if (to !== undefined && player !== to) continue
          core.handleTell(name, json)
        }
      },
      publishFact: (key, json, rev) => {
        if (peer !== 'server') throw new Error('only the game publishes facts')
        this.facts.set(key, { json, rev })
        for (const core of this.screens.values()) core.applyFact(key, json, rev)
      },
      retireFact: (key, rev) => {
        if (peer !== 'server') throw new Error('only the game retires facts')
        this.facts.delete(key)
        for (const core of this.screens.values()) core.applyRetire(key, rev)
      },
      emitError: (card) => this.errors.push(card),
      devWarn: (message) => this.warnings.push(message),
      loadSaved: async () => {
        if (peer !== 'server') throw new Error('only the game loads saved data')
        return Object.fromEntries([...this.savedStore].map(([k, json]) => [k, JSON.parse(json)]))
      },
      storeSaved: (key, value) => {
        if (peer !== 'server') throw new Error('only the game stores saved data')
        this.savedStore.set(key, JSON.stringify(value ?? null))
      },
      loadPlayerData: async (player) => {
        if (peer !== 'server') throw new Error('only the game loads player data')
        this.loads.set(player, (this.loads.get(player) ?? 0) + 1)
        const json = this.playerStorage.get(player)
        return json === undefined ? {} : JSON.parse(json)
      },
      storePlayerData: (player, data) => {
        if (peer !== 'server') throw new Error('only the game stores player data')
        this.playerStorage.set(player, JSON.stringify(data))
      },
      // Presence and zones are exercised through the SDK half's engine wiring
      // (game-module.test.ts); this world is write-through, so the leave-time
      // flush has nothing left to do.
      flushPlayerData: () => {},
      findZones: () => [],
      playerPosition: () => null,
      // deterministic stand-in for the SDK half's serverState stash
      takeNextSeed: () => {
        if (peer !== 'server') throw new Error('only the game draws round seeds')
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

describe('harness: ask/tell across one game and two screens', () => {
  it('a screen asks, the green handler decides once, the reply returns to the asker only', async () => {
    const seen: Array<{ data: unknown; player: Player }> = []
    world.server.onMessage('openChest', (data, player) => {
      seen.push({ data, player })
      return { ok: true, gold: 5 }
    }, 'chest.ts')

    const ana = world.join('0xana')
    world.join('0xbo')

    const reply = await ana.send('openChest', { chest: 517 })
    expect(reply).toEqual({ ok: true, gold: 5 })
    expect(seen).toEqual([{ data: { chest: 517 }, player: '0xana' }])
  })

  it('the game tells every screen; {to} reaches only the target', () => {
    const got: Record<string, unknown[]> = { '0xana': [], '0xbo': [] }
    const ana = world.join('0xana')
    const bo = world.join('0xbo')
    ana.onMessage('goal', (d) => void got['0xana'].push(d), 'hud.ts')
    bo.onMessage('goal', (d) => void got['0xbo'].push(d), 'hud.ts')
    ana.onMessage('whisper', (d) => void got['0xana'].push(d), 'hud.ts')
    bo.onMessage('whisper', (d) => void got['0xbo'].push(d), 'hud.ts')

    void world.server.send('goal', { by: '0xana' })
    void world.server.send('whisper', { text: 'psst' }, { to: '0xbo' })

    expect(got['0xana']).toEqual([{ by: '0xana' }])
    expect(got['0xbo']).toEqual([{ by: '0xana' }, { text: 'psst' }])
  })

  it('identity is the connection, never the payload', async () => {
    let seenPlayer = ''
    world.server.onMessage('pray', (data, player) => {
      seenPlayer = player
      return { ok: true }
    }, 'shrine.ts')
    const mallory = world.join('0xmallory')
    await mallory.send('pray', { player: '0xvictim' })
    expect(seenPlayer).toBe('0xmallory')
  })
})

describe('harness: direction and name rules', () => {
  it("a typo'd name rejects loudly, naming the closest real handler", async () => {
    world.server.onMessage('openChest', () => ({}), 'chest.ts')
    const ana = world.join('0xana')
    await expect(ana.send('opnChest', {})).rejects.toThrow("Closest match: 'openChest'")
  })

  it('a screen cannot ask a name the game sends — and the refusal leaves the name usable', async () => {
    const heard: unknown[] = []
    const ana = world.join('0xana')
    ana.onMessage('roundOver', (d) => void heard.push(d), 'hud.ts')
    world.server.onMessage('roundOver', () => ({ pwned: true }), 'hud.ts')
    await world.server.send('roundOver', { top: 'ana' })

    // a forged packet naming a screen-side message must not run in the game...
    await expect(world.server.handleAsk('roundOver', '{}', '0xmallory')).rejects.toThrow(
      "is sent by the game"
    )
    // ...nor poison the name: the game still reaches every screen afterwards
    await world.server.send('roundOver', { top: 'bo' })
    expect(heard).toEqual([{ top: 'ana' }, { top: 'bo' }])
  })

  it('the game wins a name an ask claimed first, and warns that it is used both ways', async () => {
    world.server.onMessage('score', () => ({}), 'score.ts')
    const ana = world.join('0xana')
    await ana.send('score', {})
    await expect(world.server.send('score', { value: 1 })).resolves.toBeUndefined()
    expect(world.warnings.some((w) => w.includes('used both ways'))).toBe(true)
  })

  it('one name has one handler: a second script claiming it errors, same script replaces', () => {
    world.server.onMessage('pray', () => 1, 'shrine.ts')
    world.server.onMessage('pray', () => 2, 'shrine.ts') // same script: replace, prefab placed twice
    expect(() => world.server.onMessage('pray', () => 3, 'other.ts')).toThrow(
      "Two scripts both handle 'pray'"
    )
  })

  it('unknown asks never dispatch and reject with GameNameError', async () => {
    const ana = world.join('0xana')
    await expect(ana.send('nothing', {})).rejects.toThrow(GameNameError)
  })
})

describe('harness scenario: spam', () => {
  it('a flooding player is throttled per name; another player is untouched', async () => {
    let handled = 0
    world.server.onMessage('hit', () => {
      handled += 1
      return handled
    }, 'gun.ts')
    const spammer = world.join('0xspam')
    const honest = world.join('0xok')

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => spammer.send('hit', {}))
    )
    const rejected = results.filter((r) => r.status === 'rejected').length
    expect(rejected).toBeGreaterThan(0) // bucket empties inside one window
    const spamHandled = handled

    const ok = await honest.send('hit', {})
    expect(ok).toBe(spamHandled + 1) // the honest player's ask landed
  })

  it('rate recovered after the window moves on', async () => {
    world.server.onMessage('hit', () => 'ok', 'gun.ts')
    const p = world.join('0xp')
    await Promise.allSettled(Array.from({ length: 20 }, () => p.send('hit', {})))
    world.tick(2000)
    await expect(p.send('hit', {})).resolves.toBe('ok')
  })
})

describe('harness scenario: crash containment', () => {
  it('a handler that throws surfaces a [game] card, rejects the asker, and the queue survives', async () => {
    const processed: number[] = []
    let n = 0
    world.server.onMessage('step', () => {
      n += 1
      if (n === 3) throw new Error('boom on 3')
      processed.push(n)
      return n
    }, 'steps.ts')
    const ana = world.join('0xana')

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => ana.send('step', {}))
    )
    expect(results[2].status).toBe('rejected')
    expect(processed).toEqual([1, 2, 4, 5, 6])
    expect(world.errors).toContainEqual({
      side: 'game',
      name: 'step',
      message: 'steps.ts: boom on 3'
    })
  })
})

describe('harness scenario: duplicate (check-then-act inside one handler is atomic)', () => {
  it('two simultaneous asks with an await inside the handler cannot double-claim', async () => {
    let claimed = false
    const winners: Player[] = []
    world.server.onMessage('claim', async (_d, player) => {
      if (claimed) return { ok: false }
      await Promise.resolve() // the await that races detached-async dispatch
      claimed = true
      winners.push(player)
      return { ok: true }
    }, 'pickup.ts')

    const ana = world.join('0xana')
    const bo = world.join('0xbo')
    const [a, b] = await Promise.all([ana.send('claim', {}), bo.send('claim', {})])
    expect([a, b].filter((r) => (r as { ok: boolean }).ok)).toHaveLength(1)
    expect(winners).toHaveLength(1)
  })
})

describe('harness scenario: restart', () => {
  it('a fresh server core has no handlers or directions from the old run', async () => {
    world.server.onMessage('openChest', () => ({ ok: true }), 'chest.ts')
    const ana = world.join('0xana')
    await ana.send('openChest', {})

    world.restartServer()
    await expect(ana.send('openChest', {})).rejects.toThrow(GameNameError)

    world.server.onMessage('openChest', () => ({ ok: true, round: 2 }), 'chest.ts')
    await expect(ana.send('openChest', {})).resolves.toEqual({ ok: true, round: 2 })
  })
})

describe('harness budgets', () => {
  it('an oversized payload is dropped and logged, never delivered', async () => {
    let reached = false
    world.server.onMessage('big', () => {
      reached = true
      return {}
    }, 'big.ts')
    const ana = world.join('0xana')
    const huge = { blob: 'x'.repeat(MSG_BYTE_LIMIT + 1) }
    const race = Promise.race([
      ana.send('big', huge),
      new Promise((r) => setTimeout(() => r('hung'), 20))
    ])
    await expect(race).resolves.toBe('hung')
    expect(reached).toBe(false)
    expect(world.budget.oversized).toHaveLength(1)
  })

  it('payloads over the core cap are rejected before the handler', async () => {
    let reached = false
    world.server.onMessage('mid', () => {
      reached = true
      return {}
    }, 'mid.ts')
    const ana = world.join('0xana')
    const mid = { blob: 'x'.repeat(MAX_PAYLOAD_BYTES + 1) }
    await expect(ana.send('mid', mid)).rejects.toThrow('bytes — send less')
    expect(reached).toBe(false)
  })
})

describe('harness scenario: shared facts (game.state)', () => {
  it('a green write lands on every screen and each key publishes on its own', async () => {
    const ana = world.join('0xana')
    const changes: Record<string, unknown>[] = []
    ana.onStateChange((c) => changes.push(c))
    world.server.onMessage('open', () => {
      world.server.setState({ doorOpen: true, score: 1 })
      return {}
    }, 'door.ts')

    await ana.send('open', {})
    expect(ana.state.doorOpen).toBe(true)
    expect(ana.state.score).toBe(1)
    expect(world.facts.size).toBe(3) // per-key sharding: two creator facts + the module's round
    expect(changes).toEqual([{ doorOpen: true }, { score: 1 }])
  })

  it('writes to one key in one handler coalesce to one publish, last value wins', async () => {
    world.server.onMessage('spin', () => {
      for (let i = 0; i < 10; i++) world.server.setState({ n: i })
      return {}
    }, 'spin.ts')
    const ana = world.join('0xana')
    await ana.send('spin', {})
    expect(world.facts.get('n')).toEqual({ json: '9', rev: 1 })
    expect(ana.state.n).toBe(9)
  })

  it('a late joiner reads the current facts with zero messages', async () => {
    world.server.onMessage('open', () => {
      world.server.setState({ doorOpen: true })
      return {}
    }, 'door.ts')
    const ana = world.join('0xana')
    await ana.send('open', {})

    const late = world.join('0xlate')
    expect(late.state.doorOpen).toBe(true)
  })

  it('setState outside a green handler throws the teaching error, on both sides', () => {
    const ana = world.join('0xana')
    const teach = 'Only the game can change game.state. Move this inside game.onMessage.'
    expect(() => ana.setState({ x: 1 })).toThrow(teach)
    expect(() => world.server.setState({ x: 1 })).toThrow(teach)
  })

  it('a handler reads its own writes before the flush', async () => {
    let seen: unknown = null
    world.server.onMessage('two', () => {
      world.server.setState({ a: 1 })
      seen = world.server.state.a
      return {}
    }, 'two.ts')
    await world.join('0xana').send('two', {})
    expect(seen).toBe(1)
  })

  it('an oversized key warns but still ships', async () => {
    world.server.onMessage('big', () => {
      world.server.setState({ blob: 'x'.repeat(5000) })
      return {}
    }, 'big.ts')
    const ana = world.join('0xana')
    await ana.send('big', {})
    expect(world.warnings[0]).toContain('game.state.blob')
    expect((ana.state.blob as string).length).toBe(5000)
  })

  it('the boot wipe: stale facts leave the snapshot, every mirror, and every late joiner', async () => {
    world.server.onMessage('open', () => {
      world.server.setState({ doorOpen: true })
      return {}
    }, 'door.ts')
    const ana = world.join('0xana')
    await ana.send('open', {})
    expect(ana.state.doorOpen).toBe(true)

    world.restartServer() // auto-boots: adopt → retire → onStart (none) → round 1 → open
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect([...world.facts.keys()]).toEqual(['round']) // no zombie facts, only the fresh round
    expect('doorOpen' in ana.state).toBe(false) // the connected screen dropped it
    const late = world.join('0xlate')
    expect('doorOpen' in late.state).toBe(false)
  })
})

describe('harness scenario: boot pipeline', () => {
  it('fresh onStart state outruns the stale copy a connected screen still holds', async () => {
    world.server.onMessage('open', () => {
      world.server.setState({ doorOpen: true })
      return {}
    }, 'door.ts')
    const ana = world.join('0xana')
    await ana.send('open', {})

    const fresh = world.restartServer({ boot: false })
    fresh.onStart(() => fresh.setState({ doorOpen: false }))
    await world.bootServer()

    expect(ana.state.doorOpen).toBe(false) // rev outran the stale mirror
    expect(world.facts.get('doorOpen')?.json).toBe('false')
  })

  it('asks queue while the game wakes and resolve after boot', async () => {
    const fresh = world.restartServer({ boot: false })
    fresh.onMessage('hello', () => ({ up: true }), 'greeter.ts')
    const ana = world.join('0xana')

    let settled = false
    const pendingAsk = ana.send('hello', {}).then((r) => {
      settled = true
      return r
    })
    await Promise.resolve()
    expect(settled).toBe(false) // waking: nothing dispatched yet

    await world.bootServer()
    await expect(pendingAsk).resolves.toEqual({ up: true })
  })

  it('onStart runs once, in green context, and a throwing hook surfaces but never blocks boot', async () => {
    const fresh = world.restartServer({ boot: false })
    let runs = 0
    fresh.onStart(() => {
      runs += 1
      fresh.setState({ score: 0 }) // green: legal here
    })
    fresh.onStart(() => {
      throw new Error('bad hook')
    })
    await world.bootServer()
    await world.bootServer() // idempotent

    expect(runs).toBe(1)
    expect(world.facts.get('score')?.json).toBe('0')
    expect(world.errors).toContainEqual({ side: 'game', name: 'onStart', message: 'bad hook' })
  })
})

describe('harness scenario: durable memory (saved + playerData)', () => {
  it('playerData written before a restart reads back after boot, and set patches the record', async () => {
    world.server.onMessage('collect', (_d, player) => {
      const data = world.server.playerData(player)
      data.set({ coins: Number(data.get().coins ?? 0) + 1 })
      return {}
    }, 'coin.ts')
    world.server.onMessage('rename', (_d, player) => {
      world.server.playerData(player).set({ name: 'ana' })
      return {}
    }, 'coin.ts')
    const ana = world.join('0xana')
    await ana.send('collect', {})
    await ana.send('collect', {})
    await ana.send('rename', {}) // a later patch keeps earlier keys

    const fresh = world.restartServer({ boot: false })
    let record: Record<string, unknown> | null = null
    fresh.onMessage('check', (_d, player) => {
      record = fresh.playerData(player).get()
      return {}
    }, 'coin.ts')
    await world.bootServer()
    await ana.send('check', {})
    expect(record).toEqual({ coins: 2, name: 'ana' })
  })

  it('the §5 lifetimes in one restart: state is wiped, saved survives', async () => {
    world.server.onMessage('win', () => {
      world.server.setState({ score: 3 })
      world.server.saved.set('highScore', 40)
      return {}
    }, 'flow.ts')
    const ana = world.join('0xana')
    await ana.send('win', {})
    expect(ana.state.score).toBe(3)

    const fresh = world.restartServer({ boot: false })
    let savedSeen: unknown
    fresh.onStart(() => {
      savedSeen = fresh.saved.get('highScore')
    })
    await world.bootServer()

    expect('score' in ana.state).toBe(false) // state: until the game sleeps
    expect([...world.facts.keys()]).toEqual(['round'])
    expect(savedSeen).toBe(40) // saved: survives restarts and re-publishes
  })

  it('saved and playerData outside green code throw the teaching errors', () => {
    const ana = world.join('0xana')
    const change = 'Only the game can change saved data. Move this inside game.onMessage.'
    expect(() => ana.saved.set('highScore', 1)).toThrow(change)
    expect(() => world.server.saved.set('highScore', 1)).toThrow(change) // green, not just server
    expect(() => ana.saved.get('highScore')).toThrow(
      'Only the game can read saved data. Move this inside game.onMessage.'
    )
    expect(() => ana.playerData('0xana').set({ coins: 1 })).toThrow(
      'Only the game can change player data. Move this inside game.onMessage.'
    )
    expect(() => ana.playerData('0xana').get()).toThrow(
      'Only the game can read player data. Move this inside game.onMessage.'
    )
  })

  it('the per-player cap rejects loudly and the record and storage stay untouched', async () => {
    world.server.onMessage('hoard', (_d, player) => {
      world.server.playerData(player).set({ blob: 'x'.repeat(PLAYER_DATA_CAP_BYTES + 1) })
      return {}
    }, 'hoard.ts')
    world.server.onMessage('peek', (_d, player) => world.server.playerData(player).get(), 'hoard.ts')
    const ana = world.join('0xana')

    await expect(ana.send('hoard', {})).rejects.toThrow('Store less per player')
    expect(world.errors.some((e) => e.side === 'game' && e.name === 'hoard')).toBe(true)
    expect(world.playerStorage.has('0xana')).toBe(false) // the write never landed
    await expect(ana.send('peek', {})).resolves.toEqual({})
  })

  it('onStart copies saved into state — the continuity idiom', async () => {
    world.server.onMessage('finish', () => {
      world.server.saved.set('topTimes', [12.3])
      return {}
    }, 'board.ts')
    const ana = world.join('0xana')
    await ana.send('finish', {})

    const fresh = world.restartServer({ boot: false })
    fresh.onStart(() => fresh.setState({ leaderboard: fresh.saved.get('topTimes') }))
    await world.bootServer()

    expect(ana.state.leaderboard).toEqual([12.3])
    const late = world.join('0xlate')
    expect(late.state.leaderboard).toEqual([12.3])
  })
})

describe('harness scenario: rounds', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('round 1 starts at boot; newRound bumps the number, reseeds, and runs onRoundStart green once per round', async () => {
    const fresh = world.restartServer({ boot: false })
    const starts: number[] = []
    fresh.onRoundStart((round) => {
      starts.push(round.number)
      fresh.setState({ score: 0 }) // green: the round reset is legal here
    })
    fresh.onMessage('next', () => fresh.newRound(), 'flow.ts')
    await world.bootServer()
    expect(starts).toEqual([1])

    const ana = world.join('0xana')
    const first = ana.state.round as RoundInfo
    expect(first.number).toBe(1)

    await ana.send('next', {})
    await settle() // onRoundStart is deferred a microtask past the caller's span
    expect(starts).toEqual([1, 2])
    const second = ana.state.round as RoundInfo
    expect(second.number).toBe(2)
    expect(second.seed).not.toBe(first.seed) // reseeded from the server-private stash
    expect(ana.state.score).toBe(0)
  })

  it('a late joiner reads the current round from the snapshot — arithmetic, not replay', async () => {
    world.server.onMessage('next', () => world.server.newRound(), 'flow.ts')
    const ana = world.join('0xana')
    await ana.send('next', {})
    await ana.send('next', {})
    await ana.send('next', {})

    const late = world.join('0xlate')
    expect((late.state.round as RoundInfo).number).toBe(4)
    expect(late.round.number).toBe(4) // game.round — read anywhere
  })

  it('newRound outside green code throws the teaching error, on both sides', () => {
    const ana = world.join('0xana')
    const teach = 'Only the game can start a round. Move this inside game.onMessage.'
    expect(() => ana.newRound()).toThrow(teach)
    expect(() => world.server.newRound()).toThrow(teach)
  })

  it('two screens derive byte-identical layout plans from one tuple, and sibling layouts get their own stream', () => {
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
  it('jsonDepth measures nesting', () => {
    expect(jsonDepth(null, 8)).toBe(0)
    expect(jsonDepth({ a: 1 }, 8)).toBe(1)
    expect(jsonDepth({ a: { b: { c: 1 } } }, 8)).toBe(3)
  })

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
    world.server.onMessage('score', (_d, player) => {
      world.server.playerData(player).set({ points: 10 })
      return {}
    }, 'score.ts')
    await ana.send('score', {})

    world.server.presentPlayers([]) // ana logs off mid-round
    await Promise.resolve()

    const after: unknown[] = []
    world.server.onMessage('close', () => {
      // a round-end tally reads every finisher, including the one who left
      after.push(world.server.playerData('0xana').get().points)
      after.push('reached the end')
      return {}
    }, 'round.ts')
    await world.join('0xbo').send('close', {})
    expect(after[1]).toBe('reached the end')
  })

  it('the round key belongs to the round: writing it teaches instead of breaking layouts', async () => {
    world.server.onMessage('bad', () => {
      world.server.setState({ round: 3 })
      return {}
    }, 'bad.ts')
    const ana = world.join('0xana')
    await expect(ana.send('bad', {})).rejects.toThrow('game.newRound()')
    expect(world.server.round.number).toBeGreaterThan(0) // the real round survived
  })

  it('a value that cannot be shared costs one key, not the game', async () => {
    world.server.onMessage('mixed', () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      world.server.setState({ good: 1, bad: cyclic })
      return {}
    }, 'mixed.ts')
    const ana = world.join('0xana')
    await ana.send('mixed', {})

    expect(ana.state.good).toBe(1) // the healthy key still published
    expect(world.errors.some((e) => e.name === 'state.bad')).toBe(true)
    // and the next flush is clean — the bad key did not wedge publishing
    world.server.onMessage('again', () => {
      world.server.setState({ good: 2 })
      return {}
    }, 'again.ts')
    await ana.send('again', {})
    expect(ana.state.good).toBe(2)
  })

  it('a burst of asks from one player costs one storage read, not one each', async () => {
    world.server.onMessage('ping', (_d, player) => {
      world.server.playerData(player).get()
      return {}
    }, 'ping.ts')
    const fresh = new GameCore({ ...world['portsFor']('0xnew') })
    fresh.setRole(false)
    world.screens.set('0xnew', fresh)
    // five asks land in one tick before any restore resolves — the host-call
    // budget is scene-wide, so N concurrent reads would starve every player
    await Promise.all(Array.from({ length: 5 }, () => fresh.send('ping', {})))
    expect(world.loads.get('0xnew') ?? 0).toBeLessThanOrEqual(1)
  })
})
