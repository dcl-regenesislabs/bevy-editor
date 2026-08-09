import { describe, expect, it } from 'vitest'
import { createRng, rngRange, rngInt, rngPick } from '../runtime-modules/pure/rng'
import { ntpSample, combineSamples } from '../runtime-modules/pure/time-math'
import {
  remainingMs,
  isExpired,
  countdownRemainingMs,
  countdownWithMultiplier,
  settleExpired,
  periodId,
  dailyKey,
  weeklyKey,
  DAY_MS,
  WEEK_MS
} from '../runtime-modules/pure/countdown'
import {
  safeNumber,
  safeString,
  safeBoolean,
  safeStringArray,
  normalizeVersioned
} from '../runtime-modules/pure/normalize'
import { LivenessTracker } from '../runtime-modules/pure/liveness'
import { PendingMap } from '../runtime-modules/pure/pending'
import { Membership } from '../runtime-modules/pure/membership'
import { ZoneRegistry, zoneKey } from '../runtime-modules/pure/zoneRegistry'
import fs from 'node:fs'
import path from 'node:path'

describe('_runtime rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(1234)
    const b = createRng(1234)
    const c = createRng(4321)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    const seqC = [c(), c(), c(), c()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
  })

  it('stays in bounds', () => {
    const rng = createRng(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      const r = rngRange(rng, 2, 5.5)
      expect(r).toBeGreaterThanOrEqual(2)
      expect(r).toBeLessThan(5.5)
      const n = rngInt(rng, 0, 3)
      expect([0, 1, 2]).toContain(n)
    }
  })

  it('picks only from the list', () => {
    const rng = createRng(42)
    const items = ['a', 'b', 'c']
    for (let i = 0; i < 100; i++) expect(items).toContain(rngPick(rng, items))
  })
})

describe('_runtime time-math', () => {
  it('computes offset and rtt from the four timestamps', () => {
    // client clock 1000ms behind server, 40ms each way, 10ms server processing
    const t1 = 10_000
    const t2 = 10_000 + 40 + 1000
    const t3 = t2 + 10
    const t4 = t1 + 40 + 10 + 40
    const s = ntpSample(t1, t2, t3, t4)
    expect(s.rtt).toBe(80)
    expect(s.offset).toBe(1000)
  })

  it('drops best and worst samples before averaging', () => {
    const samples = [
      { offset: 1000, rtt: 50 },
      { offset: 1002, rtt: 60 },
      { offset: 998, rtt: 55 },
      { offset: 5000, rtt: 900 }, // congested outlier — dropped as worst rtt
      { offset: -400, rtt: 5 } // impossible fast path — dropped as best rtt
    ]
    const offset = combineSamples(samples)
    expect(offset).toBeCloseTo((1000 + 1002 + 998) / 3, 5)
  })

  it('handles small sample sets without slicing to nothing', () => {
    expect(combineSamples([])).toBe(0)
    expect(combineSamples([{ offset: 10, rtt: 1 }])).toBe(10)
    expect(
      combineSamples([
        { offset: 10, rtt: 1 },
        { offset: 20, rtt: 2 }
      ])
    ).toBe(15)
  })
})

