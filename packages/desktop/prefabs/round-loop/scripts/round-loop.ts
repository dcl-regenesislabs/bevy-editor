// The round clock every other kit prefab hangs off: one server-owned phase
// machine (lobby → wave → intermission → wave → …) published as the four numbers
// `{seed, phase, phaseStartMs, configVersion}`, plus a drift-free countdown each
// client derives from server time.
//
// Nothing here is a timer. The server writes a phase START, every countdown is
// `deadline - getServerTime()`, and a client that joins mid-wave or a server that
// restarts mid-round lands on the same phase as everyone else by arithmetic.
//
// Consumers read the tuple off the shared bus, never by importing this file —
// see ai.md in this folder for the shape of `globalThis.__dclRoundLoop_v1`.
import { Schemas, TextShape, engine, type Entity } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { protectedSync } from './runtime/protectedSync'
import { createRpc } from './runtime/rpc'
import { interval } from './runtime/schedule'
import { markServerReady, serverLifeState, startServerLife } from './runtime/serverLife'
import { serverState, type ServerState } from './runtime/serverState'
import { getServerTime, initTimeSync, isTimeSyncReady } from './runtime/timeSync'
import {
  advance,
  catchUp,
  countdownSeconds,
  durationsFromSeconds,
  formatCountdown,
  holdAt,
  isReady,
  phaseEndsAtMs,
  phaseLabel,
  requiredPlayers,
  sanitizeTuple,
  startRound,
  type PhaseDurations,
  type RoundTuple
} from './pure/phases'

// Namespaced wire names and the bus key are the contract with consumer scripts;
// they outlive this file. createRpc registers schemas, so it runs at module scope.
const rpc = createRpc('round')

const BUS_KEY = '__dclRoundLoop_v1'
// The bare tuple, mirrored for consumers that want the four numbers and nothing
// else (the Wave Director rebuilds its plan from exactly these). Kept in step
// with the bus by publish() so there is one writer, not two.
const TUPLE_KEY = '__dclRoundTuple_v1'
const PHASE_COMPONENT = 'runtime::RoundPhase'
const STATE_KEY = 'round-loop'
const SYNC_ID = 3101
const SERVER_TICK_S = 0.25
const CLIENT_TICK_S = 0.2
const PRESENCE_PING_S = 5
// Three missed pings before a player stops counting: long enough to survive a
// hitch, short enough that an empty scene parks within one lobby.
const PRESENCE_TTL_MS = 16_000
// A restored tuple older than this many phases is not a round anyone is still in.
const MAX_CATCHUP_STEPS = 512
const REBASE_TOLERANCE_MS = 1000

function defineRoundPhase() {
  return engine.defineComponent(PHASE_COMPONENT, {
    seed: Schemas.Int64,
    phase: Schemas.Int,
    phaseStartMs: Schemas.Int64,
    configVersion: Schemas.Int,
    parked: Schemas.Boolean,
    present: Schemas.Int
  })
}

// Idempotent def: a scene may hold two copies of this file the day a second kit
// prefab carries it, and defineComponent twice throws.
const RoundPhase =
  (engine.getComponentOrNull(PHASE_COMPONENT) as ReturnType<typeof defineRoundPhase> | null) ?? defineRoundPhase()

interface RoundRegistry {
  tuple: RoundTuple | null
  durations: PhaseDurations
  parked: boolean
  present: number
  configVersion: number
  publish(tuple: RoundTuple, durations: PhaseDurations, parked: boolean, present: number): void
  subscribe(fn: (tuple: RoundTuple) => void): () => void
  reportConfigVersion(version: number): void
}

// Two prefabs would bundle two copies of this module, so the bus lives on
// globalThis and is probed by SHAPE — `instanceof` cannot see across copies.
function isRegistry(value: unknown): value is RoundRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'publish' in value &&
    typeof value.publish === 'function' &&
    'subscribe' in value &&
    typeof value.subscribe === 'function'
  )
}

function createRegistry(): RoundRegistry {
  const listeners: ((tuple: RoundTuple) => void)[] = []
  const registry: RoundRegistry = {
    tuple: null,
    durations: durationsFromSeconds(30, 90, 20),
    parked: true,
    present: 0,
    configVersion: 0,
    publish(tuple, durations, parked, present) {
      const previous = registry.tuple
      registry.tuple = tuple
      ;(globalThis as unknown as Record<string, unknown>)[TUPLE_KEY] = {
        seed: tuple.seed,
        phase: tuple.phase,
        phaseStartMs: tuple.phaseStartMs,
        configVersion: tuple.configVersion
      }
      registry.durations = durations
      registry.parked = parked
      registry.present = present
      const boundary = previous === null || previous.phase !== tuple.phase || previous.seed !== tuple.seed
      if (!boundary) return
      for (const fn of [...listeners]) fn(tuple)
    },
    subscribe(fn) {
      listeners.push(fn)
      if (registry.tuple !== null) fn(registry.tuple)
      return () => {
        const at = listeners.indexOf(fn)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
    reportConfigVersion(version) {
      if (Number.isFinite(version) && version >= 0) registry.configVersion = Math.floor(version)
    }
  }
  return registry
}

function registry(): RoundRegistry {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[BUS_KEY]
  if (isRegistry(current)) return current
  const created = createRegistry()
  globals[BUS_KEY] = created
  return created
}

/**
 * The version a phase pins. reportConfigVersion() wins when a script sets it;
 * otherwise the generated src/scripts/game-config.ts publishes its own version
 * on globalThis, which is the only channel a prefab folder can read it through.
 */
function configVersionNow(): number {
  const reported = registry().configVersion
  if (reported > 0) return reported
  const bag = (globalThis as unknown as Record<string, unknown>).__dclGameConfig_v1
  const version = typeof bag === 'object' && bag !== null ? (bag as Record<string, unknown>).version : undefined
  return typeof version === 'number' && Number.isFinite(version) && version >= 0 ? Math.floor(version) : 0
}

function freshSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff)
}

