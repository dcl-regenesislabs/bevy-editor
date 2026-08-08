import { describe, expect, it, beforeEach } from 'vitest'
import {
  GameCore,
  GameNameError,
  GameDirectionError,
  RateLimiter,
  jsonDepth,
  MAX_PAYLOAD_BYTES,
  type CorePorts,
  type ErrorCard,
  type Player
} from '../runtime-modules/pure/gameCore'

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
  private clock = 1_000_000
  private inbound = new Map<string, { count: number; windowStart: number }>()

  constructor() {
    this.server = new GameCore(this.portsFor('server'))
    this.server.setRole(true)
    void this.server.bootServer([]) // a fresh world wakes with an empty snapshot
  }

  adoptedFacts(): Array<{ key: string; json: string; rev: number }> {
    return [...this.facts].map(([key, f]) => ({ key, json: f.json, rev: f.rev }))
  }

  bootServer(): Promise<void> {
    return this.server.bootServer(this.adoptedFacts())
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
    // late joiner: the snapshot delivers every current fact, no messages
    for (const [key, f] of this.facts) core.applyFact(key, f.json, f.rev)
    return core
  }

  restartServer(opts?: { boot?: boolean }): GameCore {
    // the snapshot survives; only the isolate dies
    this.server = new GameCore(this.portsFor('server'))
    this.server.setRole(true)
    if (opts?.boot !== false) void this.server.bootServer(this.adoptedFacts())
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
      devWarn: (message) => this.warnings.push(message)
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

  it('one name has one direction: the game cannot send an asked name', async () => {
    world.server.onMessage('openChest', () => ({}), 'chest.ts')
    const ana = world.join('0xana')
    await ana.send('openChest', {})
    await expect(world.server.send('openChest', {})).rejects.toThrow(GameDirectionError)
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
      world.server.setState({ doorOpen: true, round: 1 })
      return {}
    }, 'door.ts')

    await ana.send('open', {})
    expect(ana.state.doorOpen).toBe(true)
    expect(ana.state.round).toBe(1)
    expect(world.facts.size).toBe(2) // per-key sharding: two facts, not one blob
    expect(changes).toEqual([{ doorOpen: true }, { round: 1 }])
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

    world.restartServer() // auto-boots: adopt → retire → onStart (none) → open
    await Promise.resolve()
    expect(world.facts.size).toBe(0) // no zombie facts
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
      fresh.setState({ round: 0 }) // green: legal here
    })
    fresh.onStart(() => {
      throw new Error('bad hook')
    })
    await world.bootServer()
    await world.bootServer() // idempotent

    expect(runs).toBe(1)
    expect(world.facts.get('round')?.json).toBe('0')
    expect(world.errors).toContainEqual({ side: 'game', name: 'onStart', message: 'bad hook' })
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
