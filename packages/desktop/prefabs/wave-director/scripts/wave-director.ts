// Runs the waves. Drop ONE anywhere in the scene and pick the spawnable prefab
// it clones in the `zombie` param — there is nothing else to wire.
//
// The server never holds a zombie entity: it holds the plan's identity (the
// tuple), the HP ledger and the validators. Every client rebuilds the identical
// plan from that tuple and clones the prefab locally, so a wave costs zero spawn
// messages and a mid-wave joiner reconstructs the same alive-set.
//
// Consumer scripts (a gun, a bite trigger) report outcomes through the ledger
// this prefab carries:
//
//   import { outcomes } from '../../custom/wave_director/scripts/runtime/outcomes'
//   import { spawnedFrom } from '../../custom/wave_director/scripts/runtime/spawner'
//   const id = spawnedFrom(hitEntity)?.instanceId
//   if (id !== undefined) outcomes('wave').report('hit', { instanceId: id })
import { Transform, type Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import { outcomes, type OutcomeEntry } from './runtime/outcomes'
import { createRng } from './runtime/rng'
import { markServerReady, startServerLife } from './runtime/serverLife'
import { serverState, type ServerState } from './runtime/serverState'
import { getServerTime, initTimeSync } from './runtime/timeSync'
import { plan as openPlannedPool, type Pool } from './runtime/spawner'
import {
  DEFAULT_WAVES,
  INSTANCE_STRIDE,
  aliveEntries,
  applyBite,
  applyHit,
  buildWavePlan,
  clearWave,
  createHpLedger,
  dueEntries,
  normalizeWaveRows,
  rowForPhase,
  toNumber,
  waveIndexForPhase,
  type HpLedger,
  type PlanEntry,
  type PlanTuple,
  type SpawnArea,
  type WavePlanConfig,
  type WaveRow
} from './pure/wavePlan'

/** A prefab id picked in the inspector's prefab dropdown. */
type PrefabRef = string

// The ledger key is the wire contract with consumer scripts; it outlives this
// file. outcomes() rides rpc, whose schemas seal with the engine, so it runs at
// module scope.
const LEDGER = 'wave'
const ledger = outcomes(LEDGER)

// Consumers read the live wave from here rather than importing this script: it
// is a Script-component class, not something another module may construct.
// Probed by shape — every prefab carries its own copy of everything.
const VIEW_KEY = '__dclWaveDirector_v1'

interface WaveDirectorView {
  wave: number
  phase: number
  planned: number
  alive: number
  entryOf(instanceId: number): PlanEntry | null
}

// The round loop publishes the phase tuple under this key, on both sides. Absent
// (no Round Loop placed), waves free-run off the synced clock instead.
const TUPLE_KEY = '__dclRoundTuple_v1'
const FALLBACK_PHASE_MS = 45_000
const DEFAULT_HP = 40
const DEFAULT_GUN_DAMAGE = 12
const DEFAULT_FIRE_RATE = 4
const DEFAULT_BITE_DAMAGE = 8
const DEFAULT_BITE_COOLDOWN_MS = 1_500
const DEFAULT_INNER_RADIUS = 8
const DEFAULT_OUTER_RADIUS = 16
const PUMP_S = 0.1
// Honest players fire a little faster than the nominal rate on a good frame.
const RATE_LIMIT_SLACK = 0.6
// How long a joiner waits for the ledger's catch-up walk before spawning anyway.
// Longer than outcomes' own retry budget, so the gate releases on the walk in the
// normal case and on the clock only when the server never answers at all.
const LEDGER_GATE_MS = 8_000

type Globals = Record<string, unknown>

function globalsBag(): Globals {
  return globalThis as unknown as Globals
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readTuple(): PlanTuple | null {
  const raw = record(globalsBag()[TUPLE_KEY])
  if (raw === null) return null
  if (typeof raw.phase !== 'number' || typeof raw.phaseStartMs !== 'number') return null
  return {
    seed: toNumber(raw.seed, 0),
    phase: Math.floor(raw.phase),
    phaseStartMs: Math.floor(raw.phaseStartMs),
    configVersion: toNumber(raw.configVersion, 0)
  }
}

// The generated src/scripts/game-config.ts publishes itself here. A scene
// without one runs on the defaults above rather than on nothing.
function gameConfig(): Record<string, unknown> {
  return record(globalsBag().__dclGameConfig_v1) ?? {}
}

function configSection(name: string): Record<string, unknown> {
  return record(gameConfig()[name]) ?? {}
}

interface SavedWaves {
  phase: number
  deadIds: number[]
}

export class WaveDirector {
  private pool: Pool | null = null
  private tuple: PlanTuple = { seed: 0, phase: 0, phaseStartMs: 0, configVersion: 0 }
  /** Is the tuple the Round Loop's? Then only its wave phases spawn. */
  private fromRoundLoop = false
  private entries: PlanEntry[] = []
  private rows: readonly WaveRow[] = DEFAULT_WAVES
  private hp = DEFAULT_HP
  private dead = new Set<number>()
  private ledgerState: HpLedger = createHpLedger()
  private saved: ServerState<SavedWaves> | null = null
  private serverSide = false
  private accum = 0
  private gateUntilMs = 0

  constructor(
    public src: string,
    public entity: Entity,
    /** The spawnable prefab cloned for every planned zombie */
    public zombie: PrefabRef = '',
    /** Game Config table the wave counts come from */
    public wavesTable: string = 'waves'
  ) {}

  start(): void {
    initTimeSync()
    startServerLife('wave-director')
    this.serverSide = isServer()
    this.readTupleNow()
    this.gateUntilMs = getServerTime() + LEDGER_GATE_MS
    if (this.serverSide) this.startServer()
    else this.startClient()
    this.rebuild(getServerTime())
  }

  update(dt: number): void {
    this.accum += dt
    if (this.accum < PUMP_S) return
    this.accum = 0
    const now = getServerTime()
    this.syncTuple(now)
    if (this.serverSide) return
    this.spawnDue(now)
    this.publish()
  }

  // --- server -------------------------------------------------------------

  private startServer(): void {
    const state = serverState<SavedWaves>({
      key: 'wave-director',
      defaults: () => ({ phase: -1, deadIds: [] }),
      persist: true
    })
    this.saved = state

    ledger.validate('hit', (payload, from) => {
      const now = getServerTime()
      this.syncTuple(now)
      const instanceId = Math.floor(toNumber(payload.instanceId, -1))
      const weapons = configSection('weapons')
      const fireRate = Math.max(0.5, toNumber(weapons.fireRate, DEFAULT_FIRE_RATE))
      const result = applyHit(
        this.ledgerState,
        { instanceId, from, nowMs: now, maxHp: this.hp, alive: this.isAlive(instanceId, now) },
        {
          damage: Math.max(0, toNumber(weapons.gunDamage, DEFAULT_GUN_DAMAGE)),
          minIntervalMs: (1000 / fireRate) * RATE_LIMIT_SLACK
        }
      )
      if (result.ok && result.value <= 0) this.noteDead(instanceId)
      return result
    })

    ledger.validate('bite', (payload, from) => {
      const now = getServerTime()
      this.syncTuple(now)
      const instanceId = Math.floor(toNumber(payload.instanceId, -1))
      return applyBite(
        this.ledgerState,
        { instanceId, from, nowMs: now, alive: this.isAlive(instanceId, now) },
        {
          damage: Math.max(0, toNumber(configSection('zombie').biteDamage, DEFAULT_BITE_DAMAGE)),
          cooldownMs: DEFAULT_BITE_COOLDOWN_MS
        }
      )
    })

    markServerReady('wave-director')
    void state.restore().then(() => {
      const saved = state.get()
      if (saved.phase !== this.tuple.phase) return
      for (const id of saved.deadIds) this.dead.add(id)
    })
  }

  private noteDead(instanceId: number): void {
    this.dead.add(instanceId)
    this.saved?.patch({ phase: this.tuple.phase, deadIds: [...this.dead] })
  }

  private isAlive(instanceId: number, nowMs: number): boolean {
    if (this.dead.has(instanceId)) return false
    const entry = this.entryOf(instanceId)
    return entry !== null && entry.atMs <= nowMs
  }

  // --- client -------------------------------------------------------------

  private startClient(): void {
    if (this.zombie === '') {
      console.log('[WaveDirector] no zombie prefab picked — set the "zombie" param to a spawnable prefab')
      return
    }
    // A stale prefab ref (Spawnable turned off, prefab deleted) makes openPool
    // throw, and a throw out of start() aborts every script the runner has not
    // started yet plus the scene's own main(). One dropdown must not kill a scene.
    try {
      this.pool = openPlannedPool(this.zombie, (tuple) => buildWavePlan(tuple, this.planConfig(), createRng), {
        outcomes: ['hit', 'bite'],
        onSpawn: (entity, instanceId) => this.place(entity, instanceId)
      })
    } catch (error) {
      console.log('[WaveDirector] the "zombie" param is not a Spawnable prefab —', error)
      return
    }
    for (const entry of ledger.snapshot()) this.applyOutcome(entry)
    ledger.onOutcome((entry) => this.applyOutcome(entry))
  }

  private applyOutcome(entry: OutcomeEntry): void {
    if (entry.kind !== 'hit' || entry.value > 0) return
    this.dead.add(entry.instanceId)
    const entity = this.pool?.entityOf(entry.instanceId) ?? null
    if (entity !== null) this.pool?.release(entity)
  }

  private spawnDue(nowMs: number): void {
    const pool = this.pool
    if (pool === null) return
    // A joiner's `dead` set is empty until the ledger's catch-up walk lands one
    // round trip later, so spawning now materialises every clone the room already
    // killed and releases them again a moment after. Wait for the walk — and stop
    // waiting on the clock, so a server that never answers cannot freeze the waves.
    if (!ledger.isSynced() && nowMs < this.gateUntilMs) return
    for (const entry of dueEntries(this.entries, nowMs)) {
      if (this.dead.has(entry.instanceId)) continue
      if (pool.entityOf(entry.instanceId) !== null) continue
      pool.acquire(entry.instanceId)
    }
  }

  private place(entity: Entity, instanceId: number): void {
    const entry = this.entryOf(instanceId)
    if (entry === null) return
    const transform = Transform.getMutableOrNull(entity)
    if (transform === null) return
    const x = toNumber(entry.init.x, 0)
    const y = toNumber(entry.init.y, 0)
    const z = toNumber(entry.init.z, 0)
    const area = this.spawnArea()
    transform.position = Vector3.create(x, y, z)
    transform.rotation = Quaternion.fromEulerDegrees(
      0,
      (Math.atan2(area.centerX - x, area.centerZ - z) * 180) / Math.PI,
      0
    )
  }

  // --- shared -------------------------------------------------------------

  private currentTuple(): PlanTuple {
    const published = readTuple()
    if (published !== null) return published
    // Free-running fallback: getServerTime() is the same clock everywhere, so
    // every side still lands on one phase and one plan without a Round Loop.
    const now = getServerTime()
    const phase = Math.floor(now / FALLBACK_PHASE_MS)
    return {
      seed: 1,
      phase,
      phaseStartMs: phase * FALLBACK_PHASE_MS,
      configVersion: Math.floor(toNumber(gameConfig().version, 0))
    }
  }

  /** Reads the tuple AND where it came from — the plan's shape depends on both. */
  private readTupleNow(): PlanTuple {
    this.fromRoundLoop = readTuple() !== null
    this.tuple = this.currentTuple()
    return this.tuple
  }

  private syncTuple(nowMs: number): void {
    const previous = this.tuple
    const next = this.readTupleNow()
    const sameIdentity =
      next.phase === previous.phase &&
      next.seed === previous.seed &&
      next.configVersion === previous.configVersion
    if (sameIdentity && next.phaseStartMs === previous.phaseStartMs) return
    if (sameIdentity) {
      // Only the phase start moved — a held lobby rebases it every second. Re-time
      // the plan so two clients that joined minutes apart still agree on when each
      // entry is due, and keep the dead set, the ledger and the live clones.
      this.entries = buildWavePlan(this.tuple, this.planConfig(), createRng)
      if (this.serverSide) return
      this.spawnDue(nowMs)
      this.publish()
      return
    }
    this.dead.clear()
    clearWave(this.ledgerState, next.phase)
    this.pool?.releaseAll()
    this.rebuild(nowMs)
  }

  /**
   * Re-pin the config and rebuild the plan. The config is read once per phase —
   * a table edited mid-wave must not shift a plan clients already started.
   */
  private rebuild(nowMs: number): void {
    const table = normalizeWaveRows(gameConfig()[this.wavesTable])
    this.rows = table.length > 0 ? table : DEFAULT_WAVES
    this.hp = Math.max(1, Math.floor(toNumber(configSection('zombie').hp, DEFAULT_HP)))
    this.entries = buildWavePlan(this.tuple, this.planConfig(), createRng)
    if (this.serverSide) return
    // A joiner mid-phase catches up here: everything already due and not dead.
    this.spawnDue(nowMs)
    this.publish()
  }

  private planConfig(): WavePlanConfig {
    return {
      rows: this.rows,
      area: this.spawnArea(),
      max: this.pool?.max ?? INSTANCE_STRIDE,
      hp: this.hp,
      activeMs: FALLBACK_PHASE_MS,
      roundLoop: this.fromRoundLoop
    }
  }

  private spawnArea(): SpawnArea {
    const transform = Transform.getOrNull(this.entity)
    const center = transform?.position ?? Vector3.Zero()
    const zombie = configSection('zombie')
    return {
      centerX: center.x,
      centerZ: center.z,
      y: center.y,
      innerRadius: Math.max(0, toNumber(zombie.spawnRadiusMin, DEFAULT_INNER_RADIUS)),
      outerRadius: Math.max(1, toNumber(zombie.spawnRadiusMax, DEFAULT_OUTER_RADIUS))
    }
  }

  private entryOf(instanceId: number): PlanEntry | null {
    for (const entry of this.entries) if (entry.instanceId === instanceId) return entry
    return null
  }

  private publish(): void {
    const waveIndex = waveIndexForPhase(this.tuple.phase, this.fromRoundLoop)
    const view: WaveDirectorView = {
      // 0 outside a wave: a HUD must not read "WAVE 3" during the intermission.
      wave: waveIndex === null ? 0 : rowForPhase(this.rows, waveIndex).wave,
      phase: this.tuple.phase,
      planned: this.entries.length,
      alive: aliveEntries(this.entries, getServerTime(), this.dead).length,
      entryOf: (instanceId: number) => this.entryOf(instanceId)
    }
    globalsBag()[VIEW_KEY] = view
  }
}
