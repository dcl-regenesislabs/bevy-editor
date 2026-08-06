// A hitscan weapon for the rig's hand anchor: one camera-forward ray per shot,
// and the entity it lands on is reported to the Multiplayer Server as a hit.
//
// It reports WHAT was hit and nothing else. How much that hit takes off is the
// server's alone: the validator DERIVES the damage from Game Config
// `weapons.gunDamage` and never reads a number from the payload, so a client that
// asks for more is not clamped — it is ignored. The rate is checked against
// `weapons.fireRate`, which is also what this script limits itself to, so the two
// ends of the same tunable stay one number in one place. And in a 'planned' spawn
// (zombies that only ever exist on clients) the server cannot check WHERE the
// shooter was, so proximity is not validated at all: say "server-validated
// damage", never "cheat-proof".
//
// The gun arms on exactly one rig — the local player's. Every other client's
// rig carries the same script and stands down, so a scene with 20 players fires
// one ray per trigger pull, not 20.
import {
  ColliderLayer,
  RaycastQueryType,
  engine,
  inputSystem,
  raycastSystem,
  InputAction,
  PointerEventType,
  Transform,
  type Entity
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import * as spawner from './runtime/spawner'
import { outcomes, type OutcomeLedger } from './runtime/outcomes'
import { playerPositions } from './runtime/playerPositions'
import { addressInstanceId } from './pure/rigState'

const HIT_KIND = 'hit'
const MAX_PARENT_DEPTH = 8
const RESOLVE_INTERVAL_S = 0.5
const DEFAULT_RANGE = 24
const DEFAULT_FIRE_RATE = 4

// Weapon tuning is Game Config, never a script param: `weapons.range` and
// `weapons.fireRate` are the natural names for these in the table, and a param
// holding the same number would be one value set in two places — which the
// config-shadowing check blocks, on the kit's own prefab. Damage is the same rule
// taken further: the server derives it and this script never sends one at all.
// The generated src/scripts/game-config.ts publishes the table on globalThis; a
// scene without one runs on the defaults above.
function weaponNumber(name: string, fallback: number): number {
  const bag = (globalThis as unknown as Record<string, unknown>).__dclGameConfig_v1
  const config = typeof bag === 'object' && bag !== null ? (bag as Record<string, unknown>) : null
  const weapons = config === null ? null : config.weapons
  const value = typeof weapons === 'object' && weapons !== null ? (weapons as Record<string, unknown>)[name] : undefined
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

// A clone of this prefab exists for every player, so the placed rig must not
// also fire once the pool is running. Counting clone-side instances is cheaper
// and steadier than scanning the scene for them.
let cloneGuns = 0

export class GunHitscan {
  private cooldown = 0
  private mine = false
  private clone = false
  private resolved = false
  private instanceId = 0
  private sinceResolve = 0
  private hits: OutcomeLedger | null = null

  constructor(
    public src: string,
    public entity: Entity,
    /** Outcome ledger the hit validator is armed on — the Wave Director's, by default. */
    public ledger: string = 'wave'
  ) {}

  start(): void {
    if (isServer()) return
    const from = spawner.spawnedFrom(this.entity)
    this.clone = from !== null
    this.instanceId = from === null ? 0 : from.instanceId
    if (this.clone) cloneGuns += 1
    else this.arm(true)
  }

  update(dt: number): void {
    if (isServer()) return
    // The roster is usually empty on the frame a clone starts, so ownership is
    // decided here and retried until an avatar with an address shows up.
    if (!this.resolved) {
      this.sinceResolve += dt
      if (this.sinceResolve < RESOLVE_INTERVAL_S) return
      this.sinceResolve = 0
      const local = localInstanceId()
      if (local !== null) this.arm(local === this.instanceId)
      return
    }
    if (!this.mine) return
    if (!this.clone && cloneGuns > 0) return
    if (this.cooldown > 0) this.cooldown -= dt
    if (!inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) return
    if (this.cooldown > 0) return
    this.cooldown = 1 / Math.max(0.1, weaponNumber('fireRate', DEFAULT_FIRE_RATE))
    this.fire()
  }

  detach(): void {
    if (this.clone) cloneGuns = Math.max(0, cloneGuns - 1)
  }

  private arm(mine: boolean): void {
    this.resolved = true
    this.mine = mine
    if (mine) this.hits = outcomes(this.ledger)
  }

  private fire(): void {
    const hits = this.hits
    if (hits === null) return
    raycastSystem.registerLocalDirectionRaycast(
      {
        entity: engine.CameraEntity,
        opts: {
          direction: Vector3.Forward(),
          maxDistance: Math.max(1, weaponNumber('range', DEFAULT_RANGE)),
          queryType: RaycastQueryType.RQT_HIT_FIRST,
          collisionMask: ColliderLayer.CL_PHYSICS,
          continuous: false
        }
      },
      (result) => {
        for (const hit of result.hits) {
          if (hit.entityId === undefined) continue
          const instanceId = spawnedInstanceOf(hit.entityId as Entity)
          if (instanceId === null) continue
          // No amount: the validator reads the damage out of Game Config and
          // discards anything the payload carries.
          hits.report(HIT_KIND, { instanceId })
          return
        }
      }
    )
  }
}

/** The rig instance id of this viewer, or null while the roster has not arrived. */
function localInstanceId(): number | null {
  for (const player of playerPositions()) {
    if (player.local) return addressInstanceId(player.address)
  }
  return null
}

// The collider that stops the ray is often a mesh deep inside a GltfContainer,
// so the hit walks up to the clone root that carries the spawn marker.
function spawnedInstanceOf(entity: Entity): number | null {
  let current = entity
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth++) {
    const from = spawner.spawnedFrom(current)
    if (from !== null) return from.instanceId
    const parent = Transform.getOrNull(current)?.parent
    if (parent === undefined || parent === current) return null
    current = parent
  }
  return null
}
