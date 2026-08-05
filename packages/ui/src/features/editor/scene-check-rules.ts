// The rules the scene-check registry ships with. Each is a pure function of the
// context: same project state in, same findings out, no data layer, no engine.
// How a project is read is scene-check-model.ts's job; this file is the rules
// and their copy.
//
// The user-facing sentences are the spec's verbatim lint copy — they are the
// contract with the creator, not prose to be reworded in passing.
import { instanceDrift } from '../../prefabs/drift'
import { INERT_COMPONENT, SCRIPT_COMPONENT } from '../../prefabs/format'
import { gameConfigColumns, tableRowsAsNumbers, type ConfigColumn, type GameConfigValue } from '../../gameconfig/normalize'
import { CREATE_SPAWNABLE_GESTURE } from '../../prefabs/copy'
import { keepsServerHalf } from '../../prefabs/placement'
import { effectiveSpawnable } from '../../prefabs/spawnable'
import { baseName } from '../../script/project-files'
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
  sceneScriptRows,
  spawnerCalls,
  subtreeOf,
  type LayoutParam
} from './scene-check-model'
import type { SceneCheck, SceneCheckContext, SceneCheckPrefab, SceneFinding } from './scene-checks'

export const CHECK_IDS = {
  waveCount: 'wave-count-vs-pool-max',
  shadowing: 'config-shadowing',
  staleAnchor: 'stale-anchor',
  serverPool: 'server-pool-multi-entity',
  bespokeScript: 'bespoke-script-on-kit-instance',
  emptyRef: 'empty-prefab-ref',
  unspawnableRef: 'unspawnable-prefab-ref',
  spawnedOnlyServer: 'spawned-only-server-half',
  triggerArea: 'spawnable-trigger-area'
} as const

// --- 1. wave-count-vs-pool-max ---

// The Wave Director names its table in a `wavesTable` param; any script that
// reads a table of counts the same way is linted the same way.
const TABLE_PARAM = /table$/i
const DEFAULT_WAVES_TABLE = 'waves'

function tableParamOf(params: LayoutParam[]): string | null {
  for (const param of params) {
    if (!TABLE_PARAM.test(param.name) || typeof param.value !== 'string') continue
    const name = param.value.trim()
    return name === '' ? DEFAULT_WAVES_TABLE : name
  }
  return null
}

const waveCountVsPoolMax: SceneCheck = (ctx) => {
  const config = ctx.gameConfig
  const byId = prefabsById(ctx)
  const out: SceneFinding[] = []
  for (const row of sceneScriptRows(ctx.snapshot)) {
    const table = tableParamOf(row.params)
    if (table === null) continue
    const counts = config === null ? [] : tableRowsAsNumbers(config, table, 'count')
    // No table to read means the script falls back to its own built-in curve,
    // which nothing here can see — say so rather than passing in silence, since
    // the guarantee the guides advertise is "the editor blocks Play when a wave
    // asks for more than the pool holds".
    if (counts.length === 0) {
      for (const prefab of referencedPrefabs(row.params, byId)) {
        const max = effectiveSpawnable(prefab.data).max
        out.push({
          id: CHECK_IDS.waveCount,
          level: 'warning',
          title: 'Nothing checks how many copies a wave asks for',
          detail: `${baseName(row.path)} reads its waves from Game Config › ${table}, and this scene has no such table — it runs its own built-in curve instead, which can ask for more than ${prefab.data.name}’s Max alive of ${max}. Add a \`${table}\` table with a \`count\` column, or raise Max alive.`,
          entityId: row.entityId,
          folder: prefab.folder,
          fix: { label: 'Show prefab', action: 'reveal-prefab' }
        })
      }
      continue
    }
    const waves = config === null ? [] : tableRowsAsNumbers(config, table, 'wave')
    for (const prefab of referencedPrefabs(row.params, byId)) {
      const max = effectiveSpawnable(prefab.data).max
      // one finding per prefab, naming the row that overruns by the most: the
      // fix is the same number either way, and a card listing eight waves says
      // nothing the worst one doesn't
      let worst = -1
      counts.forEach((count, i) => {
        if (count > max && (worst === -1 || count > counts[worst])) worst = i
      })
      if (worst === -1) continue
      out.push({
        id: CHECK_IDS.waveCount,
        level: 'blocker',
        title: 'A wave spawns more copies than the prefab allows',
        detail: `Wave ${waves[worst] ?? worst + 1} spawns ${counts[worst]} ${aliasOf(prefab)}, and ${prefab.data.name} allows ${max} alive at once. Lower the count in Game Config › ${table}.`,
        entityId: row.entityId,
        folder: prefab.folder,
        fix: { label: 'Show prefab', action: 'reveal-prefab' }
      })
    }
  }
  return out
}

