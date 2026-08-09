// A spawn point. Pick the prefab it copies and what sets it off — a click, a
// player walking in, a timer, or another script asking — and a copy appears at
// the Spawner's own spot. Copies are made right here on this player's game:
// no server round-trip, nothing stored, nothing to wait for.
//
// The spot's id is the entity's NAME, the handle the creator, the inspector and
// another script already share, so a lever somewhere else sets this one off with
// requestSpawn('Crate Spawner') and nothing has to be wired. Placement makes
// names unique, so a second "Crate Spawner" is "Crate Spawner 2" and is its own
// spot.
//
// The pool is opened HERE rather than inside a runtime module: a pool opened in
// a carried module is invisible to the editor's guarantee scan, and the prefab
// this spot copies every ten seconds would read "Not used yet" forever.
import {
  InputAction,
  MeshCollider,
  PointerEventType,
  PointerEvents,
  Transform,
  TriggerArea,
  VisibilityComponent,
  engine,
  inputSystem,
  triggerAreaEventsSystem,
  type Entity
} from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { localPlayerPosition } from './runtime/playerPositions'
import { pool as openPool, snapshotRootComponent, type Pool } from './runtime/spawner'
import { registerSpawnPoint } from './runtime/spawnPoints'
import { onZone, zoneOf } from './runtime/zoneBus'
import { effectiveScatter, scatterOffset } from './runtime/pure/spawnScatter'
import { composeWorld, type LocalTransform, type WorldTransform } from './runtime/pure/worldTransform'

/** A prefab id picked in the inspector's prefab dropdown. */
type PrefabRef = string

// Collision layers by value, not by name: the SDK renamed CL_RESERVED2 to
// CL_MAIN_PLAYER, and this script compiles against whatever pin the creator's
// project happens to carry.
const CL_POINTER = 1
// The local avatar's collider carries this layer and remote avatars' do not, so
// the walk-in area fires for the player standing at THIS game, exactly once.
const CL_MAIN_PLAYER = 8
const CLICK_RANGE_M = 8
const TRANSFORM = 'core::Transform'
const PARENT_DEPTH_MAX = 32
// The editor materializes this child when `where` is 'custom spot' — a marker
// showing the prefab's model, positioned with the gizmos, hidden while playing.
// The prefix stops at a word boundary, so "Spawn Spot 2" and "spawn spot-a" are
// markers and the creator's own "Spawn Spotlight" is not — the same rule the
// editor's actions/spawn-spot.ts matches on, and the two must agree.
const SPAWN_SPOT_MATCH = /^spawn spot(?![a-z])/

export class Spawner {
  private pool: Pool | null = null
  private name = ''
  /** copy → seconds left; Infinity when disappearsAfter is 0 */
  private live = new Map<Entity, number>()
  private spawnedCount = 0
  private countdownS = 0
  private armed = false
  private subscribing = false
  private customSpot: Entity | null = null

  constructor(
    public src: string,
    public entity: Entity,
    /** What appears here. Pick any prefab in this project. */
    public spawn: PrefabRef = '',
    /** What makes a copy appear */
    public when:
      | 'when clicked'
      | 'when a player enters'
      | 'every few seconds'
      | 'when a script asks' = 'when clicked',
    /** For "every few seconds": how many seconds between copies. */
    public everySeconds: number = 10,
    /** For "when clicked": the words a player sees before they click. */
    public hoverLabel: string = 'Use',
    /** How many copies can be out at once. At the limit, nothing more appears until one goes. */
    public atMostAtOnce: number = 1,
    /** Seconds a copy sticks around. 0 keeps it until something removes it. */
    public disappearsAfter: number = 0,
    /** Where a copy appears. 'custom spot' uses the "Spawn Spot" marker you position with the gizmos. */
    public where: 'at this spawner' | 'at the player' | 'custom spot' = 'at this spawner'
  ) {}

  // What sets this spot off is derived from WHERE IT SITS, never picked from a
  // list: parented to something, that something is the button or the zone; on
  // its own, the spawner itself is — its disc becomes the button, its spot
  // becomes the walk-in area (scale is metres, the gizmo is the resize tool).
  // Spread and marker visibility are automatic for the same reason: several
  // copies spread just enough not to stack, and the disc shows itself in Play
  // exactly when this spawner IS the button.
  private parentEntity(): Entity | null {
    return parentOf(Transform.getOrNull(this.entity))
  }

  private get isOwnButton(): boolean {
    return this.when === 'when clicked' && this.parentEntity() === null
  }

