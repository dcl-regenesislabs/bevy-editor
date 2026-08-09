// The Spawner's own scene checks. Kept out of scene-check-rules.ts, which is
// already close to the file-length gate — everything else about them (the
// context shape, the copy discipline, the registry) is identical.
//
// All three are pure functions of the context, like every other rule.
import { baseName } from '../../script/project-files'
import { isRecord, type PrefabSnapshot } from '../../prefabs/format'
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
  nothingPicked: 'spawner-nothing-picked'
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

type SpawnAuthority = 'server' | 'planned' | 'seeded' | 'perPlayer'

// The words the Prefabs tab already uses for each authority. A rule that invented
// its own names for them would describe a scene the creator cannot find.
const AUTHORITY_LABEL: Record<SpawnAuthority, string> = {
  server: 'Server-owned',
  planned: 'Planned spawns',
  seeded: 'Spawned per player',
  perPlayer: 'One per player'
}

function authorityOf(call: SpawnerCall): SpawnAuthority | null {
  if (call.fn === 'plan') return 'planned'
  if (call.fn === 'perPlayer') return 'perPlayer'
  if (call.mode === 'server' || call.mode === 'seeded') return call.mode
  return null
}

interface Claim {
  prefab: SceneCheckPrefab
  byAuthority: Map<SpawnAuthority, string[]>
}

function claimsByPrefab(ctx: SceneCheckContext): Map<string, Claim> {
  const byId = prefabsById(ctx)
  const byAlias = prefabsByAlias(ctx)
  const claims = new Map<string, Claim>()
  for (const [path, text] of Object.entries(ctx.scripts)) {
    if (!isConsumerScript(path)) continue
    for (const call of spawnerCalls(text)) {
      const authority = authorityOf(call)
      if (authority === null) continue
      const prefab = resolveCallArg(call.arg, path, ctx, byId, byAlias)
      if (prefab === null) continue
      let claim = claims.get(prefab.folder)
      if (claim === undefined) {
        claim = { prefab, byAuthority: new Map() }
        claims.set(prefab.folder, claim)
      }
      const paths = claim.byAuthority.get(authority) ?? []
      if (!paths.includes(path)) paths.push(path)
      claim.byAuthority.set(authority, paths)
    }
  }
  return claims
}

// One prefab, one authority — `openPool` throws the second time it is asked for
// the same prefab a different way, and the throw comes out of a script's start(),
// which stops that script dead. Two Spawners aimed at the same prefab a
// different way is the reachable case.
const mixedPoolAuthority: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const claim of claimsByPrefab(ctx).values()) {
    const entries = [...claim.byAuthority.entries()]
    if (entries.length < 2) continue
    const [first, second] = entries
    const where = (paths: string[]): string => paths.map((path) => baseName(path)).join(' and ')
    out.push({
      id: SPAWNER_CHECK_IDS.mixedPool,
      level: 'blocker',
      title: `${claim.prefab.data.name} is spawned two different ways`,
      detail: `${where(first[1])} spawns ${aliasOf(claim.prefab)} as “${AUTHORITY_LABEL[first[0]]}” and ${where(second[1])} spawns it as “${AUTHORITY_LABEL[second[0]]}”. A prefab can only be spawned one way in a scene, so whichever starts second stops with an error. Make them agree, or give each one its own prefab.`,
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

export const SPAWNER_SCENE_CHECKS: ReadonlyArray<readonly [string, SceneCheck]> = [
  [SPAWNER_CHECK_IDS.mixedPool, mixedPoolAuthority],
  [SPAWNER_CHECK_IDS.nestedSpawn, spawnerNestedSpawn],
  [SPAWNER_CHECK_IDS.clickTarget, spawnerClickTarget],
  [SPAWNER_CHECK_IDS.nothingPicked, spawnerNothingPicked]
]



/** The four rules, in the order `SPAWNER_CHECK_IDS` declares them. */
export const spawnerChecks: SceneCheck[] = SPAWNER_SCENE_CHECKS.map(([, check]) => check)
