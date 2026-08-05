// Arena rotation with one value on the wire. The Multiplayer Server owns which
// arena each slot shows and nothing else: the pick INDEX lives in one synced,
// server-protected component on one entity, so the v1 "server-owned spawnables
// are a single entity" limit is respected by design, not by luck. The arena
// itself is a Spawnable prefab every client reconstructs locally from that pick
// — static geometry from a shared index is exactly the case where seeded
// reconstruction genuinely holds, and it lets an arena be as many entities as
// the creator likes.
//
// Slots are the controller's child entities, used in hierarchy order; the prefab
// ships one (Slot_1). Duplicate it to add more, then raise slotCount.
import { Schemas, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { protectedSync } from './runtime/protectedSync'
import { serverState, type ServerState } from './runtime/serverState'
import { pool as openPool, poolFor as existingPool, type Pool } from './runtime/spawner'
import { createRng } from './runtime/rng'
import { installRotator, publishArenas, rotateLevels } from './level-slots-api'
import {
  changedSlots,
  isRotationPhase,
  normalizeRefs,
  pickSlots,
  refAt,
  rotationSeed,
  slotCountFor,
  type PrefabRef
} from './pure/slotPick'

// The editor allocates scene entities from 8001 up and admin-tools reserves
// 8000, so the kit prefabs take a block above it; every client must agree on
// this number before any of them has seen the scene.
const SLOT_SYNC_ID = 8020
const POLL_S = 0.25

// The Round Loop mirrors its tuple here. Absent (no Round Loop placed) the slots
// keep whatever they drew at boot and rotateLevels() stays the creator's call —
// this prefab must not invent a clock of its own.
const TUPLE_KEY = '__dclRoundTuple_v1'

interface RoundPhase {
  seed: number
  phase: number
}

function readPhase(): RoundPhase | null {
  const raw = (globalThis as unknown as Record<string, unknown>)[TUPLE_KEY]
  if (typeof raw !== 'object' || raw === null) return null
  const tuple = raw as Record<string, unknown>
  if (typeof tuple.phase !== 'number') return null
  return { seed: typeof tuple.seed === 'number' ? tuple.seed : 0, phase: Math.floor(tuple.phase) }
}

const SLOT_STATE = 'levelSlots::SlotState'

function defineSlotState() {
  return engine.defineComponent(SLOT_STATE, {
    round: Schemas.Int,
    picks: Schemas.Array(Schemas.Int)
  })
}

// A sibling copy of this prefab may already have defined it.
const SlotState =
  (engine.getComponentOrNull(SLOT_STATE) as ReturnType<typeof defineSlotState> | null) ?? defineSlotState()

interface SlotsState {
  round: number
  picks: number[]
}

interface LiveArena {
  ref: string
  entity: Entity
}

// Ordered by entity id, which is authoring order — the same on the server, on
// every client and in the editor, with no dependence on what the slots are named.
function slotAnchors(root: Entity): Entity[] {
  const out: Entity[] = []
  for (const [entity, transform] of engine.getEntitiesWith(Transform)) {
    if (transform.parent === root) out.push(entity)
  }
  out.sort((a, b) => Number(a) - Number(b))
  return out.length > 0 ? out : [root]
}

function reparent(entity: Entity, parent: Entity): void {
  const at = Transform.getOrNull(entity)
  Transform.createOrReplace(entity, {
    position: at === null ? Vector3.Zero() : Vector3.create(at.position.x, at.position.y, at.position.z),
    rotation:
      at === null ? Quaternion.Identity() : Quaternion.create(at.rotation.x, at.rotation.y, at.rotation.z, at.rotation.w),
    scale: at === null ? Vector3.One() : Vector3.create(at.scale.x, at.scale.y, at.scale.z),
    parent
  })
}

export class LevelSlots {
  private anchors: Entity[] = []
  private slots = 0
  private refs: string[] = []
  private stateEntity: Entity = 0 as Entity
  private store: ServerState<SlotsState> | null = null
  private live: Array<LiveArena | undefined> = []
  private shown: number[] = []
  private round = -1
  private accum = 0
  private phase: number | null = null

  constructor(
    public src: string,
    public entity: Entity,
    /** How many arena slots this instance drives — one per child entity, in hierarchy order */
    public slotCount: number = 1,
    /** The Spawnable prefabs to rotate through — pick them in the dropdown */
    public arenas: PrefabRef[] = []
  ) {}

  start(): void {
    this.refs = normalizeRefs(this.arenas)
    this.anchors = slotAnchors(this.entity)
    this.slots = slotCountFor(this.slotCount, this.anchors.length)
    // The controller carries the state: it is the entity this script is attached
    // to, so server and clients name the same one without assuming anything about
    // what the baseline did with the slot children.
    this.stateEntity = this.entity
    if (this.refs.length === 0) {
      console.log('[LevelSlots] no arenas selected — pick Spawnable prefabs in the arenas param')
    }
    if (isServer()) this.startServer()
    else this.startClient()
  }

  update(dt: number): void {
    this.accum += dt
    if (this.accum < POLL_S) return
    this.accum = 0
    if (isServer()) {
      this.followPhase()
      return
    }
    const state = SlotState.getOrNull(this.stateEntity)
    if (state === null || state.round === this.round) return
    this.round = state.round
    this.applyPicks(state.picks.map((pick: number) => pick))
  }

  // Both peers name the same entity under the same syncId; only the server arms
  // a validator, which is why protectedSync is server-only.
  private startClient(): void {
    if (!SlotState.has(this.stateEntity)) SlotState.create(this.stateEntity, { round: 0, picks: [] })
    syncEntity(this.stateEntity, [SlotState.componentId], SLOT_SYNC_ID)
  }

  private startServer(): void {
    protectedSync({
      entity: this.stateEntity,
      syncId: SLOT_SYNC_ID,
      components: [SlotState],
      // The picks are server-owned outright: no client write is ever legitimate.
      validate: () => false
    })
    const store = serverState<SlotsState>({
      key: `levelSlots:${this.entity}`,
      defaults: () => ({ round: 0, picks: [] }),
      persist: true
    })
    this.store = store
    installRotator((seed: number) => this.draw(seed))
    void store.restore().then(() => {
      const restored = store.get()
      // A restart mid-round keeps the arena everyone already has on screen.
      if (restored.round > 0 && restored.picks.length === this.slots) this.publish(restored.round, restored.picks)
      else this.draw(Date.now())
    })
  }

  // The rotation caller. Going through rotateLevels() rather than draw() keeps
  // one entry point for "new arenas now", so a creator's own call and the phase
  // boundary cannot diverge. The first tuple read only records where the round
  // is: the arena on screen at boot came from the restore, and redrawing it here
  // would swap the geometry the moment a server restarted mid-round.
  private followPhase(): void {
    const tuple = readPhase()
    if (tuple === null || tuple.phase === this.phase) return
    const first = this.phase === null
    this.phase = tuple.phase
    if (first || !isRotationPhase(tuple.phase)) return
    rotateLevels(rotationSeed(tuple.seed, tuple.phase))
  }

  private draw(seed: number): void {
    if (!isServer()) return
    const previous = this.store?.get() ?? { round: 0, picks: [] }
    const round = previous.round + 1
    const rng = createRng((seed | 0) ^ Math.imul(round, 0x9e3779b1))
    const draws: number[] = []
    for (let slot = 0; slot < this.slots; slot++) draws.push(rng())
    const picks = pickSlots({ draws, arenaCount: this.refs.length, previous: previous.picks })
    this.store?.patch({ round, picks })
    this.publish(round, picks)
  }

  private publish(round: number, picks: number[]): void {
    SlotState.createOrReplace(this.stateEntity, { round, picks })
  }

  private applyPicks(picks: number[]): void {
    for (const slot of changedSlots(this.shown, picks)) {
      if (slot >= this.slots) continue
      this.clear(slot)
      this.spawn(slot, picks[slot] ?? -1)
    }
    this.shown = picks
    publishArenas(picks.map((pick) => refAt(this.refs, pick) ?? ''))
  }

  private spawn(slot: number, pick: number): void {
    const ref = refAt(this.refs, pick)
    const anchor = this.anchors[slot]
    if (ref === null || anchor === undefined) return
    const arena = this.arenaPool(ref)
    if (arena === null) return
    const root = arena.acquire(slot)
    if (root === null) {
      console.log(`[LevelSlots] pool for ${ref} is at max — slot ${slot} stays empty`)
      return
    }
    reparent(root, anchor)
    this.live[slot] = { ref, entity: root }
  }

  private clear(slot: number): void {
    const live = this.live[slot]
    if (live === undefined) return
    existingPool(live.ref)?.release(live.entity)
    this.live[slot] = undefined
  }

  // 'seeded': client-local reconstruction from a value the server chose. Never
  // 'server' — that mode is single-entity, and an arena is a whole subtree.
  private arenaPool(ref: string): Pool | null {
    const existing = existingPool(ref)
    if (existing !== null) return existing
    try {
      return openPool(ref, 'seeded')
    } catch (error) {
      console.log(`[LevelSlots] ${ref} is not a Spawnable prefab —`, error)
      return null
    }
  }
}
