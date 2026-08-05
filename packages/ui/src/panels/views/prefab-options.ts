// The option list behind a `PrefabRef` / `PrefabRef[]` script param: the project's
// Spawnable prefabs, by name, keyed by the UUID the layout actually stores.
//
// Pure so the picker itself stays dumb. A ref that no longer names a Spawnable
// prefab is never dropped silently — it comes back as its own option saying why,
// because a param that quietly empties itself is how a scene breaks with no
// message anywhere.
import type { PrefabData } from '../../prefabs/format'
import { isSpawnable } from '../../prefabs/spawnable'

export interface PrefabOption {
  value: string
  label: string
}

export interface PrefabChoice {
  data: PrefabData
}

export const NONE_LABEL = 'none'

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

function missingLabel(ref: string, items: PrefabChoice[]): string {
  const known = items.find((item) => item.data.id === ref)
  return known === undefined
    ? `${shortId(ref)} — prefab not in this project`
    : `${known.data.name} — Spawnable is off`
}

/**
 * Every Spawnable prefab as an option, plus one per selected ref that is not one
 * (so the creator can see and clear it). `includeNone` prepends the empty choice
 * a single-value param needs.
 */
export function prefabRefOptions(
  items: PrefabChoice[],
  selected: string[],
  includeNone = false
): PrefabOption[] {
  const options: PrefabOption[] = includeNone ? [{ value: '', label: NONE_LABEL }] : []
  const spawnable = items
    .filter((item) => isSpawnable(item.data))
    .map((item) => ({ value: item.data.id, label: item.data.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
  options.push(...spawnable)
  for (const ref of selected) {
    if (ref === '' || options.some((option) => option.value === ref)) continue
    options.push({ value: ref, label: missingLabel(ref, items) })
  }
  return options
}

export function hasSpawnablePrefabs(items: PrefabChoice[]): boolean {
  return items.some((item) => isSpawnable(item.data))
}
