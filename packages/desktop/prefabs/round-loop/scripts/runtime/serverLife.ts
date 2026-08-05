import { engine, Schemas, type Entity } from '@dcl/sdk/ecs'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { LivenessTracker } from './pure/liveness'
import { sealProtectedRegistration } from './protectedSync'

// Server heartbeat + client liveness. The server pulses a counter into a
// synced, server-protected component every ~2s; clients judge life by when they
// OBSERVED it change (see pure/liveness.ts), never by the value itself — a
// stale CRDT snapshot from a previous server run carries one. Every prefab that
// talks to the server gates its UX on serverLifeState() instead of trusting
// isStateSyncronized() (room transport ≠ server awake — the cold-start wedge
// every shipped game had).
//
// THE STATE LADDER (one enum, rendered verbatim by every surface — no HUD,
// panel or script invents its own vocabulary):
//
//   waking      no heartbeat yet, still inside the cold-start window. The
//               player-facing default: "Waking the game server… Xs".
//   running     a beat landed within 3 pulses.
//   degraded    beats stopped for 3× the pulse interval but not long enough to
//               call it sleep — a hitch, a reconnect, or a server going down.
//               Gameplay keeps rendering; anything server-authoritative should
//               stop claiming to be authoritative.
//   asleep      silent past the sleep window after having been alive. The
//               Multiplayer Server sleeps when the scene empties; the next
//               visitor's traffic wakes it and the state returns to running.
//   unreachable never reached at all within the cold-start window. Something is
//               wrong with the deployment, not with this session.
//
// READINESS GATING. The heartbeat is the signal clients use to start trusting
// the server, so it must not fire before the server can be trusted: no beat is
// emitted until markServerReady() is called, which every server branch calls
// once its validators are armed and its synced singletons are claimed. That
// closes the window where a racing client's writes would pass unvalidated.
// A server that never calls it never beats — the module says so in the logs.

const PULSE_S = 2
// Three missed pulses is the degraded threshold, and the same number the
// liveness tracker uses to stop calling the server alive.
const DEGRADED_AFTER_MS = PULSE_S * 3 * 1000
const ASLEEP_AFTER_MS = 30_000
const WAKE_TIMEOUT_MS = 20_000
const READY_WARN_AFTER_MS = 5_000

export type ServerLifeState = 'running' | 'waking' | 'degraded' | 'asleep' | 'unreachable'

export interface ServerLifeThresholds {
  degradedAfterMs: number
  asleepAfterMs: number
  wakeTimeoutMs: number
}

export const SERVER_LIFE_THRESHOLDS: ServerLifeThresholds = {
  degradedAfterMs: DEGRADED_AFTER_MS,
  asleepAfterMs: ASLEEP_AFTER_MS,
  wakeTimeoutMs: WAKE_TIMEOUT_MS
}

/**
 * The client half of the ladder, as pure state: observe the visible heartbeat
 * value, read a state. Exported so a HUD can render the same ladder off its own
 * samples and so it is unit-testable without the engine.
 */
export class ServerLifeLadder {
  private tracker: LivenessTracker
  private lastValue: number | null = null
  private lastBeatAtMs: number | null = null
  private startedAtMs: number | null = null

  constructor(private thresholds: ServerLifeThresholds = SERVER_LIFE_THRESHOLDS) {
    this.tracker = new LivenessTracker(thresholds.degradedAfterMs)
  }

  /** Starts the cold-start window. Called once, when the module starts watching. */
  start(nowMs: number): void {
    if (this.startedAtMs === null) this.startedAtMs = nowMs
  }

  /** Feed the currently visible heartbeat value (null when absent). True when a beat landed. */
  observe(value: number | null, nowMs: number): boolean {
    const changed = value !== null && value !== this.lastValue
    this.tracker.observe(value, nowMs)
    if (!changed) return false
    this.lastValue = value
    this.lastBeatAtMs = nowMs
    return true
  }

  state(nowMs: number): ServerLifeState {
    if (this.lastBeatAtMs === null) {
      return this.ageMs(nowMs) > this.thresholds.wakeTimeoutMs ? 'unreachable' : 'waking'
    }
    switch (this.tracker.state(nowMs)) {
      case 'alive':
        return 'running'
      default:
        return this.ageMs(nowMs) > this.thresholds.asleepAfterMs ? 'asleep' : 'degraded'
    }
  }

