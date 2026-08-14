// The rules the scene-check registry ships with. Each is a pure function of the
// context: same project state in, same findings out, no data layer, no engine.
// How a project is read is scene-check-model.ts's job; this file is the rules
// and their copy.
//
// The user-facing sentences are the spec's verbatim lint copy — they are the
// contract with the creator, not prose to be reworded in passing.
import { INERT_COMPONENT, SCRIPT_COMPONENT } from '../../prefabs/format'
import { gameConfigColumns, type ConfigColumn, type GameConfigValue } from '../../gameconfig/normalize'
import { CREATE_SPAWNABLE_GESTURE } from '../../prefabs/copy'
import { keepsServerHalf } from '../../prefabs/placement'
import { effectiveSpawnable } from '../../prefabs/spawnable'
import { importSpecifiers } from '../../prefabs/vendoring'
import { baseName } from '../../script/project-files'
import { GAME_CHECK_IDS, GAME_SCENE_CHECKS } from './scene-check-game'
import { SIDES_CHECK_IDS, SIDES_SCENE_CHECKS } from './scene-check-sides'
import { SPAWNER_CHECK_IDS, SPAWNER_SCENE_CHECKS } from './scene-check-spawner'
import {
  aliasOf,
  allScriptRows,
  childrenIndex,
  entityCount,
  folderScriptRows,
  instancesOf,
  PREFAB_PARAM_TYPES,
  prefabIdsIn,
  prefabsByAlias,
  prefabsById,
  referencedPrefabs,
  resolveCallArg,
  rowsFrom,
  spawnerCalls,
  subtreeOf
} from './scene-check-model'
import type { SceneCheck, SceneCheckContext, SceneCheckPrefab, SceneFinding } from './scene-checks'

export const CHECK_IDS = {
  shadowing: 'config-shadowing',
  serverPool: 'server-pool-multi-entity',
  bespokeScript: 'bespoke-script-on-kit-instance',
  emptyRef: 'empty-prefab-ref',
  unspawnableRef: 'unspawnable-prefab-ref',
  spawnedOnlyServer: 'spawned-only-server-half',
  triggerArea: 'spawnable-trigger-area',
  prefabRuntimeImport: 'prefab-runtime-import',
  // the Spawner's five, implemented in scene-check-spawner.ts
  mixedPool: SPAWNER_CHECK_IDS.mixedPool,
  nestedSpawn: SPAWNER_CHECK_IDS.nestedSpawn,
  clickTarget: SPAWNER_CHECK_IDS.clickTarget,
  nothingPicked: SPAWNER_CHECK_IDS.nothingPicked,
  poolOverrun: SPAWNER_CHECK_IDS.poolOverrun,
  // the game's three hints, implemented in scene-check-game.ts
  zoneName: GAME_CHECK_IDS.zoneName,
  unanswered: GAME_CHECK_IDS.unanswered,
  endlessRound: GAME_CHECK_IDS.endlessRound,
  // the sides model's two, implemented in scene-check-sides.ts
  moduleScopeServer: SIDES_CHECK_IDS.moduleScopeServer,
  clientOnlyOnServer: SIDES_CHECK_IDS.clientOnlyOnServer
} as const

// --- 1. config-shadowing ---

// A value lives in exactly one place. Wiring params (an entity, an action, a
// prefab reference) are never tunables, so they can share a name with a column
// harmlessly.
const WIRING_PARAM_TYPES = ['entity', 'action', ...PREFAB_PARAM_TYPES]

function shadowedColumns(config: GameConfigValue): Map<string, ConfigColumn> {
  const columns = new Map<string, ConfigColumn>()
  for (const column of gameConfigColumns(config)) {
    if (column.column === '' || columns.has(column.column)) continue
    columns.set(column.column, column)
  }
  return columns
}

