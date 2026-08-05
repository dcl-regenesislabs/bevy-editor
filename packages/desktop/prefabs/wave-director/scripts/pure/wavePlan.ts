// Deterministic wave plan + the server-side HP ledger, ported from Dead Surge's
// buildWaveSpawnPlan and its zombieHitRequest validation. SDK-free on purpose:
// every value here is reconstructed identically by the server and by every
// client, so it must not depend on anything only one side can see.
//
// Two rules from the port shape the whole file:
//
// - The plan is a PURE function of the tuple {seed, phase, phaseStartMs,
//   configVersion} and the phase-pinned config. Every client — including one
//   that joins mid-wave — rebuilds the same spawns and the same alive-set with
//   no spawn message on the wire. Dead Surge scaled the group size by the room's
//   player count; two clients with different rosters would then disagree, so the
//   count comes from the wave table alone.
// - Damage is never read from the reporter's payload. The server derives it from
//   the config and rate-limits the reporter, which is what the shipped game did
//   (it re-derived weapon damage server-side and spent a per-shot allowance).
//
// Draw order is part of the contract: for each entry the rng is drawn twice, and
// always angle first, then radius. Adding a draw anywhere reshuffles every
// spawn point of every wave.

export type Rng = () => number

export interface WaveRow {
  wave: number
  count: number
  /** seconds between spawn groups */
  interval: number
  speedMult: number
}

export interface SpawnArea {
  centerX: number
  centerZ: number
  y: number
  innerRadius: number
  outerRadius: number
}

export interface PlanTuple {
  seed: number
  phase: number
  phaseStartMs: number
  configVersion: number
}

export interface PlanEntry {
  instanceId: number
  atMs: number
  init: Record<string, unknown>
}

export interface WavePlanConfig {
  rows: readonly WaveRow[]
  area: SpawnArea
  /** the spawnable prefab's max — a hard cap on one wave's count */
  max: number
  /** starting hp of one clone, from the config's zombie table */
  hp: number
  /** how long the phase spawns for; the last entry lands just inside it */
  activeMs: number
  /**
   * Is `phase` a Round Loop phase counter? Then only its WAVE phases spawn — the
   * lobby and every intermission plan nothing. Absent/false is the free-running
   * fallback, where every phase is a wave because there is nothing else to be.
   */
  roundLoop?: boolean
}

/** instanceIds are phase-striped so two waves never share a ledger key */
export const INSTANCE_STRIDE = 1024
export const GROUP_STAGGER_MS = 300
const GROUP_BASE = 2
const GROUP_MAX = 4
const GROUP_GROWTH_EVERY_WAVES = 3
const TAU = Math.PI * 2