  start(): void {
    // Every trigger is a player's gesture, so the copies are the player's too. In
    // a scene that runs a Multiplayer Server this same script boots there — where
    // the timer would drip copies nobody can see. That half stands down whole.
    if (isServer()) return
    VisibilityComponent.createOrReplace(this.entity, { visible: this.isOwnButton })
    this.name = zoneOf(this.entity)
    this.pool = this.spawnPool()
    if (this.pool === null) return
    // A cap above the prefab's Max alive can never fill; say the cure once, here.
    if (this.atMostAtOnce > this.pool.max) {
      console.log(
        `[Spawner] '${this.name}' asks for ${this.atMostAtOnce} copies but the prefab's Max alive is ${this.pool.max} — raise the prefab's copy limit in the Prefabs tab`
      )
      this.atMostAtOnce = this.pool.max
    }
    this.countdownS = Math.max(1, this.everySeconds)
    // Every mode registers, not just 'when a script asks': requestSpawn by NAME is
    // the whole cross-script wiring, and a round script poking a click spawner for
    // an extra crate must keep working the way it always has.
    registerSpawnPoint(this.name, () => this.spawnOne())
    this.hideSpawnSpots()
    if (this.when === 'when a player enters') this.armWalkIn()
  }

  // The marker is an authoring surface: it shows the model in the editor so the
  // creator can aim it, and disappears the moment the scene runs. Hiding runs in
  // EVERY mode, not just 'custom spot' — a marker left behind by a changed
  // dropdown must never ship as a ghost model players can see. Its GltfContainer
  // ships with zeroed collision masks, so hiding the mesh is all that is left.
  private hideSpawnSpots(): void {
    for (const [child] of engine.getEntitiesWith(Transform)) {
      if (parentOf(Transform.getOrNull(child)) !== this.entity) continue
      if (!SPAWN_SPOT_MATCH.test(zoneOf(child).trim().toLowerCase())) continue
      VisibilityComponent.createOrReplace(child, { visible: false })
      if (this.customSpot === null) this.customSpot = child
    }
    if (this.where === 'custom spot' && this.customSpot === null) {
      console.log(
        `[Spawner] '${this.name}' is set to a custom spot but its "Spawn Spot" marker is gone — copies appear at the spawner instead`
      )
    }
  }

  update(dt: number): void {
    if (this.pool === null) return
    if (!this.armed) {
      this.armed = true
      this.subscribing = false
      // The pointer hint is merged on the first TICK, not in start(): script start
      // order is not authored, so another script's createOrReplace of PointerEvents
      // during start() would silently erase it.
      if (this.when === 'when clicked') this.armClick()
    }
    this.expire(dt)
    if (this.when === 'every few seconds') {
      this.countdownS -= dt
      if (this.countdownS <= 0) {
        this.countdownS = Math.max(1, this.everySeconds)
        this.spawnOne()
      }
    }
    if (this.when !== 'when clicked') return
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, this.clickTarget())) {
      this.spawnOne()
    }
  }

  private spawnPool(): Pool | null {
    if (this.spawn === '') {
      console.log('[Spawner] no prefab picked — set "spawn" to the prefab this spot should copy')
      return null
    }
    // A stale prefab ref (Spawnable turned off, prefab deleted) makes the pool
    // throw, and a throw out of start() aborts every script the runner has not
    // started yet plus the scene's own main(). One dropdown must not kill a scene.
    try {
      return openPool(this.spawn, 'seeded')
    } catch (error) {
      console.log('[Spawner] the "spawn" param is not a Spawnable prefab —', error)
      return null
    }
  }

  // --- the triggers ----------------------------------------------------------

  private armWalkIn(): void {
    const parent = this.parentEntity()
    const parentZone = parent !== null && TriggerArea.getOrNull(parent) !== null ? zoneOf(parent) : ''
    if (parentZone !== '') {
      this.subscribing = true
      onZone(parentZone, 'enter', (event) => {
        // Late subscribers get current occupancy replayed as enters, and those arrive
        // synchronously inside this call: someone already standing here did not just
        // walk in, and a copy must not appear because a script started.
        if (this.subscribing || !event.local) return
        this.spawnOne()
      })
      return
    }
    // Not sitting in a zone: this spot IS the walk-in area. The engine's enter
    // event only fires on the transition, so someone already standing here when
    // the scene starts does not set it off — same rule as the zone path.
    TriggerArea.setBox(this.entity, CL_MAIN_PLAYER)
    triggerAreaEventsSystem.onTriggerEnter(this.entity, () => this.spawnOne())
  }

  private clickTarget(): Entity {
    return this.parentEntity() ?? this.entity
  }

  private armClick(): void {
    const target = this.clickTarget()
    // Only the marker gets a collider of its own. Another entity the creator
    // pointed at is theirs — a cylinder stamped over it would be the wrong shape.
    if (target === this.entity) {
      MeshCollider.createOrReplace(target, {
        mesh: { $case: 'cylinder', cylinder: { radiusTop: 0.5, radiusBottom: 0.5 } },
        collisionMask: CL_POINTER
      })
    }
    const existing = PointerEvents.getOrNull(target)?.pointerEvents ?? []
    PointerEvents.createOrReplace(target, {
      pointerEvents: [
        ...existing,
        {
          eventType: PointerEventType.PET_DOWN,
          eventInfo: {
            button: InputAction.IA_POINTER,
            hoverText: this.hoverLabel,
            maxDistance: CLICK_RANGE_M
          }
        }
      ]
    })
  }

  // --- the copies ------------------------------------------------------------

  private spawnOne(): void {
    if (this.pool === null) return
    // Drop before the cap check, not only in expire(): retireSpawned frees the
    // pool synchronously, and "retire then request" in one callback must spawn.
    this.dropReleased()
    if (this.live.size >= Math.max(1, this.atMostAtOnce)) return
    const world = this.spawnBase()
    const offset = scatterOffset(this.spawnedCount, effectiveScatter(0, this.atMostAtOnce))
    // The init write replaces the clone's whole Transform, and the spot's world
    // scale must not leak into it — a spawner shrunk to a marker would shrink its
    // zombies. Position and rotation are the spot's; scale stays the prefab's own.
    const authoredScale = localOf(snapshotRootComponent(this.pool.prefab, TRANSFORM)).scale
    let spawned: Entity | null = null
    try {
      // A clone's own start() is creator code. Letting it throw out of here would
      // abort the rest of the frame, so one bad script loses one copy, not the scene.
      spawned = this.pool.acquire(undefined, {
        [TRANSFORM]: {
          position: {
            x: world.position.x + offset.x,
            y: world.position.y,
            z: world.position.z + offset.z
          },
          rotation: world.rotation,
          scale: authoredScale
        }
      })
    } catch (error) {
      console.error(`[Spawner] '${this.name}' could not make a copy of ${this.pool.prefab}:`, error)
      return
    }
    if (spawned === null) {
      console.log(`[Spawner] '${this.name}': the prefab's Max alive is reached — no copy until one goes`)
      return
    }
    this.spawnedCount++
    this.live.set(spawned, this.disappearsAfter > 0 ? this.disappearsAfter : Infinity)
  }

  /** Let go of copies something else already released (retire, round reset). */
  private dropReleased(): void {
    const pool = this.pool
    if (pool === null) return
    for (const copy of [...this.live.keys()]) {
      if (pool.instanceIdOf(copy) === null) this.live.delete(copy)
    }
  }

  private expire(dt: number): void {
    if (this.pool === null || this.live.size === 0) return
    this.dropReleased()
    for (const [copy, left] of [...this.live]) {
      if (left === Infinity) continue
      const remaining = left - dt
      if (remaining > 0) {
        this.live.set(copy, remaining)
        continue
      }
      this.live.delete(copy)
      this.pool.release(copy)
    }
  }

  /**
   * Where a copy lands, by the `where` setting. Every branch that cannot answer
   * (avatar not loaded yet, marker deleted) falls back to the spawner's own spot
   * — a trigger that fired must always produce a copy somewhere sensible.
   */
  private spawnBase(): WorldTransform {
    if (this.where === 'at the player') {
      // Both come off the avatar's own Transform — localPlayerPosition converts
      // it to the scene's frame — so they are there together or not at all.
      const avatar = Transform.getOrNull(engine.PlayerEntity)
      const position = localPlayerPosition()
      if (avatar !== null && position !== null) {
        return { position, rotation: avatar.rotation, scale: { x: 1, y: 1, z: 1 } }
      }
    }
    // The marker may have been removed mid-play by a cleanup script — a spawn
    // must land at the spawner then, never at whatever id 0 composes to.
    if (this.where === 'custom spot' && this.customSpot !== null && Transform.getOrNull(this.customSpot) !== null) {
      return worldOf(this.customSpot)
    }
    return worldOf(this.entity)
  }
}