const configShadowing: SceneCheck = (ctx) => {
  const config = ctx.gameConfig
  if (config === null) return []
  const columns = shadowedColumns(config)
  if (columns.size === 0) return []
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const row of allScriptRows(ctx)) {
    for (const param of row.params) {
      if (WIRING_PARAM_TYPES.includes(param.type)) continue
      const column = columns.get(param.name)
      if (column === undefined) continue
      const key = `${row.path}|${param.name}`
      if (seen.has(key)) continue
      seen.add(key)
      const where = column.table === '' ? 'Game Config' : `Game Config › ${column.table}`
      // The rule matches on the param's NAME, so emptying its value silences
      // nothing — name both remedies the creator can actually perform, and the
      // rename first, because a param inside a prefab folder is not theirs to
      // delete.
      out.push({
        id: CHECK_IDS.shadowing,
        level: 'blocker',
        title: `${param.name} is set in two places`,
        detail: `\`${param.name}\` is also set in ${where}. Rename the ${where} row, or remove the \`${param.name}\` param from ${baseName(row.path)} and read the value through \`${column.accessor}\` — otherwise the two copies drift apart and the game uses whichever it reaches first.`,
        entityId: row.entityId,
        folder: row.folder,
        fix:
          row.entityId === undefined
            ? row.folder === undefined
              ? undefined
              : { label: 'Show prefab', action: 'reveal-prefab' }
            : { label: 'Select entity', action: 'select-entity' }
      })
    }
  }
  return out
}

// Which prefabs something actually spawns — a script names them, or a
// per-player prefab spawns itself. The clone-hazard rules only fire on these:
// a placed copy nothing spawns can never disagree with its spawned twins.
function spawnedPrefabIds(ctx: SceneCheckContext): Set<string> {
  const byId = prefabsById(ctx)
  const ids = new Set<string>()
  for (const row of allScriptRows(ctx)) {
    for (const prefab of referencedPrefabs(row.params, byId)) ids.add(prefab.data.id)
  }
  // a per-player prefab is spawned without anything naming it: the generated
  // registry opens that pool itself
  for (const prefab of ctx.prefabs) {
    if (effectiveSpawnable(prefab.data).instancing === 'perPlayer') ids.add(prefab.data.id)
  }
  return ids
}

// There is deliberately no rule about a placed copy differing from its prefab:
// that is normal authoring, never surfaced automatically. The right-click verbs
// (Save over prefab / Update from prefab) are how a creator reconciles the two.

// --- 2. server-pool-multi-entity ---

const serverPoolMultiEntity: SceneCheck = (ctx) => {
  const byId = prefabsById(ctx)
  const byAlias = prefabsByAlias(ctx)
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const [path, text] of Object.entries(ctx.scripts)) {
    for (const call of spawnerCalls(text)) {
      if (call.fn !== 'pool' || call.mode !== 'server') continue
      const prefab = resolveCallArg(call.arg, path, ctx, byId, byAlias)
      if (prefab === null) continue
      const entities = entityCount(prefab)
      if (entities <= 1) continue
      const key = `${path}|${prefab.folder}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: CHECK_IDS.serverPool,
        level: 'blocker',
        title: `${aliasOf(prefab)} cannot be server-owned`,
        detail: `${baseName(path)} spawns it with mode 'server', and the server can only own a prefab made of one entity — ${prefab.data.name} has ${entities}. Flatten it to a single entity, or spawn it with 'planned' or 'seeded' instead.`,
        folder: prefab.folder,
        fix: { label: 'Show prefab', action: 'reveal-prefab' }
      })
    }
  }
  return out
}

// --- 3. bespoke-script-on-kit-instance ---

const bespokeScriptOnInstance: SceneCheck = (ctx) => {
  const instances = instancesOf(ctx)
  if (instances.length === 0) return []
  const children = childrenIndex(ctx.snapshot)
  const roots = new Set(instances.map((instance) => instance.entityId))
  const out: SceneFinding[] = []
  for (const instance of instances) {
    const owned = new Set(folderScriptRows(instance.prefab).map((row) => row.path))
    const stopAt = new Set([...roots].filter((id) => id !== instance.entityId))
    for (const entityId of subtreeOf(children, instance.entityId, stopAt)) {
      // extra scripts on the ROOT survive Update from prefab (the zone card
      // attaches reaction scripts there on purpose); only a child's are lost
      if (entityId === instance.entityId) continue
      for (const row of rowsFrom(ctx.snapshot[entityId]?.[SCRIPT_COMPONENT])) {
        if (owned.has(row.path)) continue
        out.push({
          id: CHECK_IDS.bespokeScript,
          level: 'warning',
          title: `${baseName(row.path)} is not part of ${instance.prefab.data.name}`,
          detail:
            'This script is not part of the prefab — Update from prefab will remove it. Attach it to a plain entity, or Save over prefab to adopt it.',
          entityId,
          folder: instance.prefab.folder,
          fix: { label: 'Select entity', action: 'select-entity' }
        })
      }
    }
  }
  return out
}

// --- 4. empty-prefab-ref ---

const emptyPrefabRef: SceneCheck = (ctx) => {
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const row of allScriptRows(ctx)) {
    for (const param of row.params) {
      if (!PREFAB_PARAM_TYPES.includes(param.type)) continue
      if (prefabIdsIn(param).length > 0) continue
      const key = `${row.path}|${param.name}|${row.entityId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: CHECK_IDS.emptyRef,
        level: 'warning',
        title: `${param.name} has no ${param.type === 'prefabList' ? 'prefabs' : 'prefab'} picked`,
        detail: `Nothing is picked for \`${param.name}\` in ${baseName(row.path)} — choose a spawnable prefab in the inspector. If you have none yet, ${CREATE_SPAWNABLE_GESTURE}.`,
        entityId: row.entityId,
        folder: row.folder,
        fix: row.entityId === undefined ? undefined : { label: 'Select entity', action: 'select-entity' }
      })
    }
  }
  return out
}

