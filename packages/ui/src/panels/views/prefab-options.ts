// The option list behind a `PrefabRef` / `PrefabRef[]` script param: every
// project prefab, by name, keyed by the UUID the layout actually stores.
// Picking one here IS what ships it with the game, so there is no eligibility
// setting to forget — with one exception: a prefab that carries a spawner
// script of its own is never offered, because a spawner inside a spawned copy
// never starts (the bus refuses the duplicated name), so picking it makes a
// spot that silently does nothing.
//
// Pure so the picker itself stays dumb. A ref that no longer names a prefab in
// this project — or that points at a spawner-carrying prefab from before the
// filter — is never dropped silently: it comes back as its own option saying
// why, because a param that quietly empties itself is how a scene breaks with
// no message anywhere.
import {
  SCRIPT_COMPONENT,
  isRecord,
  type PrefabComposite,
  type PrefabData
} from '../../prefabs/format'

export interface PrefabOption {
  value: string
  label: string
}

export interface PrefabChoice {
  data: PrefabData
  /** the prefab's own composite attaches a spawner script — see compositeCarriesSpawner */
  carriesSpawner?: boolean
}

export const NONE_LABEL = 'none'

export const SPAWNER_REF_NOTE = 'a spawner — its copies would do nothing'

// Attached scripts only, never the carried runtime/ modules: every kit prefab
// bundles runtime/spawner.ts as a resource, but only an entity that RUNS a
// spawner script is a spawn point.
const SPAWNER_SCRIPT = /(^|\/)spawner\.ts$/

export function compositeCarriesSpawner(composite: PrefabComposite): boolean {
  for (const component of composite.components) {
    if (component.name !== SCRIPT_COMPONENT) continue
    for (const entry of Object.values(component.data)) {
      const json = entry.json
      const rows = isRecord(json) && Array.isArray(json.value) ? json.value : []
      for (const row of rows) {
        if (!isRecord(row) || typeof row.path !== 'string') continue
        if (row.path.includes('/runtime/')) continue
        if (SPAWNER_SCRIPT.test(row.path)) return true
      }
    }
  }
  return false
}

// A layout written before the param was typed can hold a plain string (the
// comma-separated form the kit scripts still tolerate), so both shapes read.
export function refsOf(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  const refs: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const ref = item.trim()
    if (ref !== '' && !refs.includes(ref)) refs.push(ref)
  }
  return refs
}

export function refOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shortId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`
}

function missingLabel(ref: string): string {
  return `${shortId(ref)} — prefab not in this project`
}

/**
 * Every offerable project prefab as an option, plus one per selected ref that
 * is filtered or no longer resolves (so the creator can see and clear it).
 * `includeNone` prepends the empty choice a single-value param needs.
 */
export function prefabRefOptions(
  items: PrefabChoice[],
  selected: string[],
  includeNone = false
): PrefabOption[] {
  const options: PrefabOption[] = includeNone ? [{ value: '', label: NONE_LABEL }] : []
  const all = items
    .filter((item) => item.carriesSpawner !== true || selected.includes(item.data.id))
    .map((item) => ({
      value: item.data.id,
      label:
        item.carriesSpawner === true ? `${item.data.name} — ${SPAWNER_REF_NOTE}` : item.data.name
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  options.push(...all)
  for (const ref of selected) {
    if (ref === '' || options.some((option) => option.value === ref)) continue
    options.push({ value: ref, label: missingLabel(ref) })
  }
  return options
}

export function hasSpawnablePrefabs(items: PrefabChoice[]): boolean {
  return items.some((item) => item.carriesSpawner !== true)
}