export const DEFAULT_WAVES: readonly WaveRow[] = [
  { wave: 1, count: 6, interval: 2.5, speedMult: 1 },
  { wave: 2, count: 8, interval: 2.4, speedMult: 1 },
  { wave: 3, count: 10, interval: 2.3, speedMult: 1.05 },
  { wave: 4, count: 12, interval: 2.2, speedMult: 1.05 },
  { wave: 5, count: 14, interval: 2.1, speedMult: 1.1 },
  { wave: 6, count: 16, interval: 2, speedMult: 1.1 },
  { wave: 7, count: 18, interval: 1.9, speedMult: 1.15 },
  { wave: 8, count: 20, interval: 1.8, speedMult: 1.2 },
  { wave: 9, count: 24, interval: 1.7, speedMult: 1.25 },
  { wave: 10, count: 28, interval: 1.6, speedMult: 1.3 }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Cells of a Game Config table arrive as strings; numbers survive untouched. */
export function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/**
 * Read a `waves` table out of whatever the generated Game Config accessor holds.
 * Anything unusable yields [] and the caller falls back to DEFAULT_WAVES — a
 * half-filled table must never silently produce a wave of zero zombies.
 */
export function normalizeWaveRows(value: unknown): WaveRow[] {
  if (!Array.isArray(value)) return []
  const rows: WaveRow[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const count = Math.floor(toNumber(raw.count, 0))
    if (count <= 0) continue
    rows.push({
      wave: Math.max(1, Math.floor(toNumber(raw.wave, rows.length + 1))),
      count: Math.min(count, INSTANCE_STRIDE),
      interval: Math.max(0.1, toNumber(raw.interval, 2.5)),
      speedMult: Math.max(0.1, toNumber(raw.speedMult, 1))
    })
  }
  return rows
}

/**
 * Which row of the table a phase runs, or null when the phase is not a wave at
 * all. The Round Loop counts lobby (0), waves (odd) and intermissions (even > 0)
 * on ONE counter, so indexing the table by the raw phase both spawns a wave into
 * the lobby a creator is still waiting in and walks only the odd rows. Wave n
 * sits at phase 2n-1, so the row index is (phase - 1) / 2.
 *
 * Without a Round Loop the phase counter is the free-running clock's, where every
 * phase IS a wave — that path keeps the raw index and its table wrap-around.
 */
export function waveIndexForPhase(phase: number, fromRoundLoop: boolean): number | null {
  const index = Math.floor(phase)
  if (!Number.isFinite(index)) return null
  if (!fromRoundLoop) return index
  if (index <= 0 || index % 2 === 0) return null
  return (index - 1) / 2
}

/**
 * Rows cycle: index N takes row N mod rowCount, so the table loops instead of
 * running out. Takes a WAVE index (see waveIndexForPhase), never a raw phase.
 */
export function rowForPhase(rows: readonly WaveRow[], waveIndex: number): WaveRow {
  const table = rows.length > 0 ? rows : DEFAULT_WAVES
  const index = Math.floor(waveIndex)
  const safe = ((index % table.length) + table.length) % table.length
  return table[safe]
}

/** Dead Surge's group growth: +1 every three waves, clamped. */
export function groupSizeFor(waveNumber: number): number {
  const growth = Math.floor(Math.max(0, Math.floor(waveNumber) - 1) / GROUP_GROWTH_EVERY_WAVES)
  return Math.min(GROUP_MAX, GROUP_BASE + growth)
}

/** One 32-bit seed per (seed, phase, configVersion) — the plan's identity. */
export function planSeed(tuple: PlanTuple): number {
  let h = (Math.floor(tuple.seed) | 0) ^ 0x9e3779b9
  h = Math.imul(h ^ Math.floor(tuple.phase), 0x85ebca6b)
  h = Math.imul(h ^ Math.floor(tuple.configVersion), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export function instanceIdFor(phase: number, index: number): number {
  return Math.max(0, Math.floor(phase)) * INSTANCE_STRIDE + index
}

export function phaseOfInstance(instanceId: number): number {
  return Math.floor(instanceId / INSTANCE_STRIDE)
}

export function buildWavePlan(
  tuple: PlanTuple,
  config: WavePlanConfig,
  makeRng: (seed: number) => Rng
): PlanEntry[] {
  const waveIndex = waveIndexForPhase(tuple.phase, config.roundLoop === true)
  // A lobby or an intermission plans nothing: nobody gets jumped while the round
  // has not started, and the pool has nothing to acquire between waves.
  if (waveIndex === null) return []
  const row = rowForPhase(config.rows, waveIndex)
  const cap = Math.max(0, Math.min(Math.floor(config.max), INSTANCE_STRIDE))
  const count = Math.min(Math.max(0, Math.floor(row.count)), cap)
  if (count === 0) return []

  const group = groupSizeFor(row.wave)
  const intervalMs = Math.max(100, Math.round(row.interval * 1000))
  const start = Math.floor(tuple.phaseStartMs)
  const lastAtMs = start + Math.max(0, Math.floor(config.activeMs) - 100)
  const inner = Math.max(0, config.area.innerRadius)
  const span = Math.max(0, config.area.outerRadius - inner)
  const rng = makeRng(planSeed(tuple))
  const entries: PlanEntry[] = []

  for (let i = 0; i < count; i++) {
    const slot = Math.floor(i / group)
    const atMs = Math.min(start + slot * intervalMs + (i % group) * GROUP_STAGGER_MS, lastAtMs)
    const angle = rng() * TAU
    const radius = inner + rng() * span
    entries.push({
      instanceId: instanceIdFor(tuple.phase, i),
      atMs,
      init: {
        x: config.area.centerX + Math.cos(angle) * radius,
        y: config.area.y,
        z: config.area.centerZ + Math.sin(angle) * radius,
        speedMult: row.speedMult,
        hp: Math.max(1, Math.floor(config.hp)),
        wave: row.wave
      }
    })
  }
  return entries
}

/** Entries whose spawn moment has passed. Entries are emitted in atMs order. */
export function dueEntries(entries: readonly PlanEntry[], nowMs: number): PlanEntry[] {
  return entries.filter((entry) => entry.atMs <= nowMs)
}

/**
 * The alive-set a joiner must reconstruct: everything already due that the
 * ledger has not reported dead.
 */
export function aliveEntries(
  entries: readonly PlanEntry[],
  nowMs: number,
  dead: ReadonlySet<number>
): PlanEntry[] {
  return dueEntries(entries, nowMs).filter((entry) => !dead.has(entry.instanceId))
}

export interface HpLedger {
  hp: Map<number, number>
  lastHitMs: Map<string, number>
}

export interface HitRules {
  /** derived server-side from the config, never from the payload */
  damage: number
  /** floor between two accepted reports from the same wallet */
  minIntervalMs: number
}

export interface BiteRules {
  damage: number
  /** floor between two accepted bites of the same wallet by the same clone */
  cooldownMs: number
}

export type LedgerOutcome = { ok: true; value: number } | { ok: false; reason: string }

export function createHpLedger(): HpLedger {
  return { hp: new Map(), lastHitMs: new Map() }
}

export function clearWave(ledger: HpLedger, phase: number): void {
  for (const id of [...ledger.hp.keys()]) {
    if (phaseOfInstance(id) !== phase) ledger.hp.delete(id)
  }
  ledger.lastHitMs.clear()
}

export function hpOf(ledger: HpLedger, instanceId: number, maxHp: number): number {
  const stored = ledger.hp.get(instanceId)
  return stored === undefined ? Math.max(1, Math.floor(maxHp)) : stored
}

/**
 * Server side. `alive` is the caller's answer to "is this instance in the plan
 * and already due?" — the ledger never invents an instance it was not told about,
 * so a client cannot damage a clone that no plan ever produced.
 * Returns the remaining hp; 0 means the clone died on this hit.
 */
export function applyHit(
  ledger: HpLedger,
  args: { instanceId: number; from: string; nowMs: number; maxHp: number; alive: boolean },
  rules: HitRules
): LedgerOutcome {
  const id = Math.floor(args.instanceId)
  if (!Number.isFinite(id) || id < 0) return { ok: false, reason: 'bad instance' }
  if (!args.alive) return { ok: false, reason: 'not in the current plan' }
  const hp = hpOf(ledger, id, args.maxHp)
  if (hp <= 0) return { ok: false, reason: 'already dead' }
  const key = args.from.toLowerCase()
  const last = ledger.lastHitMs.get(key)
  if (last !== undefined && args.nowMs - last < rules.minIntervalMs) {
    return { ok: false, reason: 'rate limited' }
  }
  ledger.lastHitMs.set(key, args.nowMs)
  const next = Math.max(0, hp - Math.max(0, rules.damage))
  ledger.hp.set(id, next)
  return { ok: true, value: next }
}

/**
 * Server side. A clone biting a player: the damage is the config's, the payload
 * only names the biter, and one clone may only bite one wallet every cooldown.
 * Returns the damage the player should take.
 */
export function applyBite(
  ledger: HpLedger,
  args: { instanceId: number; from: string; nowMs: number; alive: boolean },
  rules: BiteRules
): LedgerOutcome {
  const id = Math.floor(args.instanceId)
  if (!Number.isFinite(id) || id < 0) return { ok: false, reason: 'bad instance' }
  if (!args.alive) return { ok: false, reason: 'not in the current plan' }
  if ((ledger.hp.get(id) ?? 1) <= 0) return { ok: false, reason: 'already dead' }
  const key = `bite:${id}:${args.from.toLowerCase()}`
  const last = ledger.lastHitMs.get(key)
  if (last !== undefined && args.nowMs - last < rules.cooldownMs) {
    return { ok: false, reason: 'on cooldown' }
  }
  ledger.lastHitMs.set(key, args.nowMs)
  return { ok: true, value: Math.max(0, rules.damage) }
}
