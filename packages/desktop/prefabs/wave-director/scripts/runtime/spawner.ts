import {
  EntityState,
  Schemas,
  engine,
  type Entity,
  type LastWriteWinElementSetComponentDefinition
} from '@dcl/sdk/ecs'
import { isServer, syncEntity } from '@dcl/sdk/network'
import { getActionEvents } from '@dcl/asset-packs'
import { getServerTime, initTimeSync } from './timeSync'
import { playerPositions } from './playerPositions'
import { outcomes } from './outcomes'
import { PoolState, stableId } from './pure/poolState'
import { PlanQueue, tupleKey } from './pure/spawnPlan'
import {
  instanceKey,
  isFunctionStyleScript,
  methodOf,
  parseScriptLayout,
  resolveScriptClass,
  resolveScriptParams,
  scriptSrc,
  type ActionRef,
  type ScriptInstance
} from './pure/scriptInit'

// Runtime instancing of editor-authored prefabs, from snapshots the editor
// generates into src/scripts/spawnables.ts.
//
//   pool('<prefab-id>', 'seeded')                  // client-local, reconstructed
//   pool('<prefab-id>', 'server')                  // server-created + synced (1 entity)
//   plan('<prefab-id>', tuple => entries, { outcomes: ['hit', 'died'] })
//   perPlayer('<prefab-id>')                       // one clone per present player
//
// A clone is built from the snapshot's component literals and then its Script
// rows are CONSTRUCTED THE WAY THE SDK RUNNER CONSTRUCTS PLACED SCRIPTS: same
// `src` (the script's directory), same positional params in layout order, same
// action callbacks, same registration into globalThis.__DCL_SCRIPT_INSTANCES__
// (so callScriptMethod reaches clones), same per-priority update systems. The
// rules live in pure/scriptInit.ts and are tested against the real runner's
// source; if that file ever changes, packages/desktop/validate/probe-script-runner.mjs
// fails before a scene does.
//
// Authority, one line each:
//   'server'    one synced entity the server owns; v1 rejects multi-entity
//               prefabs (a clone's Transform.parent is meaningless on a client).
//   'planned'   client-local clones on a plan that is a pure function of
//               {seed, phase, phaseStartMs, configVersion} — same spawns and same
//               alive-set everywhere, positions client-simulated. Requires an
//               `outcomes` declaration: gameplay results are only real if the
//               server validated them.
//   'seeded'    client-local clones reconstructed from a shared pick or seed.
//   'perPlayer' one client-local clone per present player, AvatarAttach'd.
//
// release() is destructive for the client-local modes: the clone's scripts get
// their optional detach(), the entities are removed, and the next acquire()
// builds fresh from the snapshot — so "release then re-acquire" is exactly "fresh
// acquire" and no timer, target or closure can survive into the next life. Only
// 'server' pools reuse entities (their synced id must stay stable), resetting to
// the snapshot and blanking GltfContainer.src so colliders reload.
//
// Planned pools, the three things a consumer must know:
//   - feed the synced tuple every tick: pool.sync({seed, phase, phaseStartMs,
//     configVersion}). Re-planning happens only when the tuple changes.
//   - a plan entry's `init` is component-name → value, applied to the clone's
//     root BEFORE its scripts start ({'core::Transform': {position}} = spawn point).
//   - the ledger key is the prefab id: outcomes(prefabId) on the server for
//     validators, outcomes(spawnedFrom(entity).prefab) from a clone's own script.
//     A `died` outcome cancels a not-yet-spawned entry; releasing a live clone
//     stays the consumer's call so the death animation can play.
//
// One pool per prefab: opening it twice returns the same pool (and rejects a
// second, different authority), so the first opener owns onSpawn/onRelease.
//
// Cross-copy: every prefab carries its own copy of this file, so the snapshot
// table and the live pools hang off globalThis.__dclSpawner_v1, probed by shape.