describe('_runtime countdown', () => {
  it('deadline helpers clamp at zero', () => {
    expect(remainingMs(1000, 400)).toBe(600)
    expect(remainingMs(1000, 1500)).toBe(0)
    expect(isExpired(1000, 999)).toBe(false)
    expect(isExpired(1000, 1000)).toBe(true)
  })

  it('derives drift-free countdowns and survives speed changes', () => {
    const start = { changedAtMs: 0, remainingAtChangeMs: 10_000, multiplier: 1 }
    expect(countdownRemainingMs(start, 4000)).toBe(6000)
    // frenzy: at t=4000 switch to 2x speed — remaining is preserved at the switch
    const frenzy = countdownWithMultiplier(start, 4000, 2)
    expect(frenzy).toEqual({ changedAtMs: 4000, remainingAtChangeMs: 6000, multiplier: 2 })
    expect(countdownRemainingMs(frenzy, 5000)).toBe(4000)
    expect(countdownRemainingMs(frenzy, 8000)).toBe(0)
  })

  it('settles items that expired while the server slept', () => {
    const items = [
      { name: 'past', endsAt: 100 },
      { name: 'future', endsAt: 10_000 },
      { name: 'also-past', endsAt: 500 }
    ]
    const settled: string[] = []
    const count = settleExpired(items, (i) => i.endsAt, 1000, (i) => settled.push(i.name))
    expect(count).toBe(2)
    expect(settled).toEqual(['past', 'also-past'])
  })

  it('rolls period keys over at exact boundaries', () => {
    expect(periodId(DAY_MS - 1, DAY_MS)).toBe(0)
    expect(periodId(DAY_MS, DAY_MS)).toBe(1)
    expect(dailyKey('board', DAY_MS * 3 + 5)).toBe('board:daily:3')
    expect(weeklyKey('board', WEEK_MS * 2)).toBe('board:weekly:2')
  })
})

describe('_runtime normalize', () => {
  it('repairs primitives', () => {
    expect(safeNumber(5, 0)).toBe(5)
    expect(safeNumber(NaN, 0)).toBe(0)
    expect(safeNumber('5', 0)).toBe(0)
    expect(safeString('x', 'd')).toBe('x')
    expect(safeString(5, 'd')).toBe('d')
    expect(safeBoolean(true, false)).toBe(true)
    expect(safeBoolean('true', false)).toBe(false)
    expect(safeStringArray(['a', 1, 'b', null])).toEqual(['a', 'b'])
    expect(safeStringArray('nope')).toEqual([])
  })

  it('gates on schema version and repairs field by field', () => {
    type S = { schemaVersion: number; gold: number; name: string }
    const defaults = (): S => ({ schemaVersion: 2, gold: 0, name: 'anon' })
    const repair = (v: Partial<S>, d: S): S => ({
      schemaVersion: d.schemaVersion,
      gold: safeNumber(v.gold, d.gold),
      name: safeString(v.name, d.name)
    })
    expect(normalizeVersioned(null, 2, defaults, repair)).toEqual(defaults())
    expect(normalizeVersioned({ schemaVersion: 1, gold: 99 }, 2, defaults, repair)).toEqual(defaults())
    expect(normalizeVersioned({ schemaVersion: 2, gold: 99, name: 3 }, 2, defaults, repair)).toEqual({
      schemaVersion: 2,
      gold: 99,
      name: 'anon'
    })
  })
})