function syncedEntity(): Entity | null {
  for (const [entity] of engine.getEntitiesWith(RoundPhase)) return entity
  return null
}

// One Round Loop drives the clock. A second placed copy renders the countdown but
// never touches the phase machine — two FSMs writing one synced entity is a fight
// with no winner, and the creator would only see the timer stutter.
let claimed = false

export class RoundLoop {
  private primary = false
  private accum = 0
  private tuple: RoundTuple = startRound(0, 0, 0)
  private parked = true
  private present = 0
  private lastWritten: RoundTuple | null = null
  private seen = new Map<string, number>()
  private store: ServerState<RoundTuple> | null = null
  private syncEntity: Entity | null = null

  constructor(
    public src: string,
    public entity: Entity,
    /** Seconds the lobby counts down once enough players are in */ public lobbySeconds: number = 30,
    /** Seconds a wave lasts */ public waveSeconds: number = 90,
    /** Seconds of intermission between waves */ public intermissionSeconds: number = 20,
    /** Players needed before the first wave starts */ public minPlayers: number = 2,
    /** Let one player start the round alone (ignores minPlayers) */ public soloMode: boolean = true
  ) {}

  private get durations(): PhaseDurations {
    return durationsFromSeconds(this.lobbySeconds, this.waveSeconds, this.intermissionSeconds)
  }

  start(): void {
    this.primary = !claimed
    claimed = true
    initTimeSync()
    startServerLife('round-loop')
    if (!isServer()) {
      if (this.primary) this.startPresencePings()
      this.render()
      return
    }
    if (!this.primary) {
      console.log('[roundLoop] a second Round Loop is placed — only the first drives the phase clock')
      return
    }
    void this.startServer()
  }

  update(dt: number): void {
    if (isServer()) return
    this.accum += dt
    if (this.accum < CLIENT_TICK_S) return
    this.accum = 0
    this.render()
  }

  // --- server ------------------------------------------------------------

  private async startServer(): Promise<void> {
    // Everything a client can reach is armed BEFORE the first heartbeat, so a
    // client that sees the server alive can never race an unregistered handler.
    const entity = engine.addEntity()
    this.syncEntity = entity
    protectedSync({
      entity,
      syncId: SYNC_ID,
      components: [RoundPhase],
      // The phase is the server's answer to "what happens next" — there is no
      // client-originated write that could ever be legitimate.
      validate: () => false
    })
    rpc.handle('round.hello', (_body, from) => this.presence(from))
    rpc.handle('round.ping', (_body, from) => this.presence(from))

    const now = Date.now()
    const store = serverState<RoundTuple>({
      key: STATE_KEY,
      defaults: () => startRound(freshSeed(), now, 0),
      persist: true
    })
    this.store = store
    await store.restore()
    this.tuple = this.rehydrate(sanitizeTuple(store.get(), startRound(freshSeed(), now, 0)), Date.now())
    this.commit(true)
    markServerReady('round-loop')
    interval(SERVER_TICK_S, () => this.tick(), 'round-loop-phases')
    console.log('[roundLoop] server phases ready at', phaseLabel(this.tuple.phase))
  }

  /**
   * Cold start: the process died, the tuple did not. Resume the phase that is
   * current now — unless the restored schedule is so old that replaying it is
   * meaningless, in which case start a fresh round.
   */
  private rehydrate(restored: RoundTuple, nowMs: number): RoundTuple {
    if (restored.phase <= 0) return holdAt(restored, nowMs)
    const caught = catchUp(restored, this.durations, nowMs, MAX_CATCHUP_STEPS, restored.configVersion)
    if (caught.exhausted) return startRound(freshSeed(), nowMs, restored.configVersion)
    return caught.tuple
  }

  private presence(from: string): { ok: boolean; phase: number } {
    this.seen.set(from.toLowerCase(), Date.now())
    return { ok: true, phase: this.tuple.phase }
  }

  private presentCount(nowMs: number): number {
    let count = 0
    for (const [address, at] of this.seen) {
      if (nowMs - at > PRESENCE_TTL_MS) this.seen.delete(address)
      else count++
    }
    return count
  }

