// The Wave Director's plan is the whole multiplayer trick: nothing about a wave
// travels over the wire, so if two sides can derive different entries from the
// same tuple the bug shows up as zombies only some players can see. These tests
// pin the determinism, the clamps, and the server-side ledger's refusals.
import { describe, expect, it } from 'vitest'
import { createRng } from '../runtime-modules/pure/rng'
import {
  DEFAULT_WAVES,
  GROUP_STAGGER_MS,
  INSTANCE_STRIDE,
  aliveEntries,
  applyBite,
  applyHit,
  buildWavePlan,
  clearWave,
  createHpLedger,
  dueEntries,
  groupSizeFor,
  instanceIdFor,
  normalizeWaveRows,
  phaseOfInstance,
  planSeed,
  rowForPhase,
  toNumber,
  waveIndexForPhase,
  type PlanTuple,
  type WavePlanConfig
} from '../prefabs/wave-director/scripts/pure/wavePlan'

const AREA = { centerX: 8, centerZ: 8, y: 0, innerRadius: 4, outerRadius: 10 }

function config(over: Partial<WavePlanConfig> = {}): WavePlanConfig {
  return { rows: DEFAULT_WAVES, area: AREA, max: 64, hp: 40, activeMs: 45_000, ...over }
}

const TUPLE: PlanTuple = { seed: 7, phase: 0, phaseStartMs: 1_000, configVersion: 3 }

describe('the wave plan', () => {
  it('is a pure function of the tuple', () => {
    const a = buildWavePlan(TUPLE, config(), createRng)
    const b = buildWavePlan({ ...TUPLE }, config(), createRng)
    expect(b).toEqual(a)
  })

  it('reshuffles when any part of the tuple moves', () => {
    const base = buildWavePlan(TUPLE, config(), createRng)
    for (const next of [
      { ...TUPLE, seed: 8 },
      { ...TUPLE, phase: 1 },
      { ...TUPLE, configVersion: 4 }
    ]) {
      expect(planSeed(next)).not.toBe(planSeed(TUPLE))
      expect(buildWavePlan(next, config(), createRng)[0].init.x).not.toBe(base[0].init.x)
    }
  })

  it('takes its count from the table and never exceeds the pool max', () => {
    expect(buildWavePlan(TUPLE, config(), createRng)).toHaveLength(DEFAULT_WAVES[0].count)
    expect(buildWavePlan(TUPLE, config({ max: 4 }), createRng)).toHaveLength(4)
    expect(buildWavePlan(TUPLE, config({ max: 0 }), createRng)).toHaveLength(0)
  })

  it('releases groups on the interval and staggers within a group', () => {
    const entries = buildWavePlan(TUPLE, config(), createRng)
    const group = groupSizeFor(DEFAULT_WAVES[0].wave)
    const intervalMs = DEFAULT_WAVES[0].interval * 1000
    expect(entries[0].atMs).toBe(TUPLE.phaseStartMs)
    expect(entries[1].atMs).toBe(TUPLE.phaseStartMs + GROUP_STAGGER_MS)
    expect(entries[group].atMs).toBe(TUPLE.phaseStartMs + intervalMs)
  })

  it('keeps the last spawn inside the phase', () => {
    const entries = buildWavePlan(TUPLE, config({ activeMs: 3_000 }), createRng)
    for (const entry of entries) expect(entry.atMs).toBeLessThanOrEqual(TUPLE.phaseStartMs + 2_900)
  })

  it('spawns on a ring around the director', () => {
    for (const entry of buildWavePlan(TUPLE, config(), createRng)) {
      const dx = toNumber(entry.init.x, 0) - AREA.centerX
      const dz = toNumber(entry.init.z, 0) - AREA.centerZ
      const radius = Math.sqrt(dx * dx + dz * dz)
      expect(radius).toBeGreaterThanOrEqual(AREA.innerRadius - 1e-6)
      expect(radius).toBeLessThanOrEqual(AREA.outerRadius + 1e-6)
    }
  })

  it('carries the row tuning into every entry', () => {
    const entry = buildWavePlan({ ...TUPLE, phase: 4 }, config(), createRng)[0]
    expect(entry.init.speedMult).toBe(DEFAULT_WAVES[4].speedMult)
    expect(entry.init.wave).toBe(DEFAULT_WAVES[4].wave)
    expect(entry.init.hp).toBe(40)
  })

  it('stripes instance ids so two phases never share a ledger key', () => {
    const first = buildWavePlan({ ...TUPLE, phase: 1 }, config(), createRng)
    const second = buildWavePlan({ ...TUPLE, phase: 2 }, config(), createRng)
    const ids = new Set([...first, ...second].map((entry) => entry.instanceId))
    expect(ids.size).toBe(first.length + second.length)
    expect(phaseOfInstance(instanceIdFor(2, 3))).toBe(2)
    expect(instanceIdFor(2, 3)).toBe(2 * INSTANCE_STRIDE + 3)
  })
})