// --- 2. config-shadowing ---

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

// --- 3. stale-anchor ---

// Only worth saying when something actually spawns the prefab: that is when the
// placed copy and the spawned ones can disagree. A creator who customises one
// placed copy of a bench nobody spawns has done nothing wrong, and the old gate
// (the prefab carrying spawn settings) stopped meaning anything once every
// prefab became spawnable.
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

const staleAnchor: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  const spawned = spawnedPrefabIds(ctx)
  for (const instance of instancesOf(ctx)) {
    if (!spawned.has(instance.prefab.data.id)) continue
    const drift = instanceDrift(ctx.snapshot, instance.entityId, instance.prefab.composite, {
      folder: instance.prefab.folder
    })
    if (drift.status !== 'drifted') continue
    out.push({
      id: CHECK_IDS.staleAnchor,
      level: 'play-blocker',
      title: `${instance.prefab.data.name}’s placed copy has unsaved changes`,
      detail:
        'The copies your game makes always come from the prefab, so this edit never reaches them. Compare the two, then save your changes into the prefab or take the prefab’s version back.',
      entityId: instance.entityId,
      folder: instance.prefab.folder,
      fix: { label: 'Compare…', action: 'open-drift' }
    })
  }
  return out
}

// --- 4. server-pool-multi-entity ---

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

// --- 5. bespoke-script-on-kit-instance ---

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

// --- 6. empty-prefab-ref ---

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

// --- 6b. unspawnable-prefab-ref ---

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

// --- 7. spawned-only-server-half ---

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

// --- 8. spawnable-trigger-area ---

// Components the clone runner cannot reproduce per clone: the engine routes
// their events to one owner, so every clone but the first is silently inert.
const SINGLE_OWNER_COMPONENTS = ['core::TriggerArea', 'asset-packs::Triggers']

const spawnableTriggerArea: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const prefab of ctx.prefabs) {
    const found = prefab.composite.components.find((c) => SINGLE_OWNER_COMPONENTS.includes(c.name))
    if (found === undefined) continue
    out.push({
      id: CHECK_IDS.triggerArea,
      level: 'warning',
      title: `Copies of ${prefab.data.name} share one ${found.name.split('::').pop() ?? found.name}`,
      detail:
        'Only one copy can own a trigger area, so every copy after the first never fires. Check the overlap in the copy’s own script instead.',
      folder: prefab.folder,
      fix: { label: 'Show prefab', action: 'reveal-prefab' }
    })
  }
  return out
}

export const BUILTIN_SCENE_CHECKS: ReadonlyArray<readonly [string, SceneCheck]> = [
  [CHECK_IDS.waveCount, waveCountVsPoolMax],
  [CHECK_IDS.shadowing, configShadowing],
  [CHECK_IDS.staleAnchor, staleAnchor],
  [CHECK_IDS.serverPool, serverPoolMultiEntity],
  [CHECK_IDS.bespokeScript, bespokeScriptOnInstance],
  [CHECK_IDS.emptyRef, emptyPrefabRef],
  [CHECK_IDS.unspawnableRef, unspawnablePrefabRef],
  [CHECK_IDS.triggerArea, spawnableTriggerArea]
]