describe('_runtime membership', () => {
  it('fires every entry under "every time"', () => {
    const m = new Membership<number>()
    expect(m.touch(1, 'every time')).toBe(true)
    expect(m.touch(1, 'every time')).toBe(false) // already inside
    m.drop(1)
    expect(m.tick(1, 0)).toEqual([1])
    expect(m.touch(1, 'every time')).toBe(true) // came back
  })

  it('fires once per player, and once ever, across re-entries', () => {
    const perPlayer = new Membership<number>()
    expect(perPlayer.touch(1, 'once per player')).toBe(true)
    expect(perPlayer.touch(2, 'once per player')).toBe(true)
    perPlayer.drop(1)
    perPlayer.tick(1, 0)
    expect(perPlayer.touch(1, 'once per player')).toBe(false)

    const onceEver = new Membership<number>()
    expect(onceEver.touch(1, 'once ever')).toBe(true)
    expect(onceEver.touch(2, 'once ever')).toBe(false)
    onceEver.drop(1)
    onceEver.tick(1, 0)
    expect(onceEver.touch(1, 'once ever')).toBe(false)
  })

  it('suppressed entries still count as occupancy', () => {
    const m = new Membership<number>()
    m.touch(1, 'once ever')
    m.touch(2, 'once ever') // no event, but player 2 IS in the zone
    expect(m.list()).toEqual([1, 2])
    expect(m.has(2)).toBe(true)
  })

  it('holds a member through the cooldown and cancels the exit if they come back', () => {
    const m = new Membership<number>()
    m.touch(1, 'every time')
    m.drop(1)
    expect(m.tick(0.1, 0.3)).toEqual([])
    expect(m.has(1)).toBe(true) // still occupancy while straddling the boundary
    expect(m.touch(1, 'every time')).toBe(false) // no re-entry event
    expect(m.tick(0.5, 0.3)).toEqual([]) // grace was cancelled, not merely reset
    m.drop(1)
    expect(m.tick(0.2, 0.3)).toEqual([])
    expect(m.tick(0.1, 0.3)).toEqual([1])
    expect(m.size).toBe(0)
  })

  it('re-asserts membership from STAY without re-firing, and re-fires after expiry', () => {
    // TriggerAreaResult is capped at 100 and trimmed from the front: the ENTER
    // can be evicted, so STAY is the first thing the scene sees.
    const m = new Membership<number>()
    expect(m.touch(7, 'every time')).toBe(true) // arrived via STAY
    expect(m.touch(7, 'every time')).toBe(false) // further STAY heartbeats
    expect(m.touch(7, 'every time')).toBe(false)
    m.drop(7)
    expect(m.tick(0.016, 0)).toEqual([7])
    expect(m.touch(7, 'every time')).toBe(true)
  })

  it('reset forgets the once-per-player history', () => {
    const m = new Membership<string>()
    m.touch('a', 'once per player')
    m.reset()
    expect(m.size).toBe(0)
    expect(m.touch('a', 'once per player')).toBe(true)
  })
})

describe('_runtime zone registry', () => {
  const stub = <T>(items: T[]) => () => items

  it('matches names ignoring case and surrounding space, keeping the creator spelling', () => {
    const r = new ZoneRegistry<number>()
    r.publish(' Front Hall ', 10, stub([1]))
    expect(zoneKey('  FRONT hall ')).toBe('front hall')
    expect(r.contains('front hall', 1)).toBe(true)
    expect(r.contains('FRONT HALL', 1)).toBe(true)
    expect(r.occupants('front  hall')).toEqual([]) // inner spacing is still a different name
    expect(r.names()).toEqual(['Front Hall'])
    expect(r.displayName('front hall')).toBe('Front Hall')
  })

  it('unions and dedupes occupancy across areas sharing a name', () => {
    const r = new ZoneRegistry<number>()
    r.publish('Arena', 10, stub([1, 2]))
    r.publish('arena', 11, stub([2, 3]))
    expect(r.occupants('Arena')).toEqual([1, 2, 3])
    expect(r.names()).toEqual(['arena']) // last publish owns the spelling
    r.unpublish(11)
    expect(r.occupants('Arena')).toEqual([1, 2])
    r.unpublish(10)
    expect(r.names()).toEqual([])
  })

  it('replays current occupancy to a late subscriber as enter events', () => {
    const r = new ZoneRegistry<number>()
    r.publish('Front Hall', 10, stub([1, 2]))
    const seen: string[] = []
    r.subscribe('front hall', 'enter', (kind, who, zoneEntity) => seen.push(`${kind}:${who}:${zoneEntity}`))
    expect(seen).toEqual(['enter:1:10', 'enter:2:10'])
    r.emit('FRONT HALL', 'enter', 3, 10)
    expect(seen).toEqual(['enter:1:10', 'enter:2:10', 'enter:3:10'])
  })

  it('does not replay to exit-only subscribers, and routes by kind', () => {
    const r = new ZoneRegistry<number>()
    r.publish('Front Hall', 10, stub([1]))
    const exits: number[] = []
    const any: string[] = []
    r.subscribe('Front Hall', 'exit', (_kind, who) => exits.push(who))
    r.subscribe('Front Hall', 'any', (kind) => any.push(kind))
    expect(exits).toEqual([])
    expect(any).toEqual(['enter']) // 'any' still gets the replay
    r.emit('Front Hall', 'exit', 1, 10)
    expect(exits).toEqual([1])
    expect(any).toEqual(['enter', 'exit'])
  })

  it('subscribes before the zone exists and stops on unsubscribe', () => {
    const r = new ZoneRegistry<number>()
    const seen: number[] = []
    const off = r.subscribe('Not Yet', 'enter', (_kind, who) => seen.push(who))
    r.publish('not yet', 10, stub([]))
    r.emit('Not Yet', 'enter', 1, 10)
    off()
    r.emit('Not Yet', 'enter', 2, 10)
    expect(seen).toEqual([1])
  })

  it('ignores a blank name rather than publishing an unaddressable zone', () => {
    const r = new ZoneRegistry<number>()
    r.publish('   ', 10, stub([1]))
    expect(r.names()).toEqual([])
    expect(r.occupants('')).toEqual([])
  })
})