const HUB_KEY = '__dclSpawner_v1'
const INSTANCES_KEY = '__DCL_SCRIPT_INSTANCES__'
const TRANSFORM = 'core::Transform'
const GLTF = 'core::GltfContainer'
const AVATAR_ATTACH = 'core::AvatarAttach'
const DIED = 'died'
const ROSTER_INTERVAL_S = 0.5

export type SpawnAuthority = 'server' | 'planned' | 'seeded' | 'perPlayer'

export interface SpawnedFromValue {
  prefab: string
  instanceId: number
}

export interface ScriptSpec {
  localId: number
  path: string
  priority: number
  layout: string
  module: Record<string, unknown>
}

export interface PrefabSnapshotEntity {
  localId: number
  parent: number | null
  components: Array<{ name: string; json: unknown }>
}

export interface PrefabSnapshot {
  prefab: string
  alias: string
  max: number
  /**
   * What the prefab declares in data.json — NOT the sync mode, which is an
   * argument at pool-open. 'perPlayer' means the generated registry opens the
   * per-player pool itself at start(); absent reads as 'onDemand'.
   */
  instancing?: 'onDemand' | 'perPlayer'
  entities: PrefabSnapshotEntity[]
  scripts: ScriptSpec[]
}

export interface PlanTuple {
  seed: number
  phase: number
  phaseStartMs: number
  configVersion: number
}

export interface PlanEntry {
  instanceId: number
  atMs: number
  /** component-name → value, applied to the clone's root on spawn (spawn points live here). */
  init?: Record<string, unknown>
}

export type SpawnPlan = (tuple: PlanTuple) => PlanEntry[]

export interface PoolOptions {
  /** named gameplay events routed through validated rpc handlers; REQUIRED for 'planned'. */
  outcomes?: string[]
  /** called after a clone's scripts have started. */
  onSpawn?: (entity: Entity, instanceId: number) => void
  /** called before a clone is released; scripts' own detach() runs first. */
  onRelease?: (entity: Entity, instanceId: number) => void
}

export interface Pool {
  readonly prefab: string
  readonly max: number
  readonly mode: SpawnAuthority
  /** null when the pool is at `max`. */
  acquire(instanceId?: number): Entity | null
  mutate(entity: Entity, componentName: string, json: unknown): void
  release(entity: Entity): void
  releaseAll(): void
  alive(): Entity[]
  instanceIdOf(entity: Entity): number | null
  entityOf(instanceId: number): Entity | null
}

export interface PlannedPool extends Pool {
  /** Feed the synced tuple every tick; re-planning happens only when it changes. */
  sync(tuple: PlanTuple): void
}

export interface PerPlayerPool extends Pool {
  addressOf(entity: Entity): string | null
}

type AnyComponent = LastWriteWinElementSetComponentDefinition<unknown>

function defineSpawnedFrom() {
  return engine.defineComponent('runtime::SpawnedFrom', { prefab: Schemas.String, instanceId: Schemas.Int })
}
const SpawnedFrom =
  (engine.getComponentOrNull('runtime::SpawnedFrom') as ReturnType<typeof defineSpawnedFrom> | null) ??
  defineSpawnedFrom()

// Never stripped by a pooled reset: these carry the entity's sync identity, and an
// entity that loses them stops replicating for good.
const PROTECTED_COMPONENTS = [
  SpawnedFrom.componentName,
  'core-schema::Network-Entity',
  'core-schema::Network-Parent',
  'core-schema::Sync-Components',
  'core-schema::Created-By'
]

interface ScriptRun {
  entity: Entity
  path: string
  instance: ScriptInstance
  update: ((dt: number) => void) | null
}

interface Clone {
  instanceId: number
  root: Entity
  entities: Entity[]
  byLocal: Map<number, Entity>
  runs: ScriptRun[]
}

/** The live pool object. One per prefab, shared by every carried copy through the hub. */
interface PoolImpl extends Pool {
  state: PoolState<Entity>
  clones: Map<Entity, Clone>
  snapshot: PrefabSnapshot
  options: PoolOptions
  /** acquire + a hook that runs after the components land and BEFORE start(). */
  acquireWith(instanceId: number, prepare: (clone: Clone) => void): Entity | null
  adopt(entity: Entity, instanceId: number): void
  detachClone(entity: Entity): boolean
  sync?(tuple: PlanTuple): void
  addressOf?(entity: Entity): string | null
}

