// The Spawner's own scene checks. Kept out of scene-check-rules.ts, which is
// already close to the file-length gate — everything else about them (the
// context shape, the copy discipline, the registry) is identical.
//
// All three are pure functions of the context, like every other rule.
import { baseName } from '../../script/project-files'
import { isRecord, type PrefabSnapshot } from '../../prefabs/format'
import { spawnCallsIn, type SpawnCall } from '../../prefabs/guarantees'
import { effectiveSpawnable } from '../../prefabs/spawnable'
import {
  aliasOf,
  allScriptRows,
  folderScriptRows,
  prefabIdsIn,
  prefabsByAlias,
  prefabsById,
  resolveCallArg,
  sceneScriptRows,
  spawnerCalls,
  type ScriptRow,
  type SpawnerCall
} from './scene-check-model'
import type { SceneCheck, SceneCheckContext, SceneCheckPrefab, SceneFinding } from './scene-checks'

export const SPAWNER_CHECK_IDS = {
  /** two consumers, one prefab, two different spawn authorities */
  mixedPool: 'mixed-pool-authority',
  /** the prefab a Spawner makes copies of has a Spawner inside it */
  nestedSpawn: 'spawner-nested-spawn',
  /** the entity a click-triggered Spawner points at can never register a click */
  clickTarget: 'spawner-click-no-collider',
  /** a Spawner with no prefab picked spawns nothing, silently */
  nothingPicked: 'spawner-nothing-picked',
  /** the Spawners aimed at one prefab ask for more copies than can be alive */
  poolOverrun: 'spawner-pool-overrun'
} as const

// A carried runtime module IS the machinery — its own internals would read as a
// project-wide statement about every prefab.
function isConsumerScript(path: string): boolean {
  return !path.includes('/runtime/')
}

// Which script a Spawner's settings live on. The folder slug can be renamed and
// the prefab can be copied, so the file name is the only stable mark — and the
// `/runtime/` exclusion keeps the carried modules out of it.
function isSpawnerScript(path: string): boolean {
  return isConsumerScript(path) && /(^|\/)spawner\.ts$/.test(path)
}

function paramString(row: ScriptRow, name: string): string {
  const param = row.params.find((p) => p.name === name)
  return typeof param?.value === 'string' ? param.value : ''
}

function entityLabel(snapshot: PrefabSnapshot, entityId: string): string {
  const name = snapshot[entityId]?.['core-schema::Name']
  const value = isRecord(name) ? name.value : undefined
  return typeof value === 'string' && value !== '' ? value : `#${entityId}`
}

// --- 1. mixed-pool-authority ---

type SpawnAuthority = 'server' | 'planned' | 'seeded' | 'layout' | 'perPlayer'

// The words the Prefabs tab already uses for each authority. A rule that invented
// its own names for them would describe a scene the creator cannot find.
const AUTHORITY_LABEL: Record<SpawnAuthority, string> = {
  server: 'Server-owned',
  planned: 'Planned spawns',
  seeded: 'Spawned per player',
  layout: 'Same for every player',
  perPlayer: 'One per player'
}

// The mode the runtime keys the pool by. `game.layout` opens a SEEDED pool
// (`game.ts` `replanLayout`), so it is a fifth authority over a prefab but the
// fourth mode — which is exactly why the two failures below are different.
const POOL_MODE: Record<SpawnAuthority, string> = {
  server: 'server',
  planned: 'planned',
  seeded: 'seeded',
  layout: 'seeded',
  perPlayer: 'perPlayer'
}

function authorityOf(call: SpawnerCall): SpawnAuthority | null {
  if (call.fn === 'plan') return 'planned'
  if (call.fn === 'perPlayer') return 'perPlayer'
  if (call.mode === 'server' || call.mode === 'seeded') return call.mode
  return null
}

// `game.layout(prefab, …)` opens a pool the spawner-module scan cannot see: its
// specifier is the game module, not the spawner one. guarantees.ts already reads
// it for the Prefabs tab's chips, so the claim comes from there rather than from
// a third scanner — what is needed back is the first argument in the form
// `resolveCallArg` reads. A ref the scan could not follow resolves to nothing:
// guarantees may credit one of its script's own prefab params for a chip, but a
// blocker must not be an inference.
function layoutArg(call: SpawnCall): string | null {
  switch (call.ref.kind) {
    case 'literal':
      return `'${call.ref.value}'`
    case 'alias':
      return `Spawnables.${call.ref.name}`
    case 'param':
      return `this.${call.ref.name}`
    case 'unknown':
      return null
  }
}