  /** Since the last beat, or since the watch started when none ever landed. */
  ageMs(nowMs: number): number {
    const since = this.lastBeatAtMs ?? this.startedAtMs
    return since === null ? 0 : Math.max(0, nowMs - since)
  }

  everAlive(): boolean {
    return this.tracker.everAlive()
  }
}

// Idempotent def: every prefab bundles its own copy of this file.
function defineHeartbeat() {
  return engine.defineComponent('runtime::Heartbeat', { beat: Schemas.Int64 })
}
const Heartbeat =
  (engine.getComponentOrNull('runtime::Heartbeat') as ReturnType<typeof defineHeartbeat> | null) ?? defineHeartbeat()

let role: 'server' | 'client' | null = null
let ready = false
let readyWarned = false
let beatsSent = 0
let serverStartedAtMs = 0
const ladder = new ServerLifeLadder()
const firstBeatCallbacks: (() => void)[] = []

export function startServerLife(): void {
  if (role !== null) return
  role = isServer() ? 'server' : 'client'
  ladder.start(Date.now())
  if (role === 'server') startServer()
  else startClient()
}

/**
 * Arms the heartbeat. Call once, from the server branch, AFTER every
 * validateBeforeChange is registered and every synced singleton is claimed.
 * No-op on clients, idempotent.
 */
export function markServerReady(): void {
  ready = true
  // The heartbeat is the announcement clients act on, so this is the last
  // instant a first-time protectedSync registration is still safe.
  sealProtectedRegistration()
}

/** waking → running, and the degraded/asleep/unreachable failure ladder. */
export function serverLifeState(): ServerLifeState {
  if (role === 'server') return ready ? 'running' : 'waking'
  return ladder.state(Date.now())
}

/** Milliseconds since the last observed heartbeat — the staleness readout a badge shows. */
export function serverLifeAgeMs(): number {
  return ladder.ageMs(Date.now())
}

/** Fires once, on the first heartbeat ever observed (or emitted) this session. */
export function onFirstHeartbeat(cb: () => void): void {
  if (ladder.everAlive() || beatsSent > 0) cb()
  else firstBeatCallbacks.push(cb)
}

function fireFirstBeat(): void {
  for (const cb of firstBeatCallbacks.splice(0)) cb()
}

function heartbeatEntity(): Entity | null {
  for (const [entity] of engine.getEntitiesWith(Heartbeat)) return entity
  return null
}

function startServer(): void {
  Heartbeat.validateBeforeChange(({ senderAddress }) => senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID)
  serverStartedAtMs = Date.now()
  let accum = 0
  engine.addSystem(
    (dt: number) => {
      if (!ready) {
        warnWhenReadyIsLate()
        return
      }
      accum += dt
      // The first beat goes out on the tick readiness lands, not a pulse later.
      if (beatsSent > 0 && accum < PULSE_S) return
      accum = 0
      pulse()
    },
    undefined,
    'runtime-server-life'
  )
}

function pulse(): void {
  const existing = heartbeatEntity()
  if (existing === null) {
    const entity = engine.addEntity()
    Heartbeat.create(entity, { beat: Date.now() })
    syncEntity(entity, [Heartbeat.componentId])
  } else {
    Heartbeat.getMutable(existing).beat = Date.now()
  }
  beatsSent++
  if (beatsSent === 1) fireFirstBeat()
}

function warnWhenReadyIsLate(): void {
  if (readyWarned || Date.now() - serverStartedAtMs < READY_WARN_AFTER_MS) return
  readyWarned = true
  console.log(
    '[SERVER] serverLife: heartbeat withheld — markServerReady() was never called, so every client stays in "waking". Call it once your validators are armed.'
  )
}

function startClient(): void {
  engine.addSystem(
    () => {
      const entity = heartbeatEntity()
      const value = entity !== null ? Number(Heartbeat.get(entity).beat) : null
      const wasAlive = ladder.everAlive()
      ladder.observe(value, Date.now())
      if (!wasAlive && ladder.everAlive()) fireFirstBeat()
    },
    undefined,
    'runtime-server-life'
  )
}