interface SpawnerHub {
  snapshots: Map<string, PrefabSnapshot>
  pools: Map<string, PoolImpl>
  register(snapshots: PrefabSnapshot[]): void
}

/** Publish the generated snapshot table. Called at MODULE SCOPE by spawnables.ts. */
export function registerSpawnables(snapshots: PrefabSnapshot[]): void {
  hub().register(snapshots)
}

/** 'server' throws when the snapshot has more than one entity (v1 limit). */
export function pool(prefab: string, mode: 'server' | 'seeded', opts: PoolOptions = {}): Pool {
  return openPool(prefab, mode, opts)
}

/** 'planned' — `plan` MUST be a pure function of the tuple; `opts.outcomes` is required. */
export function plan(prefab: string, planFn: SpawnPlan, opts: PoolOptions & { outcomes: string[] }): PlannedPool {
  if (!Array.isArray(opts.outcomes) || opts.outcomes.length === 0) {
    throw new Error(
      `planned pool '${prefab}' must declare outcomes: client-local spawns are only trustworthy where the server validates the results`
    )
  }
  const impl = openPool(prefab, 'planned', opts)
  if (impl.sync === undefined) withPlan(impl, planFn)
  return impl as PlannedPool
}

/** One clone per player present, roster from playerPositions(); client-local by design. */
export function perPlayer(prefab: string, opts: PoolOptions = {}): PerPlayerPool {
  const impl = openPool(prefab, 'perPlayer', opts)
  if (impl.addressOf === undefined) withRoster(impl)
  return impl as PerPlayerPool
}

export function spawnedFrom(entity: Entity): SpawnedFromValue | null {
  const value = SpawnedFrom.getOrNull(entity)
  return value === null ? null : { prefab: value.prefab, instanceId: value.instanceId }
}

export function poolFor(prefab: string): Pool | null {
  return hub().pools.get(prefab) ?? null
}

/** Unregister a clone's script instances without releasing the entity (escape hatch). */
export function detach(entity: Entity): void {
  for (const pool of hub().pools.values()) {
    if (pool.detachClone(entity)) return
  }
}

// --- pool construction ---

function openPool(prefab: string, mode: SpawnAuthority, opts: PoolOptions): PoolImpl {
  const shared = hub()
  const existing = shared.pools.get(prefab)
  if (existing !== undefined) {
    if (existing.mode !== mode) {
      throw new Error(`spawnable '${prefab}' is already pooled as '${existing.mode}' — one authority per prefab`)
    }
    return existing
  }
  const snapshot = shared.snapshots.get(prefab)
  if (snapshot === undefined) {
    throw new Error(`unknown spawnable '${prefab}' — is it Spawnable in the Prefabs tab? (src/scripts/spawnables.ts)`)
  }
  if (mode === 'server' && snapshot.entities.length > 1) {
    throw new Error('server-owned spawnables must be a single entity in v1')
  }
  const created = buildPool(snapshot, mode, opts)
  shared.pools.set(prefab, created)
  return created
}

