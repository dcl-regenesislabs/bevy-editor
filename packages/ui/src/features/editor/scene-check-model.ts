// What the scene-check rules read a project as: script rows and their params,
// prefab instances and their subtrees, and the spawner calls a script text
// makes. Pure, shared by every rule so none of them re-derives the shape.
//
// Prefab references are resolved BY ID everywhere here. A param counts as a
// reference when its value names a prefab the project holds, which is true both
// of today's string-valued params and of the `{type:'prefab'}` params the script
// parser is gaining — an unresolvable value simply resolves to nothing.
import { prefabAssetId } from '../../prefabs/provenance'
import { aliasFor } from '../../prefabs/spawnable'
import {
  SCRIPT_COMPONENT,
  TRANSFORM_COMPONENT,
  isRecord,
  prefabLayout,
  substituteAssetPath,
  type PrefabSnapshot
} from '../../prefabs/format'
import type { SceneCheckContext, SceneCheckPrefab } from './scene-checks'

export interface LayoutParam {
  name: string
  /** the param type as the layout records it; 'prefab' once the parser emits it */
  type: string
  value: unknown
}

export interface ScriptRow {
  path: string
  priority: number
  params: LayoutParam[]
  /** set for a row on a scene entity */
  entityId?: string
  /** set for a row inside a prefab folder's composite */
  folder?: string
}

function parseParams(layout: unknown): LayoutParam[] {
  if (typeof layout !== 'string' || layout === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(layout)
  } catch {
    return []
  }
  const params = isRecord(parsed) ? parsed.params : undefined
  if (!isRecord(params)) return []
  const out: LayoutParam[] = []
  for (const [name, raw] of Object.entries(params)) {
    if (!isRecord(raw)) continue
    out.push({ name, type: typeof raw.type === 'string' ? raw.type : '', value: raw.value })
  }
  return out
}

export function rowsFrom(json: unknown): ScriptRow[] {
  const list = isRecord(json) ? json.value : undefined
  if (!Array.isArray(list)) return []
  const rows: ScriptRow[] = []
  for (const item of list) {
    if (!isRecord(item) || typeof item.path !== 'string') continue
    rows.push({
      path: item.path,
      priority: typeof item.priority === 'number' ? item.priority : 0,
      params: parseParams(item.layout)
    })
  }
  return rows
}

export function sceneScriptRows(snapshot: PrefabSnapshot): ScriptRow[] {
  const out: ScriptRow[] = []
  for (const [entityId, components] of Object.entries(snapshot)) {
    for (const row of rowsFrom(components[SCRIPT_COMPONENT])) out.push({ ...row, entityId })
  }
  return out
}

// A folder's own rows, with `{assetPath}` resolved the way placement resolves it,
// so a path compares equal to the same script on a placed instance.
export function folderScriptRows(prefab: SceneCheckPrefab): ScriptRow[] {
  const out: ScriptRow[] = []
  for (const component of prefab.composite.components) {
    if (component.name !== SCRIPT_COMPONENT) continue
    for (const entry of Object.values(component.data)) {
      for (const row of rowsFrom(entry.json)) {
        const holder = { path: row.path }
        substituteAssetPath(holder, prefab.folder)
        out.push({ ...row, path: holder.path, folder: prefab.folder })
      }
    }
  }
  return out
}

export function allScriptRows(ctx: SceneCheckContext): ScriptRow[] {
  const out = sceneScriptRows(ctx.snapshot)
  for (const prefab of ctx.prefabs) out.push(...folderScriptRows(prefab))
  return out
}

// --- prefabs and their instances ---

export function prefabsById(ctx: SceneCheckContext): Map<string, SceneCheckPrefab> {
  const byId = new Map<string, SceneCheckPrefab>()
  for (const prefab of ctx.prefabs) if (!byId.has(prefab.data.id)) byId.set(prefab.data.id, prefab)
  return byId
}

export function prefabsByAlias(ctx: SceneCheckContext): Map<string, SceneCheckPrefab> {
  const byAlias = new Map<string, SceneCheckPrefab>()
  for (const prefab of ctx.prefabs) {
    const alias = aliasFor(prefab.data.name)
    if (!byAlias.has(alias)) byAlias.set(alias, prefab)
  }
  return byAlias
}

export interface Instance {
  entityId: string
  prefab: SceneCheckPrefab
}

export function instancesOf(ctx: SceneCheckContext): Instance[] {
  const byId = prefabsById(ctx)
  const out: Instance[] = []
  for (const [entityId, components] of Object.entries(ctx.snapshot)) {
    const assetId = prefabAssetId(components)
    if (assetId === null) continue
    const prefab = byId.get(assetId)
    if (prefab !== undefined) out.push({ entityId, prefab })
  }
  return out
}

export function childrenIndex(snapshot: PrefabSnapshot): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const [entityId, components] of Object.entries(snapshot)) {
    const transform = components[TRANSFORM_COMPONENT]
    const parent = isRecord(transform) && typeof transform.parent === 'number' ? String(transform.parent) : '0'
    if (parent === entityId) continue
    const list = children.get(parent)
    if (list === undefined) children.set(parent, [entityId])
    else list.push(entityId)
  }
  return children
}