describe('which phases are waves', () => {
  // A Round Loop counts lobby (0), waves (odd) and intermissions (even > 0) on ONE
  // counter. Reading the table at the raw phase spawned a wave into the lobby and
  // into every intermission, and walked only the odd rows of the table.
  const roundLoop = config({ roundLoop: true })

  it('maps a Round Loop phase to a wave index, and everything else to nothing', () => {
    expect([0, 1, 2, 3, 4, 5].map((phase) => waveIndexForPhase(phase, true))).toEqual([null, 0, null, 1, null, 2])
  })

  it('plans nothing for the lobby or an intermission', () => {
    for (const phase of [0, 2, 4]) {
      expect(buildWavePlan({ ...TUPLE, phase }, roundLoop, createRng)).toEqual([])
    }
  })

  it('walks one row per wave rather than one per phase', () => {
    expect(buildWavePlan({ ...TUPLE, phase: 1 }, roundLoop, createRng)).toHaveLength(DEFAULT_WAVES[0].count)
    expect(buildWavePlan({ ...TUPLE, phase: 3 }, roundLoop, createRng)).toHaveLength(DEFAULT_WAVES[1].count)
    expect(buildWavePlan({ ...TUPLE, phase: 5 }, roundLoop, createRng)).toHaveLength(DEFAULT_WAVES[2].count)
  })

  it('keeps every phase a wave on the free-running clock, where there is nothing else', () => {
    for (const phase of [0, 1, 2, 3]) {
      expect(waveIndexForPhase(phase, false)).toBe(phase)
      expect(buildWavePlan({ ...TUPLE, phase }, config(), createRng).length).toBeGreaterThan(0)
    }
  })
})

describe('the wave table', () => {
  it('cycles rather than running out', () => {
    expect(rowForPhase(DEFAULT_WAVES, 0)).toBe(DEFAULT_WAVES[0])
    expect(rowForPhase(DEFAULT_WAVES, DEFAULT_WAVES.length)).toBe(DEFAULT_WAVES[0])
    expect(rowForPhase(DEFAULT_WAVES, -1)).toBe(DEFAULT_WAVES[DEFAULT_WAVES.length - 1])
  })

  it('falls back to the built-in table when given nothing usable', () => {
    expect(normalizeWaveRows(undefined)).toEqual([])
    expect(normalizeWaveRows([{ wave: 1, count: 0 }])).toEqual([])
    expect(rowForPhase([], 3)).toBe(DEFAULT_WAVES[3])
  })

  it('reads Game Config cells that arrive as strings', () => {
    const rows = normalizeWaveRows([{ wave: '2', count: '9', interval: '1.5', speedMult: '1.2' }])
    expect(rows).toEqual([{ wave: 2, count: 9, interval: 1.5, speedMult: 1.2 }])
  })

  it('grows the group every three waves and caps it', () => {
    expect([1, 3, 4, 7, 10, 40].map(groupSizeFor)).toEqual([2, 2, 3, 4, 4, 4])
  })
})