function buildPool(snapshot: PrefabSnapshot, mode: SpawnAuthority, opts: PoolOptions): PoolImpl {
  const state = new PoolState<Entity>(snapshot.max)
  const clones = new Map<Entity, Clone>()
  const groups = new Map<number, ScriptRun[]>()
  const serverOwned = mode === 'server'
  let synced: number[] | null = null

  function groupFor(priority: number): ScriptRun[] {
    const existing = groups.get(priority)
    if (existing !== undefined) return existing
    const created: ScriptRun[] = []
    groups.set(priority, created)
    addUpdateSystem(snapshot, priority, created)
    return created
  }

  function start(clone: Clone): void {
    for (const spec of snapshot.scripts) {
      const entity = clone.byLocal.get(spec.localId)
      if (entity === undefined) continue
      const run = startScript(spec, entity)
      if (run === null) continue
      clone.runs.push(run)
      groupFor(spec.priority).push(run)
    }
  }

  function stop(clone: Clone): void {
    for (const run of clone.runs) {
      methodOf(run.instance, 'detach')?.()
      scriptRegistry().delete(instanceKey(run.entity, run.path))
      for (const runs of groups.values()) {
        const index = runs.indexOf(run)
        if (index >= 0) runs.splice(index, 1)
      }
    }
    clone.runs = []
  }

  function spawn(instanceId: number, prepare: (clone: Clone) => void): Clone {
    const parked = serverOwned ? state.unpark() : null
    const clone = parked === null ? buildClone(snapshot, instanceId) : reuseClone(snapshot, parked, instanceId)
    state.claim(instanceId, clone.root)
    clones.set(clone.root, clone)
    // spawn point, avatar binding, per-entry overrides: all of it must land before
    // a script's start() reads the entity it is attached to
    prepare(clone)
    try {
      start(clone)
    } catch (error) {
      stop(clone)
      if (parked === null) removeClone(clone)
      state.release(clone.root)
      clones.delete(clone.root)
      throw error
    }
    if (serverOwned && parked === null) {
      synced = synced ?? syncedComponentIds(snapshot)
      syncEntity(clone.root, synced)
    }
    opts.onSpawn?.(clone.root, instanceId)
    return clone
  }

  const api: PoolImpl = {
    prefab: snapshot.prefab,
    max: snapshot.max,
    mode,
    state,
    clones,
    snapshot,
    options: opts,
    acquire(instanceId?: number): Entity | null {
      return api.acquireWith(instanceId ?? state.nextId(), () => {})
    },
    acquireWith(instanceId: number, prepare: (clone: Clone) => void): Entity | null {
      if (serverOwned && !isServer()) {
        throw new Error(`server pool '${snapshot.alias}' is server-owned — clients read it, they do not acquire`)
      }
      const existing = state.entityOf(instanceId)
      if (existing !== null) return existing
      if (!state.canClaim(instanceId)) return null
      return spawn(instanceId, prepare).root
    },
    mutate(entity: Entity, componentName: string, json: unknown): void {
      writeComponent(entity, componentName, json)
    },
    release(entity: Entity): void {
      const clone = clones.get(entity)
      const instanceId = state.instanceIdOf(entity)
      if (clone === undefined || instanceId === null) return
      stop(clone)
      opts.onRelease?.(entity, instanceId)
      state.release(entity)
      clones.delete(entity)
      if (!serverOwned) {
        removeClone(clone)
        return
      }
      if (isServer()) {
        resetClone(snapshot, clone)
        state.park(entity)
      }
    },
    releaseAll(): void {
      for (const entity of state.alive()) api.release(entity)
    },
    alive(): Entity[] {
      return state.alive()
    },
    instanceIdOf(entity: Entity): number | null {
      return state.instanceIdOf(entity)
    },
    entityOf(instanceId: number): Entity | null {
      return state.entityOf(instanceId)
    },
    detachClone(entity: Entity): boolean {
      const clone = clones.get(entity)
      if (clone === undefined) return false
      stop(clone)
      return true
    },
    adopt(entity: Entity, instanceId: number): void {
      // server pools are single-entity in v1, so the whole clone IS this entity
      const clone: Clone = {
        instanceId,
        root: entity,
        entities: [entity],
        byLocal: new Map([[snapshot.entities[0].localId, entity]]),
        runs: []
      }
      state.claim(instanceId, entity)
      clones.set(entity, clone)
      start(clone)
      opts.onSpawn?.(entity, instanceId)
    }
  }

  if (serverOwned && !isServer()) watchServerClones(api)
  return api
}

// --- clone construction ---

