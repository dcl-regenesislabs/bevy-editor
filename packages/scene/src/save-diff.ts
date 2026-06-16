// The save diff: compare the three value sources per authored (entity, component) and let the
// user choose which to persist. Sources:
//   initial — the authored baseline (/crdt_initial)
//   editor  — the value the editor last wrote (state.editorValues), or initial if untouched
//   live    — the current scene state (may carry runtime churn, e.g. tweens)
// A component is only listed when the three aren't all equal; equal sources collapse so the
// selector only offers distinct values. The default per row is whichever option holds the editor
// value, so untouched runtime churn defaults to "not persisted" and edits default to "persisted".

import { state, type Snapshot } from './state'
import { isAuthoredEntity, isSavableComponent } from './composite'

export type DiffSource = 'initial' | 'editor' | 'live'

// A value at one source, or absent (component not present / deleted).
export type Cell = { present: boolean; value?: unknown }

export type DiffRow = {
  entityId: string
  component: string
  cells: Record<DiffSource, Cell>
  // distinct sources to offer (collapsed on equality), in initial → editor → live order.
  options: DiffSource[]
}

const ABSENT: Cell = { present: false }
const cell = (v: unknown): Cell => (v === undefined ? ABSENT : { present: true, value: v })

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  // Numbers compare modulo float32 rounding: the editor writes float64, but the engine stores
  // component floats (Transform position/rotation/scale, colours, …) as f32 and re-emits the
  // rounded value — so a just-saved value reloads ~1 ULP off its source. Real edits exceed f32 ULP.
  if (typeof a === 'number' && typeof b === 'number') return Math.fround(a) === Math.fround(b)
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  return keys.every((k) => k in bo && deepEqual(ao[k], bo[k]))
}

function cellsEqual(a: Cell, b: Cell): boolean {
  if (a.present !== b.present) return false
  return !a.present || deepEqual(a.value, b.value)
}

// The editor source for a (entity, component): absent if deleted, the written value if edited,
// else the initial value (untouched).
function editorCell(entityId: string, name: string, initial: Cell): Cell {
  const key = `${entityId}/${name}`
  if (state.deletedEntities.has(entityId) || state.deletedComponents.has(key)) return ABSENT
  return state.editorValues.has(key) ? cell(state.editorValues.get(key)) : initial
}

// The distinct sources, collapsing equal ones onto the earliest (initial → editor → live).
function distinctOptions(cells: Record<DiffSource, Cell>): DiffSource[] {
  const out: DiffSource[] = ['initial']
  if (!cellsEqual(cells.editor, cells.initial)) out.push('editor')
  if (!cellsEqual(cells.live, cells.initial) && !cellsEqual(cells.live, cells.editor)) out.push('live')
  return out
}

// The displayed option (a member of row.options) whose value matches `source` — since equal
// sources collapse, e.g. asking for `live` when live == editor returns the `editor` button.
export function optionForSource(row: DiffRow, source: DiffSource): DiffSource {
  return row.options.find((o) => cellsEqual(row.cells[o], row.cells[source])) ?? row.options[0]
}

// The default selection for a row: the option holding the editor value.
export function defaultSelection(row: DiffRow): DiffSource {
  return optionForSource(row, 'editor')
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf('/')
  return [key.slice(0, i), key.slice(i + 1)]
}

// Compute the diff rows over the authored scope (baseline entities + editor-touched), one per
// (entity, savable component) whose three sources aren't all equal.
export function computeSaveDiff(initial: Snapshot, live: Snapshot): DiffRow[] {
  const entityIds = new Set<string>(Object.keys(initial))
  for (const key of state.editedComponents) entityIds.add(splitKey(key)[0])
  for (const key of state.deletedComponents) entityIds.add(splitKey(key)[0])
  for (const eid of state.deletedEntities) entityIds.add(eid)

  const rows: DiffRow[] = []
  for (const entityId of entityIds) {
    if (!isAuthoredEntity(Number(entityId))) continue

    const names = new Set<string>()
    for (const n of Object.keys(initial[entityId] ?? {})) names.add(n)
    for (const n of Object.keys(live[entityId] ?? {})) names.add(n)
    for (const key of state.editedComponents) {
      const [e, n] = splitKey(key)
      if (e === entityId) names.add(n)
    }
    for (const key of state.deletedComponents) {
      const [e, n] = splitKey(key)
      if (e === entityId) names.add(n)
    }

    for (const name of names) {
      if (!isSavableComponent(name)) continue
      // inspector::Nodes is regenerated from the hierarchy at save (buildComposite), not edited by
      // the user — never surface it as a change to review.
      if (name === 'inspector::Nodes') continue
      const initialC = cell(initial[entityId]?.[name])
      const cells: Record<DiffSource, Cell> = {
        initial: initialC,
        editor: editorCell(entityId, name, initialC),
        live: cell(live[entityId]?.[name])
      }
      if (cellsEqual(cells.initial, cells.editor) && cellsEqual(cells.editor, cells.live)) continue
      rows.push({ entityId, component: name, cells, options: distinctOptions(cells) })
    }
  }

  rows.sort(
    (a, b) =>
      Number(a.entityId) - Number(b.entityId) || a.component.localeCompare(b.component)
  )
  return rows
}

type AuthoredData = Record<string, Record<string, unknown>>

// Apply the dialog's selections onto the baseline → the authored data to write. Starts from the
// (savable) baseline and overrides/removes each listed component per the chosen source.
export function buildAuthoredFromSelection(
  initial: Snapshot,
  rows: DiffRow[],
  selection: Map<string, DiffSource>
): AuthoredData {
  const authored: AuthoredData = {}
  for (const [eid, comps] of Object.entries(initial)) {
    if (!isAuthoredEntity(Number(eid))) continue
    for (const [name, value] of Object.entries(comps)) {
      if (!isSavableComponent(name)) continue
      const entry = authored[eid] ?? (authored[eid] = {})
      entry[name] = value
    }
  }

  for (const row of rows) {
    const src = selection.get(`${row.entityId}/${row.component}`) ?? defaultSelection(row)
    const chosen = row.cells[src]
    const entry = authored[row.entityId] ?? (authored[row.entityId] = {})
    if (chosen.present) entry[row.component] = chosen.value
    else delete entry[row.component]
  }

  for (const eid of Object.keys(authored)) {
    if (Object.keys(authored[eid]).length === 0) delete authored[eid]
  }
  return authored
}
