import { engine, Schemas, type Entity } from '@dcl/sdk/ecs'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import { LivenessTracker, type ServerLifeState } from './pure/liveness'

// Server heartbeat + client liveness. The server pulses a counter into a
// synced, server-protected component every ~2s; clients judge life by when
// they OBSERVED it change (see pure/liveness.ts). Every prefab that talks to
// the server should gate its UX on serverLifeState() instead of trusting
// isStateSyncronized() (room transport ≠ server awake — the cold-start wedge
// every shipped game had).

const PULSE_S = 2
const STALE_AFTER_MS = 6_000

// Idempotent def: every prefab bundles its own copy of this file.
function defineHeartbeat() {
  return engine.defineComponent('runtime::Heartbeat', { beat: Schemas.Int64 })
}
const Heartbeat =
  (engine.getComponentOrNull('runtime::Heartbeat') as ReturnType<typeof defineHeartbeat> | null) ?? defineHeartbeat()

let started = false
const tracker = new LivenessTracker(STALE_AFTER_MS)
const firstBeatCallbacks: (() => void)[] = []

export function startServerLife(): void {
  if (started) return
  started = true
  if (isServer()) startServer()
  else startClient()
}

/** connecting → alive → lost (and back to alive when the server wakes). */
export function serverLifeState(): ServerLifeState {
  return tracker.state(Date.now())
}

/** Fires once, on the first heartbeat ever observed this session. */
export function onFirstHeartbeat(cb: () => void): void {
  if (tracker.everAlive()) cb()
  else firstBeatCallbacks.push(cb)
}

function heartbeatEntity(): Entity | null {
  for (const [entity] of engine.getEntitiesWith(Heartbeat)) return entity
  return null
}

function startServer(): void {
  Heartbeat.validateBeforeChange(
    ({ senderAddress }) => senderAddress.toLowerCase() === AUTH_SERVER_PEER_ID
  )
  let entity = heartbeatEntity()
  if (entity === null) {
    entity = engine.addEntity()
    Heartbeat.create(entity, { beat: Date.now() })
    syncEntity(entity, [Heartbeat.componentId])
  }
  let accum = 0
  engine.addSystem((dt: number) => {
    accum += dt
    if (accum < PULSE_S) return
    accum = 0
    const target = heartbeatEntity()
    if (target !== null) Heartbeat.getMutable(target).beat = Date.now()
  }, undefined, 'runtime-server-life')
}

function startClient(): void {
  engine.addSystem(() => {
    const entity = heartbeatEntity()
    const wasAlive = tracker.everAlive()
    tracker.observe(entity !== null ? Number(Heartbeat.get(entity).beat) : null, Date.now())
    if (!wasAlive && tracker.everAlive()) {
      for (const cb of firstBeatCallbacks.splice(0)) cb()
    }
  }, undefined, 'runtime-server-life')
}