function buildClone(snapshot: PrefabSnapshot, instanceId: number): Clone {
  const byLocal = new Map<number, Entity>()
  const entities: Entity[] = []
  for (const spec of snapshot.entities) {
    const entity = engine.addEntity()
    byLocal.set(spec.localId, entity)
    entities.push(entity)
  }
  for (const spec of snapshot.entities) {
    const entity = byLocal.get(spec.localId)
    if (entity === undefined) continue
    applyComponents(entity, spec, byLocal)
    SpawnedFrom.createOrReplace(entity, { prefab: snapshot.prefab, instanceId })
  }
  const rootSpec = snapshot.entities.find((spec) => spec.parent === null)
  const root = rootSpec === undefined ? entities[0] : (byLocal.get(rootSpec.localId) ?? entities[0])
  return { instanceId, root, entities, byLocal, runs: [] }
}

function reuseClone(snapshot: PrefabSnapshot, entity: Entity, instanceId: number): Clone {
  const byLocal = new Map<number, Entity>([[snapshot.entities[0].localId, entity]])
  applyComponents(entity, snapshot.entities[0], byLocal)
  SpawnedFrom.createOrReplace(entity, { prefab: snapshot.prefab, instanceId })
  return { instanceId, root: entity, entities: [entity], byLocal, runs: [] }
}

function applyComponents(entity: Entity, spec: PrefabSnapshotEntity, byLocal: Map<number, Entity>): void {
  const parent = spec.parent === null ? null : (byLocal.get(spec.parent) ?? null)
  let wroteTransform = false
  for (const component of spec.components) {
    const value = component.name === TRANSFORM ? withParent(component.json, parent) : component.json
    if (component.name === TRANSFORM) wroteTransform = true
    writeComponent(entity, component.name, value)
  }
  // a child with no authored Transform would otherwise sit at the scene origin
  if (!wroteTransform && parent !== null) writeComponent(entity, TRANSFORM, withParent(undefined, parent))
}

function withParent(json: unknown, parent: Entity | null): unknown {
  const base = isRecord(json) ? { ...json } : identityTransform()
  if (parent === null) delete base.parent
  else base.parent = parent
  return base
}

