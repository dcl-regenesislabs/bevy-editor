// The Spawnable half of a prefab: reading and writing the `data.json` field, the
// generated alias a script refers to it by, and compiling `composite.json` into
// the snapshot literal the runtime clones from.
//
// Pure — no data layer, no engine. The impure orchestration is generate.ts, the
// text rendering is codegen.ts, and this module is what both agree on.
import { getScriptParams } from '../script/parser'
import { freshLayoutJson } from './versioning'
import {
  COMPOSITE_NAME,
  SCRIPT_COMPONENT,
  clone,
  isRecord,
  prefabLayout,
  substituteAssetPath,
  type PrefabComposite,
  type PrefabData,
  type PrefabSpawnable
} from './format'

// A layout string with no params: what the runner's `JSON.parse(layout || '{}')`
// would have produced anyway, written out so the generated file is readable.
export const EMPTY_LAYOUT = '{"params":{},"actions":[]}'

export interface SnapshotComponent {
  /** the composite-side name, e.g. `core::Transform` — what the runtime resolves */
  name: string
  json: unknown
}

export interface SnapshotEntity {
  localId: number
  /** null ⇒ the clone's root; the caller parents it */
  parent: number | null
  components: SnapshotComponent[]
}

export interface SnapshotScript {
  localId: number
  /** project-relative path of the prefab folder's copy */
  path: string
  priority: number
  layout: string
}

export interface SpawnableSnapshot {
  /** the prefab UUID — `data.json.id`, the one key that never moves */
  prefab: string
  alias: string
  max: number
  /**
   * What the prefab declares in `data.json`; 'onDemand' when it says nothing.
   * It is NOT the sync mode (that is an argument at pool-open) — it only says
   * whether the generated registry opens the per-player pool for this prefab.
   */
  instancing: 'onDemand' | 'perPlayer'
  entities: SnapshotEntity[]
  scripts: SnapshotScript[]
}

export function readSpawnable(data: PrefabData): PrefabSpawnable | null {
  return data.spawnable ?? null
}

export function isSpawnable(data: PrefabData): boolean {
  return data.spawnable !== undefined
}

// Never mutates: the caller holds the parsed folder and writes the result back,
// so an aborted write must leave the in-memory copy untouched.
export function withSpawnable(data: PrefabData, spawnable: PrefabSpawnable | null): PrefabData {
  if (spawnable === null) {
    const { spawnable: _dropped, ...rest } = data
    return rest
  }
  return { ...data, spawnable }
}

function pascalCase(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w !== '')
  const joined = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  // an alias is a TS identifier and an object key a script types by hand, so a
  // leading digit or an all-punctuation name has to become something writable
  return joined === '' || /^[0-9]/.test(joined) ? `Prefab${joined}` : joined
}

// `Zombie Basic` → `ZombieBasic`. Aliases are derived, so a rename regenerates
// them freely; the UUID is what anything persisted actually holds.
export function aliasFor(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken)
  const base = pascalCase(name)
  let alias = base
  for (let i = 2; used.has(alias); i++) alias = `${base}${i}`
  return alias
}

export interface CompileSnapshotInput {
  /** project-relative prefab folder, e.g. `custom/zombie_basic` */
  folder: string
  data: PrefabData
  composite: PrefabComposite
  /** script text by project-relative path; an empty layout is filled from it */
  scripts?: Record<string, string>
}

function scriptRows(value: unknown): Array<Record<string, unknown>> {
  const list = isRecord(value) ? value.value : undefined
  return Array.isArray(list) ? list.filter(isRecord) : []
}

// A prefab folder may ship its Script rows with no layout (hand-written
// composites usually do). Placed instances get theirs filled at instantiation by
// re-parsing the file; clones have no such moment, so it happens here — or the
// clone is constructed with zero arguments while the placed copy gets all of them.
function layoutFor(row: Record<string, unknown>, path: string, scripts: Record<string, string>): string {
  const declared = typeof row.layout === 'string' ? row.layout : ''
  if (declared !== '') return declared
  const text = scripts[path]
  if (text === undefined) return EMPTY_LAYOUT
  return freshLayoutJson(getScriptParams(text))
}

// `composite.json` → the clone source. `core-schema::Name` is stripped: names are
// how trigger zones and name-keyed lookups bind, and a clone that carries the
// authored name silently re-binds them (instantiation dedupes names for exactly
// this reason, and a runtime clone has no such pass).
export function compileSnapshot(input: CompileSnapshotInput): SpawnableSnapshot | null {
  const spawnable = readSpawnable(input.data)
  if (spawnable === null) return null

  const composite = clone(input.composite)
  substituteAssetPath(composite.components, input.folder)
  const scripts = input.scripts ?? {}
  const layout = prefabLayout(composite)

  const entities: SnapshotEntity[] = []
  const scriptSpecs: SnapshotScript[] = []
  for (const entity of layout.entities) {
    const localId = Number(entity.localId)
    const components: SnapshotComponent[] = []
    for (const component of composite.components) {
      const entry = component.data[entity.localId]
      if (entry === undefined) continue
      if (component.name === COMPOSITE_NAME) continue
      if (component.name === SCRIPT_COMPONENT) {
        for (const row of scriptRows(entry.json)) {
          if (typeof row.path !== 'string') continue
          scriptSpecs.push({
            localId,
            path: row.path,
            priority: typeof row.priority === 'number' ? row.priority : 0,
            layout: layoutFor(row, row.path, scripts)
          })
        }
        continue
      }
      components.push({ name: component.name, json: entry.json })
    }
    entities.push({
      localId,
      parent: entity.parent === null ? null : Number(entity.parent),
      components
    })
  }

  return {
    prefab: input.data.id,
    alias: aliasFor(input.data.name),
    max: spawnable.max,
    instancing: spawnable.instancing ?? 'onDemand',
    entities,
    scripts: scriptSpecs
  }
}

// Every script file a compiled snapshot needs in the bundle, deduped and in the
// order the registry imports them.
export function snapshotScriptPaths(snapshot: SpawnableSnapshot): string[] {
  const paths: string[] = []
  for (const script of snapshot.scripts) if (!paths.includes(script.path)) paths.push(script.path)
  return paths
}
