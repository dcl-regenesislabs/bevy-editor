// A spawn point. Pick the prefab it copies and what sets it off; the Multiplayer
// Server does the rest — it mints every copy's id, holds the per-spot cap and
// broadcasts the alive-set, so every player sees the same copies in the same
// place instead of each game inventing its own.
//
// The spot's id is the entity's NAME, the handle the creator, the inspector and
// another script already share, so a lever somewhere else sets this one off with
// requestSpawn('Crate Spawner') and nothing has to be wired. Placement makes
// names unique, so a second "Crate Spawner" is "Crate Spawner 2" and is its own
// spot.
//
// The pool is opened HERE rather than inside the bus: a pool opened in a carried
// runtime module is invisible to the editor's guarantee scan, and the prefab this
// spot copies every ten seconds would read "Not used yet" forever.
import {
  InputAction,
  MeshCollider,
  PointerEventType,
  PointerEvents,
  Transform,
  TriggerArea,
  VisibilityComponent,
  inputSystem,
  triggerAreaEventsSystem,
  type Entity
} from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { markServerReady, startServerLife } from './runtime/serverLife'
import { serverState, type ServerState } from './runtime/serverState'
import { spawnSpot, type SpawnSpot } from './runtime/spawnBus'
import { pool as openPool, type Pool } from './runtime/spawner'
import { onZone, zoneOf } from './runtime/zoneBus'

/** A prefab id picked in the inspector's prefab dropdown. */
type PrefabRef = string

// One id per prefab on the readiness ladder — a second placed Spawner is the same
// participant. The bus holds its own id next to this one.
const PARTICIPANT = 'spawner'
// Collision layers by value, not by name: the SDK renamed CL_RESERVED2 to
// CL_MAIN_PLAYER, and this script compiles against whatever pin the creator's
// project happens to carry.
const CL_POINTER = 1
// The local avatar's collider carries this layer and remote avatars' do not, so
// the walk-in area fires for the player standing at THIS game, exactly once.
const CL_MAIN_PLAYER = 8
const CLICK_RANGE_M = 8
// The server sweep only READS the deadline below; it is not what keeps the time.
const SWEEP_S = 0.25

interface SavedSpot {
  /** Absolute wall-clock deadline — the only form of "every N seconds" that survives a server sleep. */
  nextDueAtMs: number
}

export class Spawner {
  private spot: SpawnSpot | null = null
  private name = ''
  private zone = ''
  private saved: ServerState<SavedSpot> | null = null
  private restored = false
  private serverSide = false
  private armed = false
  private subscribing = false
  private accum = 0

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
    public disappearsAfter: number = 0
  ) {}

  // What sets this spot off is derived from WHERE IT SITS, never picked from a
  // list: parented to something, that something is the button or the zone; on
  // its own, the spawner itself is — its disc becomes the button, its spot
  // becomes the walk-in area (scale is metres, the gizmo is the resize tool).
  // Spread and marker visibility are automatic for the same reason: several
  // copies spread just enough not to stack, and the disc shows itself in Play
  // exactly when this spawner IS the button.
  private parentEntity(): Entity | null {
    const parent = Transform.getOrNull(this.entity)?.parent
    return parent === undefined || Number(parent) === 0 ? null : parent
  }

  private get isOwnButton(): boolean {
    return this.when === 'when clicked' && this.parentEntity() === null
  }

  start(): void {
    VisibilityComponent.createOrReplace(this.entity, { visible: this.isOwnButton })
    startServerLife(PARTICIPANT)
    this.serverSide = isServer()
    this.name = zoneOf(this.entity)
    const pool = this.spawnPool()
    // A blank name, a Spawner nested inside a prefab that gets copied, or a second
    // spot under the same name: the bus refuses, says which, and this one stands
    // down rather than registering under an id it would share.
    this.spot =
      pool === null
        ? null
        : spawnSpot(this.name, {
            pool,
            spot: this.entity,
            atMostAtOnce: this.atMostAtOnce,
            lifetimeS: this.disappearsAfter
          })
    if (this.spot === null) {
      // startServerLife already put this participant on the readiness ladder, and
      // the server's first heartbeat waits for every one of them. A freshly placed
      // Spawner with nothing picked yet must not hold the whole scene there.
      markServerReady(PARTICIPANT)
      return
    }
    if (this.serverSide) this.startServer()
    else this.startClient()
  }

  update(dt: number): void {
    if (this.spot === null) return
    if (!this.armed) {
      this.armed = true
      this.subscribing = false
      // The pointer hint is merged on the first TICK, not in start(): script start
      // order is not authored, so another script's createOrReplace of PointerEvents
      // during start() would silently erase it.
      if (!this.serverSide && this.when === 'when clicked') this.armClick()
    }
    if (this.serverSide) {
      this.tickServer(dt)
      return
    }
    if (this.when !== 'when clicked') return
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, this.clickTarget())) {
      this.spot.request()
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

  // --- client ---------------------------------------------------------------

  private startClient(): void {
    if (this.when !== 'when a player enters') return
    const parent = this.parentEntity()
    const parentZone = parent !== null && TriggerArea.getOrNull(parent) !== null ? zoneOf(parent) : ''
    if (parentZone !== '') {
      this.zone = parentZone
      this.subscribing = true
      onZone(this.zone, 'enter', (event) => {
        // Late subscribers get current occupancy replayed as enters, and those arrive
        // synchronously inside this call: someone already standing here did not just
        // walk in, and a copy must not appear because a script started.
        if (this.subscribing || !event.local) return
        this.spot?.request()
      })
      return
    }
    // Not sitting in a zone: this spot IS the walk-in area. The engine's enter
    // event only fires on the transition, so someone already standing here when
    // the scene starts does not set it off — same rule as the zone path.
    TriggerArea.setBox(this.entity, CL_MAIN_PLAYER)
    triggerAreaEventsSystem.onTriggerEnter(this.entity, () => this.spot?.request())
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

  // --- server ---------------------------------------------------------------

  private startServer(): void {
    // Keyed by the spot's name, so two Spawners keep two deadlines; the store
    // refuses a reused key outright.
    const state = serverState<SavedSpot>({
      key: `spawner:${this.name}`,
      defaults: () => ({ nextDueAtMs: 0 }),
      persist: true
    })
    this.saved = state
    void state
      .restore()
      .catch((error) => {
        console.log('[Spawner] could not read back what this spot had already done:', error)
      })
      .then(() => {
        this.restored = true
        // Last, and never earlier: a spot that answered before reading its deadline
        // back would drip once more for every restart. A read that failed still
        // answers — a server nobody hears from is worse than one drip too many.
        markServerReady(PARTICIPANT)
      })
  }

  private tickServer(dt: number): void {
    const state = this.saved
    if (state === null || !this.restored) return
    this.accum += dt
    if (this.accum < SWEEP_S) return
    this.accum = 0
    if (this.when !== 'every few seconds') return
    const everyMs = Math.max(1, this.everySeconds) * 1000
    const now = Date.now()
    const due = state.get().nextDueAtMs
    // First run, or a deadline further out than the current setting can explain
    // (the creator lowered "every few seconds"): re-base it and wait.
    if (due === 0 || due > now + everyMs) {
      state.patch({ nextDueAtMs: now + everyMs })
      void state.flush()
      return
    }
    if (now < due) return
    // One copy per sweep, never a burst: a server that slept through ten deadlines
    // owes the scene one copy, not ten.
    state.patch({ nextDueAtMs: now + everyMs })
    void state.flush()
    this.spot?.request()
  }
}