interface Claim {
  prefab: SceneCheckPrefab
  byAuthority: Map<SpawnAuthority, string[]>
}

function claimsByPrefab(ctx: SceneCheckContext): Map<string, Claim> {
  const byId = prefabsById(ctx)
  const byAlias = prefabsByAlias(ctx)
  const claims = new Map<string, Claim>()
  const add = (path: string, arg: string, authority: SpawnAuthority): void => {
    const prefab = resolveCallArg(arg, path, ctx, byId, byAlias)
    if (prefab === null) return
    let claim = claims.get(prefab.folder)
    if (claim === undefined) {
      claim = { prefab, byAuthority: new Map() }
      claims.set(prefab.folder, claim)
    }
    const paths = claim.byAuthority.get(authority) ?? []
    if (!paths.includes(path)) paths.push(path)
    claim.byAuthority.set(authority, paths)
  }
  for (const [path, text] of Object.entries(ctx.scripts)) {
    if (!isConsumerScript(path)) continue
    for (const call of spawnerCalls(text)) {
      const authority = authorityOf(call)
      if (authority !== null) add(path, call.arg, authority)
    }
    for (const call of spawnCallsIn(text, path)) {
      if (call.mode !== 'layout') continue
      const arg = layoutArg(call)
      if (arg !== null) add(path, arg, 'layout')
    }
  }
  return claims
}

// One prefab, one pool. Two authorities over it break two ways, and the copy has
// to say which: different POOL MODES make `openPool` throw the second time it is
// asked, and the throw comes out of a script's start(), which stops that script
// dead. A `game.layout` and a Spawner are both seeded, so nothing throws — they
// get one pool between them, and the layout empties it at every round.
// With three claims where only two modes differ, taking the first two by
// position can name a pair that shares a pool and describe it as the pair that
// throws. Report the two that actually disagree.
type AuthorityEntry = [SpawnAuthority, string[]]
function clashingPair(entries: AuthorityEntry[]): [AuthorityEntry, AuthorityEntry] {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (POOL_MODE[entries[i][0]] !== POOL_MODE[entries[j][0]]) return [entries[i], entries[j]]
    }
  }
  return [entries[0], entries[1]]
}

const mixedPoolAuthority: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const claim of claimsByPrefab(ctx).values()) {
    const entries = [...claim.byAuthority.entries()]
    if (entries.length < 2) continue
    const shared = new Set(entries.map(([authority]) => POOL_MODE[authority])).size === 1
    // one pool between them means the pair is layout + seeded; name the layout
    // first, because it is the side that does the emptying
    const [first, second] = shared
      ? [...entries].sort(([a], [b]) => (a === 'layout' ? -1 : b === 'layout' ? 1 : 0))
      : clashingPair(entries)
    const where = (paths: string[]): string => paths.map((path) => baseName(path)).join(' and ')
    out.push({
      id: SPAWNER_CHECK_IDS.mixedPool,
      level: 'blocker',
      title: `${claim.prefab.data.name} is spawned two different ways`,
      detail: shared
        ? `${where(first[1])} lays ${aliasOf(claim.prefab)} out for the round and ${where(second[1])} spawns it as “${AUTHORITY_LABEL[second[0]]}”. They share one set of copies, so every new round clears the ones it made. Give each one its own prefab.`
        : `${where(first[1])} spawns ${aliasOf(claim.prefab)} as “${AUTHORITY_LABEL[first[0]]}” and ${where(second[1])} spawns it as “${AUTHORITY_LABEL[second[0]]}”. A prefab can only be spawned one way in a scene, so whichever starts second stops with an error. Make them agree, or give each one its own prefab.`,
      folder: claim.prefab.folder,
      fix: { label: 'Show prefab', action: 'reveal-prefab' }
    })
  }
  return out
}

// --- 3. spawner-nested-spawn ---

function carriesSpawner(prefab: SceneCheckPrefab): boolean {
  return folderScriptRows(prefab).some((row) => isSpawnerScript(row.path))
}