  private tick(): void {
    const now = Date.now()
    const durations = this.durations
    const version = configVersionNow()
    this.present = this.presentCount(now)
    this.parked = this.present === 0

    if (this.parked) {
      // Park when empty: a wave must never burn down in an empty scene, and the
      // player who walks in next deserves a full lobby, not somebody's leftovers.
      this.tuple =
        this.tuple.phase <= 0 ? holdAt(this.tuple, now) : startRound(freshSeed(), now, version)
    } else if (this.tuple.phase <= 0) {
      if (!isReady(this.present, this.minPlayers, this.soloMode)) this.tuple = holdAt(this.tuple, now)
      else if (now >= phaseEndsAtMs(this.tuple, durations)) this.tuple = advance(this.tuple, durations, version)
    } else {
      const caught = catchUp(this.tuple, durations, now, MAX_CATCHUP_STEPS, version)
      this.tuple = caught.exhausted ? startRound(freshSeed(), now, version) : caught.tuple
    }
    this.commit(false)
  }

  private commit(force: boolean): void {
    const previous = this.lastWritten
    const boundary =
      previous === null || previous.phase !== this.tuple.phase || previous.seed !== this.tuple.seed
    // A held lobby rewrites phaseStartMs every tick; replicating 4 Hz of that is
    // noise, so only a boundary or a visible second of drift reaches the wire.
    const drifted = previous !== null && Math.abs(previous.phaseStartMs - this.tuple.phaseStartMs) >= REBASE_TOLERANCE_MS
    if (!force && !boundary && !drifted) {
      this.publishLocal()
      return
    }
    this.lastWritten = this.tuple
    const entity = this.syncEntity
    if (entity !== null) {
      RoundPhase.createOrReplace(entity, {
        seed: this.tuple.seed,
        phase: this.tuple.phase,
        phaseStartMs: this.tuple.phaseStartMs,
        configVersion: this.tuple.configVersion,
        parked: this.parked,
        present: this.present
      })
    }
    this.publishLocal()
    if (!boundary && !force) return
    const store = this.store
    if (store === null) return
    store.patch(this.tuple)
    void store.flush()
  }

  private publishLocal(): void {
    registry().publish(this.tuple, this.durations, this.parked, this.present)
  }

  // --- client ------------------------------------------------------------

  private startPresencePings(): void {
    const announce = (): void => {
      // A rejection is an answer — no server, or not awake yet. The next ping retries.
      void rpc.call('round.hello', {}).catch(() => undefined)
    }
    announce()
    interval(PRESENCE_PING_S, () => void rpc.call('round.ping', {}).catch(() => undefined), 'round-loop-presence')
  }

  private render(): void {
    // protectedSync creates RoundPhase with schema defaults and syncs it before
    // the server has restored anything, so the first thing a client can read is
    // an all-zero tuple. Publishing that would have every consumer plan against
    // phaseStartMs 0 — the Wave Director spawns a whole wave at once and drops it
    // again when the real tuple lands. A start of 0 is the placeholder, not a round.
    const synced = this.readSynced()
    const ready = synced !== null && synced.tuple.phaseStartMs > 0
    if (ready) {
      registry().publish(synced.tuple, this.durations, synced.parked, synced.present)
    }
    TextShape.createOrReplace(this.entity, {
      text: this.statusText(ready ? synced : null),
      fontSize: 3,
      textColor: { r: 1, g: 1, b: 1, a: 1 },
      outlineColor: { r: 0, g: 0, b: 0 },
      outlineWidth: 0.1
    })
  }

  private statusText(synced: { tuple: RoundTuple; parked: boolean; present: number } | null): string {
    const life = serverLifeState()
    if (life === 'waking') return 'ROUND LOOP\n--:--\nwaking the server'
    if (life === 'asleep' || life === 'unreachable') return 'ROUND LOOP\n--:--\nserver offline'
    if (synced === null || !isTimeSyncReady()) return 'ROUND LOOP\n--:--\nsyncing'
    const label = phaseLabel(synced.tuple.phase)
    const clock = formatCountdown(countdownSeconds(synced.tuple, this.durations, getServerTime()))
    if (synced.parked) return `${label}\n${clock}\nwaiting for players`
    const needed = requiredPlayers(this.minPlayers, this.soloMode)
    if (synced.tuple.phase <= 0 && synced.present < needed) {
      return `${label}\n${clock}\n${synced.present}/${needed} players`
    }
    return `${label}\n${clock}`
  }

  private readSynced(): { tuple: RoundTuple; parked: boolean; present: number } | null {
    const entity = syncedEntity()
    if (entity === null) return null
    const value = RoundPhase.get(entity)
    return {
      tuple: {
        seed: Number(value.seed),
        phase: value.phase,
        phaseStartMs: Number(value.phaseStartMs),
        configVersion: value.configVersion
      },
      parked: value.parked,
      present: value.present
    }
  }
}
