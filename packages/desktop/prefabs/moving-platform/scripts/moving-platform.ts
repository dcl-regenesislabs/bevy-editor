// A platform that travels its path and carries whoever stands on it, in the
// same place at the same moment for every player.
//
// The path starts where the platform is placed, goes to its End position, and
// on through any extra points. It can run back and forth, loop around, or make
// the trip once — from the start of the game, or the moment something calls it.
//
// Nothing about the motion is sent over the network: every player's copy works
// out where the platform should be from the Multiplayer Server's clock, so they
// all agree without talking to each other. Calling a platform costs exactly one
// shared fact — the server timestamp the run started — and everything after is
// derived. Read the header of `runtime/syncedTween.ts` for why that beats
// replicating the position.
import { engine, Transform, type Entity, type LastWriteWinElementSetComponentDefinition } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import { initTimeSync } from '~runtime/timeSync'
import { drivePath, type PathPlan, type Position } from '~runtime/syncedTween'
import { game } from '~runtime/game'

// Well under the 5 m/frame at which the engine stops carrying a rider and
// leaves them in mid-air, so a creator gets told before a player gets dropped.
const FAST_MS = 20
const CALL_VERB = 'platform.call'

interface WorldPose {
  position: Vector3
  rotation: Quaternion
  scale: Vector3
}

function worldPoseOf(entity: Entity): WorldPose | null {
  let position = Vector3.Zero()
  let rotation = Quaternion.Identity()
  let scale = Vector3.One()
  let current: Entity | null = entity
  for (let depth = 0; depth < 32 && current !== null; depth++) {
    const transform = Transform.getOrNull(current)
    if (!transform) return depth === 0 ? null : { position, rotation, scale }
    const scaled = Vector3.create(
      position.x * transform.scale.x,
      position.y * transform.scale.y,
      position.z * transform.scale.z
    )
    position = Vector3.add(transform.position, Vector3.rotate(scaled, transform.rotation))
    rotation = Quaternion.multiply(transform.rotation, rotation)
    scale = Vector3.create(scale.x * transform.scale.x, scale.y * transform.scale.y, scale.z * transform.scale.z)
    current = transform.parent !== undefined && transform.parent !== 0 ? (transform.parent as Entity) : null
  }
  return { position, rotation, scale }
}

type NameValue = { value: string }
function nameOf(entity: Entity): string {
  const component = engine.getComponentOrNull('core-schema::Name') as
    | LastWriteWinElementSetComponentDefinition<NameValue>
    | null
  return component?.getOrNull(entity)?.value?.trim() ?? ''
}

// One shared handler answers every call by platform name — the same
// name-is-the-id contract Trigger Areas use. game.onRequest is server-only by
// contract (it throws on a client), so registration forks on isServer() — the
// DRIVE loop below stays fork-free, which is a different rule: driving must run
// on both sides or the server's tween freezes.
const callable = new Map<string, () => void>()
let handlerArmed = false

function armCallHandler(): void {
  if (handlerArmed || !isServer()) return
  handlerArmed = true
  game.onRequest(CALL_VERB, (data: { name?: string }) => {
    const name = typeof data?.name === 'string' ? data.name.trim().toLowerCase() : ''
    const summon = callable.get(name)
    if (summon === undefined) return { ok: false, reason: `no platform answers to "${name}"` }
    summon()
    return { ok: true }
  })
}

export class MovingPlatform {
  private plan: PathPlan | null = null
  private stateKey = ''
  private warned = false

  constructor(
    public src: string,
    public entity: Entity,
    /** The stops after the placed spot, in metres from it, in travel order. */
    public path: Position[] = [{ x: 0, y: 0, z: 8 }],
    /** How the path repeats. */
    public loop: 'back and forth' | 'around' | 'once' = 'back and forth',
    /** When it runs: on its own from the start, or once something calls it by name. */
    public runs: 'from the start' | 'when called' = 'from the start',
    /** Seconds between one stop and the next. */
    public tripSeconds: number = 4,
    /** Seconds it waits at each stop. */
    public waitSeconds: number = 1,
    /** Eases in and out of each stop instead of moving at a constant speed. */
    public smooth: boolean = true,
    /** Starts this far into the trip. Give a row of platforms different values to stagger them. */
    public startOffsetSeconds: number = 0
  ) {}

  start(): void {
    initTimeSync()

    // Captured before any tween exists — once one does, this Transform is the
    // tween's output rather than where the creator put the platform.
    const pose = worldPoseOf(this.entity)
    if (!pose) return

    if (this.path.length === 0) {
      console.log('[movingPlatform] add at least one point to the path — until then it stays where it is.')
      return
    }
    const stops: Vector3[] = [Vector3.clone(pose.position)]
    for (const offset of this.path) {
      // metres in the platform's oriented frame — scale sizes the model, not the trip
      const step = Vector3.rotate(Vector3.create(offset.x, offset.y, offset.z), pose.rotation)
      stops.push(Vector3.add(pose.position, step))
    }

    let pathUnits = 0
    for (let i = 1; i < stops.length; i++) pathUnits += Vector3.distance(stops[i - 1], stops[i])
    if (!(pathUnits > 0.01) || !(this.tripSeconds > 0)) {
      console.log('[movingPlatform] the end position sits on the platform, so it stays where it is.')
      return
    }
    const legUnits = pathUnits / Math.max(1, stops.length - 1)
    if (legUnits / this.tripSeconds > FAST_MS) {
      console.log(
        `[movingPlatform] ${(legUnits / this.tripSeconds).toFixed(0)} m/s is fast enough to leave riders behind — raise the trip time or bring the stops closer.`
      )
    }

    this.plan = {
      stops,
      mode: this.loop,
      travelMs: this.tripSeconds * 1000,
      waitMs: Math.max(0, this.waitSeconds) * 1000,
      easing: this.smooth ? 'smooth' : 'linear',
      offsetMs: this.startOffsetSeconds * 1000
    }

    if (this.runs === 'when called') {
      const name = nameOf(this.entity).toLowerCase()
      if (name === '') {
        console.log('[movingPlatform] name this platform so scripts can call it — until then it stays put.')
        this.plan = null
        return
      }
      this.stateKey = `platform.${name}`
      callable.set(name, () => {
        if (game.state[this.stateKey] === undefined) {
          game.setState({ [this.stateKey]: { since: game.now() } })
        }
      })
      armCallHandler()
    }
  }

  // No isServer() branch, deliberately. The server drives its own copy of the
  // platform so its collider sits where the players see it; skipping the work
  // there would freeze the server's tween at the end of its first leg, silently
  // and permanently.
  update(): void {
    if (!this.plan) return
    if (this.runs === 'when called') {
      const fact = game.state[this.stateKey] as { since?: number } | undefined
      if (fact === undefined) return
      if (typeof fact.since !== 'number') {
        if (!this.warned) {
          this.warned = true
          console.log(`[movingPlatform] ${this.stateKey} holds no start time — ignoring it.`)
        }
        return
      }
      drivePath(this.entity, { ...this.plan, sinceMs: fact.since })
      return
    }
    drivePath(this.entity, this.plan)
  }
}