/** An entity's composed world transform, walking parents to the scene root. */
function worldOf(entity: Entity): WorldTransform {
  const chain: LocalTransform[] = []
  const seen = new Set<number>()
  let current: Entity | null = entity
  for (let depth = 0; current !== null && depth < PARENT_DEPTH_MAX; depth++) {
    const id = Number(current)
    if (id === 0 || seen.has(id)) break
    seen.add(id)
    const local = Transform.getOrNull(current)
    chain.push(localOf(local))
    current = parentOf(local)
  }
  chain.reverse()
  return composeWorld(chain)
}

/** The parent to walk to next, or null at the scene root. */
function parentOf(local: { parent?: Entity } | null): Entity | null {
  const parent = local?.parent
  return parent === undefined || Number(parent) === 0 ? null : parent
}

/** Read a Transform — a live component or a snapshot's JSON — with identity for anything it does not say. */
function localOf(value: unknown): LocalTransform {
  const source: Record<string, unknown> = isRecord(value) ? value : {}
  const position = isRecord(source.position) ? source.position : {}
  const rotation = isRecord(source.rotation) ? source.rotation : {}
  const scale = isRecord(source.scale) ? source.scale : {}
  return {
    position: { x: numberOf(position.x, 0), y: numberOf(position.y, 0), z: numberOf(position.z, 0) },
    rotation: {
      x: numberOf(rotation.x, 0),
      y: numberOf(rotation.y, 0),
      z: numberOf(rotation.z, 0),
      w: numberOf(rotation.w, 1)
    },
    scale: { x: numberOf(scale.x, 1), y: numberOf(scale.y, 1), z: numberOf(scale.z, 1) },
    // worldOf walks the chain itself; composeWorld never reads this.
    parent: 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
