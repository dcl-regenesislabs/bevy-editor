// The observer that rides inside the zombie-arena fixture scene.
//
// Everything this file asserts, it asserts from the CLIENT side, on purpose: the
// server's own console is a diagnostic, but a hit that reaches the ledger and
// comes back as a broadcast entry is PROOF the Multiplayer Server booted, armed
// the Wave Director's validators and applied them. So the probe never reads a
// server log to decide; it reads what the server sent back.
//
// It re-derives the wave plan independently of the Wave Director — same tuple,
// same phase-pinned config, its own call to buildWavePlan — and diffs the two.
// That is the determinism claim stated precisely: seed governs the spawn list and
// the alive-set, not the trajectories.
//
// LOCAL PREVIEW, stated once: `sdk-commands start` serves the scene to a client
// and nothing else — there is no local Multiplayer Server, `isServer()` is false
// everywhere, and the Round Loop's server branch (the only writer of the round
// tuple) never runs. The Wave Director already handles that with a free-running
// tuple derived from the shared clock; this file mirrors that fallback so the
// client-side claims — same tuple, same plan, same alive-set — are provable
// without a deployment, and stamps every record with `serverTuple` so the harness
// reports the server-authored claims as skipped rather than passed.
//
// Records leave the scene twice: as a console line (scene_logs) and as a TextShape
// on a throwaway entity (crdt_snapshot). The CRDT copy is authoritative because
// the log ring truncates long lines.
import { Transform, TextShape, engine, type Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import { outcomes, type OutcomeEntry } from '../../custom/wave_director/scripts/runtime/outcomes'
import { createRng } from '../../custom/wave_director/scripts/runtime/rng'
import { getServerTime, initTimeSync } from '../../custom/wave_director/scripts/runtime/timeSync'
import {
  DEFAULT_WAVES,
  INSTANCE_STRIDE,
  aliveEntries,
  buildWavePlan,
  dueEntries,
  normalizeWaveRows,
  toNumber,
  type PlanEntry,
  type PlanTuple,
  type WavePlanConfig,
  type WaveRow
} from '../../custom/wave_director/scripts/pure/wavePlan'

const MARK = '[ZOMBIE-ARENA]'
const TUPLE_KEY = '__dclRoundTuple_v1'
const VIEW_KEY = '__dclWaveDirector_v1'
const CONFIG_KEY = '__dclGameConfig_v1'
const LEDGER = 'wave'

// Mirrors of the Wave Director's own constants. They are duplicated rather than
// imported because the point is to reconstruct the plan INDEPENDENTLY — if the
// director changes one of these and the probe does not, the diff must fail.
const FALLBACK_PHASE_MS = 45_000
const POOL_MAX = 64
const DEFAULT_INNER_RADIUS = 8
const DEFAULT_OUTER_RADIUS = 16
const DEFAULT_HP = 40

/** Spacing between reported hits: the server floors them at (1000/fireRate)*0.6. */
const HIT_INTERVAL_S = 0.4
const MAX_HITS = 12
const PUMP_S = 0.25

const ledger = outcomes(LEDGER)

type Globals = Record<string, unknown>

function bag(): Globals {
  return globalThis as unknown as Globals
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function section(name: string): Record<string, unknown> {
  return record(record(bag()[CONFIG_KEY])?.[name]) ?? {}
}

function readTuple(): PlanTuple | null {
  const raw = record(bag()[TUPLE_KEY])
  if (raw === null || typeof raw.phase !== 'number' || typeof raw.phaseStartMs !== 'number') return null
  return {
    seed: toNumber(raw.seed, 0),
    phase: Math.floor(raw.phase),
    phaseStartMs: Math.floor(raw.phaseStartMs),
    configVersion: toNumber(raw.configVersion, 0)
  }
}

// The Wave Director's own fallback, re-derived rather than imported — the whole
// point of this file is that two independent reconstructions agree, and an
// imported one would agree by construction. configVersion still comes off the
// generated accessor, so a run on this path STILL proves game-config.ts reached
// the bundle.
function freeRunningTuple(): PlanTuple {
  const now = getServerTime()
  const phase = Math.floor(now / FALLBACK_PHASE_MS)
  return {
    seed: 1,
    phase,
    phaseStartMs: phase * FALLBACK_PHASE_MS,
    configVersion: Math.floor(toNumber(record(bag()[CONFIG_KEY])?.version, 0))
  }
}

interface DirectorView {
  wave: number
  phase: number
  planned: number
  alive: number
  entryOf(instanceId: number): PlanEntry | null
}

function readView(): DirectorView | null {
  const raw = record(bag()[VIEW_KEY])
  if (raw === null || typeof raw.planned !== 'number' || typeof raw.entryOf !== 'function') return null
  return raw as unknown as DirectorView
}

function sameTuple(a: PlanTuple, b: PlanTuple): boolean {
  return a.seed === b.seed && a.phase === b.phase && a.configVersion === b.configVersion
}

/** Positions are floats out of two independent rng walks; compare them as such. */
function entriesMatch(a: PlanEntry, b: PlanEntry): boolean {
  if (a.instanceId !== b.instanceId || a.atMs !== b.atMs) return false
  const keys = ['x', 'y', 'z', 'speedMult', 'hp', 'wave']
  for (const key of keys) {
    const left = toNumber(a.init[key], Number.NaN)
    const right = toNumber(b.init[key], Number.NaN)
    if (!(Math.abs(left - right) < 1e-6)) return false
  }
  return true
}

export class ArenaProbe {
  private published = new Set<string>()
  private accum = 0
  private tuple: PlanTuple | null = null
  private entries: PlanEntry[] = []
  private target = -1
  private hits = 0
  private sinceHit = 0
  private died = false
  private aliveBeforeDeath = -1
  private outcomeSeen: OutcomeEntry[] = []
  private serverTuple = false

  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start(): void {
    initTimeSync()
    // The server half of the fixture reports once and stands down: everything the
    // probe checks about it is visible on the wire, not in its console.
    this.publish('boot', { server: isServer(), src: this.src, entity: Number(this.entity) })
    if (isServer()) return
    ledger.onOutcome((entry) => {
      this.outcomeSeen.push(entry)
      this.applyOutcome(entry)
    })
  }

  update(dt: number): void {
    if (isServer()) return
    this.accum += dt
    this.sinceHit += dt
    if (this.accum < PUMP_S) return
    this.accum = 0

    const published = readTuple()
    this.serverTuple = published !== null
    const tuple = published ?? freeRunningTuple()
    const view = readView()
    if (view === null) return
    if (this.tuple === null || !sameTuple(this.tuple, tuple)) this.rebuild(tuple, view)
    if (this.tuple === null) return

    this.checkPlan(view)
    this.fire(view)
  }

  // --- the four claims ------------------------------------------------------

  private rebuild(tuple: PlanTuple, view: DirectorView): void {
    this.tuple = tuple
    this.entries = buildWavePlan(tuple, this.planConfig(), createRng)
    this.hits = 0
    this.died = false
    this.target = -1
    this.publish('tuple', {
      seed: tuple.seed,
      phase: tuple.phase,
      phaseStartMs: tuple.phaseStartMs,
      configVersion: tuple.configVersion,
      wave: view.wave,
      planned: this.entries.length,
      directorPlanned: view.planned
    })

    // Same tuple twice ⇒ identical list; a neighbouring seed ⇒ a different one.
    // Without the second half the first is satisfied by a plan that ignores the
    // seed entirely.
    const again = buildWavePlan(tuple, this.planConfig(), createRng)
    const other = buildWavePlan({ ...tuple, seed: tuple.seed + 1 }, this.planConfig(), createRng)
    this.publish('determinism', {
      phase: tuple.phase,
      count: this.entries.length,
      sameSeedIdentical: this.entries.length === again.length && this.entries.every((e, i) => entriesMatch(e, again[i])),
      otherSeedDiffers:
        other.length !== this.entries.length || other.some((e, i) => !entriesMatch(e, this.entries[i]))
    })
  }

  // The reconstruction the Wave Director did, and the one this file did, from the
  // same four numbers. Field-for-field on every planned entry.
  private checkPlan(view: DirectorView): void {
    if (this.entries.length === 0) return
    const mismatched: number[] = []
    let compared = 0
    for (const entry of this.entries) {
      const theirs = view.entryOf(entry.instanceId)
      if (theirs === null) {
        mismatched.push(entry.instanceId)
        continue
      }
      compared += 1
      if (!entriesMatch(entry, theirs)) mismatched.push(entry.instanceId)
    }
    this.publish('plan', {
      phase: this.tuple?.phase ?? -1,
      count: this.entries.length,
      compared,
      mismatched: mismatched.slice(0, 8),
      stride: INSTANCE_STRIDE,
      first: this.entries[0].instanceId,
      firstAtMs: this.entries[0].atMs
    })
  }

  // Shoot the first clone that the plan says is already out, once every
  // HIT_INTERVAL_S, until the ledger reports it at zero. Nothing here decides the
  // damage: the payload names the instance, the server subtracts its own number.
  private fire(view: DirectorView): void {
    // No server tuple means no Multiplayer Server, so ledger.report() has nobody
    // to validate it. Firing anyway would fill the log with rpc rejections and
    // prove nothing.
    if (!this.serverTuple) return
    if (this.died || this.hits >= MAX_HITS) return
    if (this.target < 0) {
      const due = dueEntries(this.entries, getServerTime())
      if (due.length === 0) return
      this.target = due[0].instanceId
      this.aliveBeforeDeath = view.alive
      this.publish('target', { instanceId: this.target, due: due.length, alive: view.alive })
    }
    if (this.sinceHit < HIT_INTERVAL_S) return
    this.sinceHit = 0
    this.hits += 1
    ledger.report('hit', { instanceId: this.target, amount: 12 })
  }

  private applyOutcome(entry: OutcomeEntry): void {
    if (entry.instanceId !== this.target) return
    this.publish(`hit:${entry.seq}`, {
      tag: 'hit',
      seq: entry.seq,
      kind: entry.kind,
      instanceId: entry.instanceId,
      value: entry.value,
      reported: this.hits
    })
    if (entry.kind !== 'hit' || entry.value > 0 || this.died) return
    this.died = true
    this.publish('died', { instanceId: entry.instanceId, hitsReported: this.hits, seq: entry.seq })
    this.reconstruct()
  }

  // The rejoin path, run in-process: a client that has just arrived holds nothing
  // but the tuple, the config and the ledger's history. Rebuild the plan from
  // scratch, fast-forward the history into a dead-set, and the alive-set that
  // falls out must be the one the running client already has — minus the corpse.
  private reconstruct(): void {
    const tuple = this.tuple
    if (tuple === null) return
    const joiner = buildWavePlan(tuple, this.planConfig(), createRng)
    const dead = new Set<number>()
    for (const entry of ledger.snapshot()) {
      if (entry.kind === 'hit' && entry.value <= 0) dead.add(entry.instanceId)
    }
    const now = getServerTime()
    const alive = aliveEntries(joiner, now, dead)
    const withoutRepair = aliveEntries(joiner, now, new Set<number>())
    this.publish('rejoin', {
      planned: joiner.length,
      alive: alive.length,
      aliveIgnoringLedger: withoutRepair.length,
      excludesTarget: !alive.some((e) => e.instanceId === this.target),
      deadIds: [...dead].slice(0, 8),
      ledgerEntries: ledger.snapshot().length,
      observed: this.outcomeSeen.length,
      aliveBefore: this.aliveBeforeDeath
    })
  }

  // --- shared ---------------------------------------------------------------

  private planConfig(): WavePlanConfig {
    const rows: readonly WaveRow[] = normalizeWaveRows(record(bag()[CONFIG_KEY])?.waves)
    const zombie = section('zombie')
    const here = Transform.getOrNull(this.entity)?.position ?? Vector3.Zero()
    return {
      rows: rows.length > 0 ? rows : DEFAULT_WAVES,
      area: {
        centerX: here.x,
        centerZ: here.z,
        y: here.y,
        innerRadius: Math.max(0, toNumber(zombie.spawnRadiusMin, DEFAULT_INNER_RADIUS)),
        outerRadius: Math.max(1, toNumber(zombie.spawnRadiusMax, DEFAULT_OUTER_RADIUS))
      },
      max: POOL_MAX,
      hp: Math.max(1, Math.floor(toNumber(zombie.hp, DEFAULT_HP))),
      activeMs: FALLBACK_PHASE_MS
    }
  }

  // One entity per record. A record is written once per key so a rebuild cannot
  // interleave two runs of the same claim.
  private publish(key: string, value: Record<string, unknown>): void {
    if (this.published.has(key)) return
    this.published.add(key)
    const line = `${MARK} ${JSON.stringify({ tag: key.split(':')[0], serverTuple: this.serverTuple, ...value })}`
    console.log(line)
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.create(0, -100, 0) })
    TextShape.create(entity, { text: line, fontSize: 1 })
  }
}