// --- 4b. unspawnable-prefab-ref ---

// Every prefab is spawnable — picking one in a dropdown is what ships it — so
// the only broken reference left is one pointing at a prefab the project no
// longer has (deleted folder, imported scene). That one still kills the
// script's openPool out of start(), so it stays a blocker.
const unspawnablePrefabRef: SceneCheck = (ctx) => {
  const byId = prefabsById(ctx)
  const seen = new Set<string>()
  const out: SceneFinding[] = []
  for (const row of allScriptRows(ctx)) {
    for (const param of row.params) {
      if (!PREFAB_PARAM_TYPES.includes(param.type)) continue
      for (const id of prefabIdsIn(param)) {
        if (byId.has(id)) continue
        const key = `${row.path}|${param.name}|${id}|${row.entityId ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          id: CHECK_IDS.unspawnableRef,
          level: 'blocker',
          title: `${param.name} points at a prefab this project no longer has`,
          detail: `\`${param.name}\` in ${baseName(row.path)} still points at a prefab that is not in this project. Pick another prefab in the inspector.`,
          entityId: row.entityId,
          folder: row.folder,
          fix: row.entityId === undefined ? undefined : { label: 'Select entity', action: 'select-entity' }
        })
      }
    }
  }
  return out
}

// --- 5. spawned-only-server-half ---

function hasServerHalf(prefab: SceneCheckPrefab, ctx: SceneCheckContext): boolean {
  return keepsServerHalf(
    prefab.data,
    folderScriptRows(prefab).map((row) => ctx.scripts[row.path] ?? '')
  )
}

// "When spawned" leaves the entity out of the built scene, so the half of its
// script that runs on the Multiplayer Server never runs at all: that half only
// ever executes on a placed copy, never on the copies your game spawns. This is
// the unkillable-zombie failure — the validators are simply absent.
const spawnedOnlyServerHalf: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const instance of instancesOf(ctx)) {
    if (ctx.snapshot[instance.entityId]?.[INERT_COMPONENT] === undefined) continue
    if (!hasServerHalf(instance.prefab, ctx)) continue
    out.push({
      id: CHECK_IDS.spawnedOnlyServer,
      level: 'blocker',
      title: `${instance.prefab.data.name} runs on the Multiplayer Server, so it cannot be spawn-only`,
      detail: `This copy is in “When spawned”, so the built game leaves it out — and the half of its script that runs on the Multiplayer Server goes with it. That half only ever runs on a copy that is in the scene, never on the ones your game spawns. Right-click it and pick “Show from the start”.`,
      entityId: instance.entityId,
      folder: instance.prefab.folder,
      fix: { label: 'Select entity', action: 'select-entity' }
    })
  }
  return out
}

// --- 6. spawnable-trigger-area ---