// A Spawner inside a spawned copy multiplies: every copy carries a live spawner,
// the copies all share one name (only the first answers a request by name), and
// a spawner whose prefab contains itself is an unbounded spiral. Saying so here
// is cheaper than a creator finding out in Play.
const spawnerNestedSpawn: SceneCheck = (ctx) => {
  const byId = prefabsById(ctx)
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const row of allScriptRows(ctx)) {
    if (!isSpawnerScript(row.path)) continue
    for (const param of row.params) {
      if (param.name !== 'spawn') continue
      for (const id of prefabIdsIn(param)) {
        const prefab = byId.get(id)
        if (prefab === undefined || !carriesSpawner(prefab)) continue
        const key = `${prefab.folder}|${row.entityId ?? row.folder ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          id: SPAWNER_CHECK_IDS.nestedSpawn,
          level: 'warning',
          title: `${prefab.data.name} has a Spawner inside it`,
          detail: `Every copy of ${prefab.data.name} brings that Spawner with it — copies making more copies, all sharing one name. Take the Spawner out of ${prefab.data.name} and put one in the scene instead.`,
          entityId: row.entityId,
          folder: prefab.folder,
          fix: { label: 'Show prefab', action: 'reveal-prefab' }
        })
      }
    }
  }
  return out
}

// --- 4. spawner-click-no-collider ---

const CLICK_TRIGGER = 'when clicked'

// The runtime's own rule, mirrored: parented to something, that something is
// the button; on its own, the spawner's disc is (and gets its own collider).
function clickParent(snapshot: PrefabSnapshot, entityId: string): string | null {
  const transform = snapshot[entityId]?.Transform
  const parent = isRecord(transform) ? transform.parent : undefined
  if (typeof parent !== 'number' || parent === 0) return null
  return snapshot[String(parent)] === undefined ? null : String(parent)
}

function maskZero(value: unknown): boolean {
  return value === 0
}

// A click needs a collider to land on. The Spawner colliders its own marker
// when it stands alone, but the thing it sits on is the creator's — and a bare
// mesh, or a GLB whose collision masks are all off, swallows every click with
// no error anywhere.
function clickable(components: Record<string, unknown>): boolean {
  if (components['MeshCollider'] !== undefined) return true
  const gltf = components['GltfContainer']
  if (!isRecord(gltf)) return false
  return !(maskZero(gltf.visibleMeshesCollisionMask) && maskZero(gltf.invisibleMeshesCollisionMask))
}

const spawnerClickTarget: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const row of sceneScriptRows(ctx.snapshot)) {
    if (!isSpawnerScript(row.path) || paramString(row, 'when') !== CLICK_TRIGGER) continue
    const entityId = row.entityId
    if (entityId === undefined) continue
    const target = clickParent(ctx.snapshot, entityId)
    if (target === null) continue
    const components = ctx.snapshot[target]
    if (components === undefined || clickable(components)) continue
    out.push({
      id: SPAWNER_CHECK_IDS.clickTarget,
      level: 'warning',
      title: `${entityLabel(ctx.snapshot, target)} cannot be clicked`,
      detail: `${entityLabel(ctx.snapshot, entityId)} spawns when a player clicks ${entityLabel(ctx.snapshot, target)} — the thing it sits on — but that entity has nothing for a click to land on, so clicks pass straight through it and nothing will ever appear. Give it a collider (a Mesh Collider component, or collision turned on in its model), or move the spawner out on its own to make its disc the button.`,
      entityId,
      fix: { label: 'Select entity', action: 'select-entity' }
    })
  }
  return out
}

// The quietest dead end the Spawner has: every trigger arms, players click and
// walk and wait, and nothing ever appears — the script can only say so in a
// console nobody reads.
const spawnerNothingPicked: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const row of sceneScriptRows(ctx.snapshot)) {
    if (!isSpawnerScript(row.path)) continue
    const entityId = row.entityId
    if (entityId === undefined) continue
    const spawn = row.params.find((p) => p.name === 'spawn')
    const picked = typeof spawn?.value === 'string' && spawn.value.trim() !== ''
    if (picked || spawn === undefined) continue
    out.push({
      id: SPAWNER_CHECK_IDS.nothingPicked,
      level: 'warning',
      title: `${entityLabel(ctx.snapshot, entityId)} has nothing to spawn`,
      detail: `Its "spawn" setting is empty, so its trigger works but nothing ever appears. Pick a prefab in its settings.`,
      entityId,
      fix: { label: 'Select entity', action: 'select-entity' }
    })
  }
  return out
}

// --- 5. spawner-pool-overrun ---

// One pool per prefab, one ceiling on it: every Spawner aimed at a prefab draws
// from the same pool, so what has to fit under its Max alive is the SUM of their
// caps — the Spawner's own `ai.md` states it that way ("counting every other
// spawner aimed at the same prefab"). Past the ceiling `acquire()` returns null
// and the trigger simply does nothing: no error, no card, and a player waiting
// at a spot that has quietly stopped working.
//
// The trigger is a prefab-typed param and a count on the SAME row of the script
// this editor ships, never a param whose name reads like a count. The rule this
// replaces matched any param ending in "table", which is why it fired on
// creator scripts it knew nothing about and blocked Play with copy about waves.
//
// A warning, not a blocker: the game runs, and the copies past the ceiling are
// the only thing missing. Refusing Play over it would cost more than it saves.
const DEFAULT_AT_MOST = 1

function atMostAtOnce(row: ScriptRow): number {
  const param = row.params.find((p) => p.name === 'atMostAtOnce')
  const value = typeof param?.value === 'number' ? Math.floor(param.value) : DEFAULT_AT_MOST
  return value > 0 ? value : DEFAULT_AT_MOST
}

interface Demand {
  prefab: SceneCheckPrefab
  asked: number
  spawners: Array<{ entityId: string; label: string }>
}

const spawnerPoolOverrun: SceneCheck = (ctx) => {
  const byId = prefabsById(ctx)
  const demands = new Map<string, Demand>()
  for (const row of sceneScriptRows(ctx.snapshot)) {
    if (!isSpawnerScript(row.path) || row.entityId === undefined) continue
    const spawn = row.params.find((p) => p.name === 'spawn')
    if (spawn === undefined) continue
    for (const id of prefabIdsIn(spawn)) {
      const prefab = byId.get(id)
      if (prefab === undefined) continue
      const demand = demands.get(prefab.folder) ?? { prefab, asked: 0, spawners: [] }
      demand.asked += atMostAtOnce(row)
      demand.spawners.push({ entityId: row.entityId, label: entityLabel(ctx.snapshot, row.entityId) })
      demands.set(prefab.folder, demand)
    }
  }
  const out: SceneFinding[] = []
  for (const demand of demands.values()) {
    const max = effectiveSpawnable(demand.prefab.data).max
    if (demand.asked <= max) continue
    const alone = demand.spawners.length === 1
    const names = demand.spawners.map((spawner) => spawner.label).join(' and ')
    const gesture = alone
      ? `Lower “At Most At Once” to ${max} in the Script card.`
      : `Lower “At Most At Once” in the Script card until the spawners add up to ${max}.`
    out.push({
      id: SPAWNER_CHECK_IDS.poolOverrun,
      level: 'warning',
      title: `${demand.prefab.data.name} is asked for more copies than can be alive`,
      detail: `${names} ${alone ? 'asks' : 'ask'} for ${demand.asked} copies of ${demand.prefab.data.name}${alone ? '' : ' between them'}, and only ${max} can be alive at once — the ${demand.asked - max} past that never appear. ${gesture}`,
      entityId: alone ? demand.spawners[0].entityId : undefined,
      folder: demand.prefab.folder,
      fix: alone ? { label: 'Select entity', action: 'select-entity' } : { label: 'Show prefab', action: 'reveal-prefab' }
    })
  }
  return out
}

export const SPAWNER_SCENE_CHECKS: ReadonlyArray<readonly [string, SceneCheck]> = [
  [SPAWNER_CHECK_IDS.mixedPool, mixedPoolAuthority],
  [SPAWNER_CHECK_IDS.nestedSpawn, spawnerNestedSpawn],
  [SPAWNER_CHECK_IDS.clickTarget, spawnerClickTarget],
  [SPAWNER_CHECK_IDS.nothingPicked, spawnerNothingPicked],
  [SPAWNER_CHECK_IDS.poolOverrun, spawnerPoolOverrun]
]

/** The five rules, in the order `SPAWNER_CHECK_IDS` declares them. */
export const spawnerChecks: SceneCheck[] = SPAWNER_SCENE_CHECKS.map(([, check]) => check)