describe('the alive-set a joiner reconstructs', () => {
  const entries = buildWavePlan(TUPLE, config(), createRng)

  it('is everything already due', () => {
    expect(dueEntries(entries, TUPLE.phaseStartMs)).toHaveLength(1)
    expect(dueEntries(entries, TUPLE.phaseStartMs - 1)).toHaveLength(0)
  })

  it('drops what the ledger reported dead', () => {
    const dead = new Set([entries[0].instanceId])
    expect(aliveEntries(entries, entries[3].atMs, dead)).toHaveLength(3)
  })
})

describe('the server-side hp ledger', () => {
  const rules = { damage: 12, minIntervalMs: 150 }
  const args = { instanceId: 5, from: '0xABC', nowMs: 1_000, maxHp: 40, alive: true }

  it('refuses an instance no plan produced', () => {
    const result = applyHit(createHpLedger(), { ...args, alive: false }, rules)
    expect(result).toEqual({ ok: false, reason: 'not in the current plan' })
  })

  it('subtracts the config damage, not a reported one', () => {
    const ledger = createHpLedger()
    expect(applyHit(ledger, args, rules)).toEqual({ ok: true, value: 28 })
    expect(applyHit(ledger, { ...args, nowMs: 2_000 }, rules)).toEqual({ ok: true, value: 16 })
  })

  it('rate-limits one reporter without penalising another', () => {
    const ledger = createHpLedger()
    applyHit(ledger, args, rules)
    expect(applyHit(ledger, { ...args, nowMs: 1_100 }, rules)).toEqual({ ok: false, reason: 'rate limited' })
    expect(applyHit(ledger, { ...args, from: '0xDEF', nowMs: 1_100 }, rules)).toEqual({ ok: true, value: 16 })
  })

  it('reaches zero and then refuses', () => {
    const ledger = createHpLedger()
    let value = 40
    let now = 1_000
    while (value > 0) {
      const result = applyHit(ledger, { ...args, nowMs: now }, rules)
      expect(result.ok).toBe(true)
      value = result.ok ? result.value : 0
      now += 1_000
    }
    expect(applyHit(ledger, { ...args, nowMs: now }, rules)).toEqual({ ok: false, reason: 'already dead' })
  })

  it('is case-insensitive about the caller', () => {
    const ledger = createHpLedger()
    applyHit(ledger, args, rules)
    expect(applyHit(ledger, { ...args, from: '0xabc', nowMs: 1_050 }, rules)).toEqual({
      ok: false,
      reason: 'rate limited'
    })
  })

  it('drops the previous wave when the phase turns over', () => {
    const ledger = createHpLedger()
    applyHit(ledger, { ...args, instanceId: instanceIdFor(1, 0) }, rules)
    applyHit(ledger, { ...args, instanceId: instanceIdFor(2, 0), from: '0xB' }, rules)
    clearWave(ledger, 2)
    expect([...ledger.hp.keys()]).toEqual([instanceIdFor(2, 0)])
    expect(ledger.lastHitMs.size).toBe(0)
  })

  it('cools a bite down per clone and per victim', () => {
    const ledger = createHpLedger()
    const bite = { damage: 8, cooldownMs: 1_500 }
    const args = { instanceId: 5, from: '0xABC', nowMs: 1_000, alive: true }
    expect(applyBite(ledger, args, bite)).toEqual({ ok: true, value: 8 })
    expect(applyBite(ledger, { ...args, nowMs: 2_000 }, bite)).toEqual({ ok: false, reason: 'on cooldown' })
    expect(applyBite(ledger, { ...args, from: '0xDEF', nowMs: 2_000 }, bite)).toEqual({ ok: true, value: 8 })
    expect(applyBite(ledger, { ...args, nowMs: 2_600 }, bite)).toEqual({ ok: true, value: 8 })
  })
})