// Components the clone runner cannot reproduce per clone: the engine routes
// their events to one owner, so every clone but the first is silently inert.
const SINGLE_OWNER_COMPONENTS = ['core::TriggerArea', 'asset-packs::Triggers']

// Every prefab CAN be spawned, so carrying a trigger area is only a problem
// once something actually spawns it — a placed zone minding its own business
// must not open with a warning about copies nothing makes.
const spawnableTriggerArea: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  const spawned = spawnedPrefabIds(ctx)
  for (const prefab of ctx.prefabs) {
    if (!spawned.has(prefab.data.id)) continue
    if (!prefab.composite.components.some((c) => SINGLE_OWNER_COMPONENTS.includes(c.name))) continue
    out.push({
      id: CHECK_IDS.triggerArea,
      level: 'warning',
      title: `Copies of ${prefab.data.name} share one trigger area`,
      detail:
        'Only one copy can own a trigger area, so every copy after the first never fires. Check the overlap in the copy’s own script instead.',
      folder: prefab.folder,
      fix: { label: 'Show prefab', action: 'reveal-prefab' }
    })
  }
  return out
}

// --- 7. prefab-runtime-import ---

// A prefab folder is machine-owned: every update rewrites it, and one built
// before the runtime modules moved to a single shared copy loses the
// `scripts/runtime/` it used to carry. A script of the creator's that reached
// into that folder for a module therefore stops resolving the moment they
// accept the update — with nothing tying the two together, which is what this
// rule is for. The folder's own scripts are not the case: those the update
// re-points itself.
//
// A warning, not a blocker, because the same import still resolves in the moment
// BEFORE that update lands: refusing Play on a scene that runs would be the rule
// doing more harm than the thing it warns about. Once the update does land, the
// build failure speaks for itself and this is what names the one-line edit.
const PREFAB_RUNTIME_IMPORT = /(?:^|\/)custom\/[^/]+\/scripts\/runtime\/(.+)$/
const SHARED_RUNTIME_DIR = ['src', 'scripts', 'runtime']

// The same module, named from `fromDir` — `src/scripts` says './runtime/zoneBus'
// and a script inside a folder climbs out to the same file.
function sharedRuntimeSpecifier(fromDir: string, module: string): string {
  const from = fromDir.split('/').filter((seg) => seg !== '')
  const to = [...SHARED_RUNTIME_DIR]
  let same = 0
  while (same < from.length && same < to.length && from[same] === to[same]) same++
  const up = from.length - same
  const parts = [...Array<string>(up).fill('..'), ...to.slice(same), module]
  return `${up === 0 ? './' : ''}${parts.join('/')}`
}

const prefabRuntimeImport: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const [path, text] of Object.entries(ctx.scripts)) {
    if (path.startsWith('custom/')) continue
    const dir = path.slice(0, path.lastIndexOf('/') + 1)
    const seen = new Set<string>()
    for (const spec of importSpecifiers(text)) {
      const found = PREFAB_RUNTIME_IMPORT.exec(spec)
      if (found === null || seen.has(spec)) continue
      seen.add(spec)
      out.push({
        id: CHECK_IDS.prefabRuntimeImport,
        level: 'warning',
        title: `${baseName(path)} imports a runtime module out of a prefab folder`,
        detail: `A prefab folder holds no runtime modules — the scene keeps one copy of them, so change \`${spec}\` in ${baseName(path)} to \`${sharedRuntimeSpecifier(dir, found[1])}\`.`
      })
    }
  }
  return out
}

export const BUILTIN_SCENE_CHECKS: ReadonlyArray<readonly [string, SceneCheck]> = [
  [CHECK_IDS.shadowing, configShadowing],
  [CHECK_IDS.serverPool, serverPoolMultiEntity],
  [CHECK_IDS.bespokeScript, bespokeScriptOnInstance],
  [CHECK_IDS.emptyRef, emptyPrefabRef],
  [CHECK_IDS.unspawnableRef, unspawnablePrefabRef],
  [CHECK_IDS.triggerArea, spawnableTriggerArea],
  [CHECK_IDS.prefabRuntimeImport, prefabRuntimeImport],
  ...SPAWNER_SCENE_CHECKS,
  ...GAME_SCENE_CHECKS,
  ...SIDES_SCENE_CHECKS
]