function identityTransform(): Record<string, unknown> {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

function removeClone(clone: Clone): void {
  for (const entity of [...clone.entities].reverse()) engine.removeEntity(entity)
}

/** Snapshot-diff reset: strip whatever gameplay added, restore the authored values. */
function resetClone(snapshot: PrefabSnapshot, clone: Clone): void {
  const spec = snapshot.entities[0]
  const keep = new Set(spec.components.map((component) => component.name))
  for (const name of PROTECTED_COMPONENTS) keep.add(name)
  for (const definition of engine.componentsIter()) {
    if (keep.has(definition.componentName)) continue
    try {
      const lww = definition as AnyComponent
      if (lww.has(clone.root)) lww.deleteFrom(clone.root)
    } catch {
      // value-set components have no deleteFrom — nothing pooled writes them
    }
  }
  applyComponents(clone.root, spec, clone.byLocal)
  // blanking the src is what makes the renderer rebuild colliders on the next acquire
  const gltf = spec.components.find((component) => component.name === GLTF)
  if (gltf !== undefined) writeComponent(clone.root, GLTF, { ...asRecord(gltf.json), src: '' })
}

function syncedComponentIds(snapshot: PrefabSnapshot): number[] {
  const ids = [SpawnedFrom.componentId]
  for (const component of snapshot.entities[0].components) {
    const definition = componentByName(component.name)
    if (definition !== null && !ids.includes(definition.componentId)) ids.push(definition.componentId)
  }
  return ids
}

// --- script running (runner parity: see pure/scriptInit.ts) ---

function startScript(spec: ScriptSpec, entity: Entity): ScriptRun | null {
  const src = scriptSrc(spec.path)
  try {
    const layout = parseScriptLayout(spec.layout)
    const params = resolveScriptParams(layout, createActionCallback)
    if (isFunctionStyleScript(spec.module)) {
      // the runner's other branch: `export function start(src, entity, …params)`
      methodOf(spec.module, 'start')?.(src, entity, ...params)
      const update = methodOf(spec.module, 'update')
      return register({
        entity,
        path: spec.path,
        instance: spec.module,
        update: update === null ? null : (dt: number) => void update(src, entity, dt, ...params)
      })
    }
    const Script = resolveScriptClass<Entity>(spec.module)
    if (Script === null) {
      console.error('[Script] No class found in module:', spec.path)
      return null
    }
    const instance = new Script(src, entity, ...params)
    methodOf(instance, 'start')?.()
    const update = methodOf(instance, 'update')
    return register({
      entity,
      path: spec.path,
      instance,
      update: update === null ? null : (dt: number) => void update(dt)
    })
  } catch (error) {
    console.error('[Script Error] ' + spec.path + ' class initialization failed:', error)
    throw error
  }
}

function register(run: ScriptRun): ScriptRun {
  scriptRegistry().set(instanceKey(run.entity, run.path), {
    instance: run.instance,
    entity: run.entity,
    path: run.path
  })
  return run
}

function addUpdateSystem(snapshot: PrefabSnapshot, priority: number, runs: ScriptRun[]): void {
  engine.addSystem(
    (dt: number) => {
      for (const run of [...runs]) {
        try {
          if (engine.getEntityState(run.entity) === EntityState.Removed) continue
          run.update?.(dt)
        } catch (error) {
          console.error('[Script Error] update() failed:', error)
        }
      }
    },
    priority,
    `runtime-spawner-${snapshot.prefab}-${priority}`
  )
}

/** The runner's ActionCallback, reproduced: an 'action' param emits on its target entity. */
function createActionCallback(ref: ActionRef): () => void {
  return () => {
    if (!ref.entity || !ref.action) {
      console.error('[Script] ActionCallback called with invalid action reference:', ref)
      return
    }
    getActionEvents(ref.entity).emit(ref.action, {})
  }
}

interface ScriptRegistryEntry {
  instance: unknown
  entity: Entity
  path: string
}

// The same feature-detect runtime-script.js does at its own module scope, so
// callScriptMethod(entity, path, method) finds clones as well as placed scripts.
function scriptRegistry(): Map<string, ScriptRegistryEntry> {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[INSTANCES_KEY]
  if (current instanceof Map) return current as Map<string, ScriptRegistryEntry>
  const created = new Map<string, ScriptRegistryEntry>()
  globals[INSTANCES_KEY] = created
  return created
}

// --- mode drivers ---

function withPlan(impl: PoolImpl, planFn: SpawnPlan): void {
  const queue = new PlanQueue()
  // The pool's ledger key IS the prefab id, so a clone's own script can reach it
  // with outcomes(spawnedFrom(this.entity).prefab) and the server arms validators
  // under the same key without a table to agree on.
  const ledger = outcomes(impl.prefab)
  // a death that lands before the spawn does must cancel it — rejoiners must not
  // materialise the zombies everyone else already killed. Releasing an ALREADY
  // materialised clone stays the consumer's call, so death animations can play.
  ledger.onOutcome((entry) => {
    if (entry.kind === DIED) queue.suppress(entry.instanceId)
  })
  impl.sync = (tuple: PlanTuple): void => {
    queue.reset(tupleKey(tuple), planFn(tuple))
  }
  // the plan is only "the same everywhere" on a shared clock; a scene with a
  // planned pool and no Server Clock would otherwise spawn on local wall time
  initTimeSync()
  if (isServer()) return // the server never materialises planned clones
  engine.addSystem(
    () => {
      const room = impl.max - impl.state.size
      if (room <= 0) return
      for (const entry of queue.due(getServerTime(), room)) {
        const spawned = impl.acquireWith(entry.instanceId, (clone) => {
          for (const [name, json] of Object.entries(entry.init ?? {})) writeComponent(clone.root, name, json)
        })
        if (spawned === null) break
      }
    },
    undefined,
    `runtime-spawner-plan-${impl.prefab}`
  )
}

function withRoster(impl: PoolImpl): void {
  const addresses = new Map<Entity, string>()
  impl.addressOf = (entity: Entity): string | null => addresses.get(entity) ?? null
  if (isServer()) return // avatars only exist on clients
  let waited = 0
  engine.addSystem(
    (dt: number) => {
      waited += dt
      if (waited < ROSTER_INTERVAL_S) return
      waited = 0
      const wanted = new Map<number, string>()
      for (const player of playerPositions()) wanted.set(stableId(player.address), player.address)
      for (const [instanceId, address] of wanted) {
        if (impl.state.entityOf(instanceId) !== null) continue
        const entity = impl.acquireWith(instanceId, (clone) => attachToAvatar(impl, clone, address))
        if (entity === null) break
        addresses.set(entity, address)
      }
      for (const slot of impl.state.slots()) {
        if (wanted.has(slot.instanceId)) continue
        addresses.delete(slot.entity)
        impl.release(slot.entity)
      }
    },
    undefined,
    `runtime-spawner-roster-${impl.prefab}`
  )
}

/** Every AvatarAttach the prefab authored follows THIS player — that is the whole rig trick. */
function attachToAvatar(impl: PoolImpl, clone: Clone, address: string): void {
  for (const spec of impl.snapshot.entities) {
    const attach = spec.components.find((component) => component.name === AVATAR_ATTACH)
    const entity = clone.byLocal.get(spec.localId)
    if (attach === undefined || entity === undefined) continue
    writeComponent(entity, AVATAR_ATTACH, { ...asRecord(attach.json), avatarId: address })
  }
}

/** Client side of a 'server' pool: adopt what the server created, drop what it removed. */
function watchServerClones(impl: PoolImpl): void {
  engine.addSystem(
    () => {
      for (const [entity, marker] of engine.getEntitiesWith(SpawnedFrom)) {
        if (marker.prefab !== impl.prefab) continue
        const bound = impl.state.instanceIdOf(entity)
        if (bound === marker.instanceId) continue
        if (bound !== null) impl.release(entity) // reused slot: rebuild against the new id
        impl.adopt(entity, marker.instanceId)
      }
      for (const slot of impl.state.slots()) {
        if (SpawnedFrom.has(slot.entity)) continue
        impl.release(slot.entity)
      }
    },
    undefined,
    `runtime-spawner-adopt-${impl.prefab}`
  )
}

// --- components + hub ---

const definitions = new Map<string, AnyComponent | null>()

function componentByName(name: string): AnyComponent | null {
  const cached = definitions.get(name)
  if (cached !== undefined) return cached
  const direct = engine.getComponentOrNull(name)
  const found = direct ?? (name.includes('::') ? null : engine.getComponentOrNull(`core::${name}`))
  const definition = found === null ? null : (found as AnyComponent)
  definitions.set(name, definition)
  if (definition === null) console.log(`[spawner] unknown component '${name}' — clones will not carry it`)
  return definition
}

function writeComponent(entity: Entity, name: string, json: unknown): void {
  componentByName(name)?.createOrReplace(entity, json)
}

function hub(): SpawnerHub {
  const globals = globalThis as unknown as Record<string, unknown>
  const current = globals[HUB_KEY]
  if (isHub(current)) return current
  const snapshots = new Map<string, PrefabSnapshot>()
  const created: SpawnerHub = {
    snapshots,
    pools: new Map<string, PoolImpl>(),
    register(entries: PrefabSnapshot[]): void {
      for (const entry of entries) snapshots.set(entry.prefab, entry)
    }
  }
  globals[HUB_KEY] = created
  return created
}

// Two prefabs bundle two copies of this file, so the classes differ and
// instanceof would reject the shared hub — shape is the only identity that
// survives (the zoneBus rule).
function isHub(value: unknown): value is SpawnerHub {
  return (
    typeof value === 'object' &&
    value !== null &&
    'snapshots' in value &&
    value.snapshots instanceof Map &&
    'pools' in value &&
    value.pools instanceof Map &&
    'register' in value &&
    typeof value.register === 'function'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}
