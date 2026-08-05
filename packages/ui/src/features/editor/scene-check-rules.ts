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
import { keepsServerHalf } from '../../prefabs/placement'
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
  editingOnly: 'editing-only-server-half',
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
  if (config === null) return []
  const byId = prefabsById(ctx)
  const out: SceneFinding[] = []
  for (const row of sceneScriptRows(ctx.snapshot)) {
    const table = tableParamOf(row.params)
    if (table === null) continue
    const counts = tableRowsAsNumbers(config, table, 'count')
    if (counts.length === 0) continue
    const waves = tableRowsAsNumbers(config, table, 'wave')
    for (const prefab of referencedPrefabs(row.params, byId)) {
      const max = prefab.data.spawnable?.max
      if (max === undefined) continue
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
        title: 'A wave asks for more clones than the pool allows',
        detail: `Wave ${waves[worst] ?? worst + 1} requests ${counts[worst]} ${aliasOf(prefab)}; pool max is ${max}.`,
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
      out.push({
        id: CHECK_IDS.shadowing,
        level: 'blocker',
        title: `${param.name} is set in two places`,
        detail: `\`${param.name}\` is defined in ${where} — read it through \`${column.accessor}\` instead of a script param, or the two will diverge.`,
        entityId: row.entityId,
        folder: row.folder
      })
    }
  }
  return out
}

// --- 3. stale-anchor ---

const staleAnchor: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const instance of instancesOf(ctx)) {
    if (instance.prefab.data.spawnable === undefined) continue
    const drift = instanceDrift(ctx.snapshot, instance.entityId, instance.prefab.composite, {
      folder: instance.prefab.folder
    })
    if (drift.status !== 'drifted') continue
    out.push({
      id: CHECK_IDS.staleAnchor,
      level: 'play-blocker',
      title: `${instance.prefab.data.name}’s anchor has unsaved changes`,
      detail: 'Anchor differs from prefab; clones spawn from the prefab. Save over or Update first.',
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
        title: `${aliasOf(prefab)} cannot be a server-owned pool`,
        detail: `server-owned spawnables must be a single entity in v1 — ${prefab.data.name} has ${entities}. ${baseName(path)} opens it with mode 'server'.`,
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
          fix: { label: 'Select', action: 'select-entity' }
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
        detail: `Nothing is selected for \`${param.name}\` in ${baseName(row.path)} — pick a spawnable prefab in the inspector, or it spawns nothing.`,
        entityId: row.entityId,
        folder: row.folder,
        fix: row.entityId === undefined ? undefined : { label: 'Select', action: 'select-entity' }
      })
    }
  }
  return out
}

// --- 7. editing-only-server-half ---

// Same predicate the property sheet defaults on, imported rather than restated:
// the sheet decides "keep the anchor in the built scene" and this decides "that
// anchor should not have been ghosted", and they have to be one rule.
function hasServerHalf(prefab: SceneCheckPrefab, ctx: SceneCheckContext): boolean {
  return keepsServerHalf(
    prefab.data,
    folderScriptRows(prefab).map((row) => ctx.scripts[row.path] ?? '')
  )
}

const editingOnlyServerHalf: SceneCheck = (ctx) => {
  const out: SceneFinding[] = []
  for (const instance of instancesOf(ctx)) {
    if (ctx.snapshot[instance.entityId]?.[INERT_COMPONENT] === undefined) continue
    if (!hasServerHalf(instance.prefab, ctx)) continue
    out.push({
      id: CHECK_IDS.editingOnly,
      level: 'blocker',
      title: `${instance.prefab.data.name} is placed “Editing only”`,
      detail:
        'Editing only keeps this instance out of the built scene, so its server half never runs — the validators behind isServer() live on the placed anchor, not on the clones. Set Placement to “Editor & Play” to keep both.',
      entityId: instance.entityId,
      folder: instance.prefab.folder,
      fix: { label: 'Select', action: 'select-entity' }
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
    if (prefab.data.spawnable === undefined) continue
    const found = prefab.composite.components.find((c) => SINGLE_OWNER_COMPONENTS.includes(c.name))
    if (found === undefined) continue
    out.push({
      id: CHECK_IDS.triggerArea,
      level: 'warning',
      title: `Clones of ${prefab.data.name} share one ${found.name.split('::').pop() ?? found.name}`,
      detail:
        'Trigger areas are single-owner slots the pool runner cannot reproduce per clone — do the overlap check in the clone’s own script instead.',
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
  [CHECK_IDS.editingOnly, editingOnlyServerHalf],
  [CHECK_IDS.triggerArea, spawnableTriggerArea]
]