// The instance's own entities. A nested instance root belongs to ITS prefab, so
// the walk stops there rather than blaming the outer prefab for its scripts.
export function subtreeOf(children: Map<string, string[]>, root: string, stopAt: Set<string>): string[] {
  const out: string[] = [root]
  const queue = [root]
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const child of children.get(id) ?? []) {
      if (stopAt.has(child) || out.includes(child)) continue
      out.push(child)
      queue.push(child)
    }
  }
  return out
}

// What the script parser tags a `PrefabRef` / `PrefabRef[]` annotation with.
export const PREFAB_PARAM_TYPES = ['prefab', 'prefabList']

export function prefabIdsIn(param: LayoutParam): string[] {
  const value: unknown = param.value
  if (typeof value === 'string') return value === '' ? [] : [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item !== '')
  return []
}

// `entity` and `action` params carry ids of a different kind — never a prefab.
export function referencedPrefabs(
  params: LayoutParam[],
  byId: Map<string, SceneCheckPrefab>
): SceneCheckPrefab[] {
  const out: SceneCheckPrefab[] = []
  for (const param of params) {
    if (param.type === 'entity' || param.type === 'action') continue
    for (const id of prefabIdsIn(param)) {
      const prefab = byId.get(id)
      if (prefab !== undefined && !out.includes(prefab)) out.push(prefab)
    }
  }
  return out
}

/** the generated registry's name for a prefab — what a consumer script types */
export function aliasOf(prefab: SceneCheckPrefab): string {
  return aliasFor(prefab.data.name)
}

export function entityCount(prefab: SceneCheckPrefab): number {
  return prefabLayout(prefab.composite).entities.length
}

// --- spawner calls in a script's text ---

export type SpawnerFn = 'pool' | 'plan' | 'perPlayer'

export interface SpawnerCall {
  fn: SpawnerFn
  /** the first argument's source text, e.g. `this.zombie` */
  arg: string
  /** the explicit mode argument; only `pool` takes one */
  mode: string | null
}

const SPAWNER_FNS: SpawnerFn[] = ['pool', 'plan', 'perPlayer']
const IMPORT = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g
const NAMESPACE = /\*\s+as\s+(\w+)/
const BRACED = /\{([^}]*)\}/
const SPECIFIER = /^\s*(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?\s*$/
const SPAWNER_MODULE = /(^|\/)spawner(\.ts)?$/

function collectCalls(text: string, callee: string, fn: SpawnerFn, out: SpawnerCall[]): void {
  const re = new RegExp(`(?<![\\w.])${callee}\\s*\\(\\s*([^,()]+?)\\s*(?:,\\s*(['"])(\\w+)\\2)?\\s*[,)]`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    out.push({ fn, arg: match[1].trim(), mode: match[3] ?? null })
  }
}

/**
 * Every `pool` / `plan` / `perPlayer` call in a script, resolved through the
 * local names its `runtime/spawner` import bound — the kit scripts alias them
 * (`import { pool as openPool }`), so matching `spawner.pool(` alone would see
 * nothing at all.
 */
export function spawnerCalls(text: string): SpawnerCall[] {
  const local = new Map<string, SpawnerFn>()
  const namespaces: string[] = []
  IMPORT.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMPORT.exec(text)) !== null) {
    if (!SPAWNER_MODULE.test(match[2])) continue
    const clause = match[1]
    const namespace = NAMESPACE.exec(clause)
    if (namespace !== null) namespaces.push(namespace[1])
    const braced = BRACED.exec(clause)
    if (braced === null) continue
    for (const part of braced[1].split(',')) {
      const specifier = SPECIFIER.exec(part)
      if (specifier === null) continue
      const imported = SPAWNER_FNS.find((fn) => fn === specifier[1])
      if (imported === undefined) continue
      local.set(specifier[2] ?? specifier[1], imported)
    }
  }
  const calls: SpawnerCall[] = []
  for (const [name, fn] of local) collectCalls(text, name, fn, calls)
  for (const namespace of namespaces) {
    for (const fn of SPAWNER_FNS) collectCalls(text, `${namespace}\\.${fn}`, fn, calls)
  }
  return calls
}

const LITERAL_ARG = /^['"]([^'"]+)['"]$/
const ALIAS_ARG = /^Spawnables\.(\w+)$/
const SELF_ARG = /^this\.(\w+)$/

/** the prefab a call's first argument names, or null when it cannot be resolved */
export function resolveCallArg(
  arg: string,
  scriptPath: string,
  ctx: SceneCheckContext,
  byId: Map<string, SceneCheckPrefab>,
  byAlias: Map<string, SceneCheckPrefab>
): SceneCheckPrefab | null {
  const literal = LITERAL_ARG.exec(arg)
  if (literal !== null) return byId.get(literal[1]) ?? null
  const alias = ALIAS_ARG.exec(arg)
  if (alias !== null) return byAlias.get(alias[1]) ?? null
  const self = SELF_ARG.exec(arg)
  if (self === null) return null
  for (const row of allScriptRows(ctx)) {
    if (row.path !== scriptPath) continue
    const param = row.params.find((p) => p.name === self[1])
    if (param === undefined) continue
    for (const id of prefabIdsIn(param)) {
      const prefab = byId.get(id)
      if (prefab !== undefined) return prefab
    }
  }
  return null
}