describe('runtime-modules distribution', () => {
  it('templates ship zero runtime code — the shared copy is vendored on first import', () => {
    for (const t of ['blank', 'starter']) {
      const dir = path.resolve(__dirname, `../templates/${t}/src/_runtime`)
      expect(fs.existsSync(dir)).toBe(false)
    }
  })

  it('master modules never re-introduce a barrel export', () => {
    const dir = path.resolve(__dirname, '../runtime-modules')
    expect(fs.existsSync(path.join(dir, 'index.ts'))).toBe(false)
  })
})

describe('_runtime liveness', () => {
  it('is connecting until a change is observed — a stale snapshot value is not life', () => {
    const t = new LivenessTracker(6000)
    expect(t.state(0)).toBe('connecting')
    t.observe(12345, 0) // first sighting of a (possibly stale) value
    expect(t.state(100)).toBe('alive')
    // the value never changes again: a snapshot from a dead server
    t.observe(12345, 7000)
    expect(t.state(7000)).toBe('lost')
  })

  it('recovers when the value changes again', () => {
    const t = new LivenessTracker(6000)
    t.observe(1, 0)
    t.observe(1, 10_000)
    expect(t.state(10_000)).toBe('lost')
    t.observe(2, 11_000) // server woke up
    expect(t.state(11_000)).toBe('alive')
  })

  it('reports first-life exactly once', () => {
    const t = new LivenessTracker(6000)
    expect(t.everAlive()).toBe(false)
    t.observe(null, 0)
    expect(t.everAlive()).toBe(false)
    t.observe(7, 100)
    expect(t.everAlive()).toBe(true)
  })
})

describe('_runtime rpc pending', () => {
  it('settles and fails by id, exactly once', () => {
    const p = new PendingMap<string>()
    const got: string[] = []
    p.add('a', { resolve: (v) => got.push(v), reject: () => got.push('err'), sentAtMs: 0, retriesLeft: 0 })
    expect(p.settle('a', 'ok')).toBe(true)
    expect(p.settle('a', 'again')).toBe(false)
    expect(got).toEqual(['ok'])
    expect(p.size).toBe(0)
  })

  it('retries on timeout, then fails when the budget is spent', () => {
    const p = new PendingMap<string>()
    let error: Error | null = null
    p.add('x', { resolve: () => {}, reject: (e) => (error = e), sentAtMs: 0, retriesLeft: 2 })
    expect(p.tick(1000, 4000)).toEqual([]) // not timed out yet
    expect(p.tick(4000, 4000)).toEqual(['x']) // retry 1, clock reset
    expect(p.tick(7999, 4000)).toEqual([]) // within the reset window
    expect(p.tick(8000, 4000)).toEqual(['x']) // retry 2
    expect(p.tick(12_000, 4000)).toEqual([]) // budget spent → failed
    expect(error).not.toBeNull()
    expect(p.size).toBe(0)
  })
})
