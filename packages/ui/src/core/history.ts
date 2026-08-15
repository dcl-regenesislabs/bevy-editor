// Undo/redo for component edits (typed fields, renames, gizmo drags), for
// removing a component, and for deleting an entity.
//
// A component step is a batch of {entity, component, before, after}; undo
// re-writes `before` through the normal write path (engine + bus mirror), so
// everything downstream stays consistent. An absent side means "component not
// there": before undefined → undo deletes it, after undefined → redo deletes it.
//
// A delete step carries the whole subtree instead. The engine allocates entity
// ids, so undo can't restore the originals — the subtree comes back under fresh
// ids and the step tracks them, which is why an entity's id is not stable across
// an undo/redo cycle (component steps recorded against the old id no longer
// reach it).
//
// A create step is that same capture read backwards: undo deletes what was
// created, redo brings it back. Without it, undoing an asset import replayed the
// creation's component writes with no `before` and left an empty named husk in
// the hierarchy — an entity the creator never asked for and can't get rid of
// with a second undo.
import { state } from '@scene/state'
import { notify } from '@scene/reactive'
import { isMod } from '../lib/keys'
import {
  writeComponent,
  deleteComponent,
  captureEntityDelete,
  restoreEntityDelete,
  replayEntityDelete,
  type EntityRestore
} from '@scene/inspector'

export type HistoryEntry = {
  entityId: string
  name: string
  before?: unknown // undefined = component did not exist
  after?: unknown
}

type HistoryStep =
  | { kind: 'components'; entries: HistoryEntry[] }
  | { kind: 'delete'; restore: EntityRestore }
  // Several roots, because one gesture creates several entities (an import that
  // places a row of them). Ordered as they were created: undo unwinds backwards.
  | { kind: 'create'; created: EntityRestore[] }

const MAX_STEPS = 100
const undoStack: HistoryStep[] = []
const redoStack: HistoryStep[] = []
let suppress = false

export function isHistorySuppressed(): boolean {
  return suppress
}

function push(step: HistoryStep): void {
  undoStack.push(step)
  if (undoStack.length > MAX_STEPS) undoStack.shift()
  redoStack.length = 0
  notify() // canUndo/canRedo are read via selectors — refresh the toolbar buttons
}

export function pushHistory(batch: HistoryEntry[]): void {
  if (suppress || batch.length === 0) return
  push({ kind: 'components', entries: batch })
}

// One step for the whole deletion — see actions.ts, which captures it before the
// delete runs and keeps the delete's own writes out of the stack.
export function pushEntityDelete(restore: EntityRestore): void {
  if (suppress) return
  push({ kind: 'delete', restore })
}

// An entity created inside another one this same gesture is already in its
// ancestor's clip, so capturing it again would restore it twice on redo. Keep
// the outermost roots only — for "30 trees under a new Forest", that is Forest.
function outermost(ids: string[]): string[] {
  const set = new Set(ids)
  const parentOf = (id: string): number | undefined =>
    (state.snapshot[id]?.Transform as { parent?: number } | undefined)?.parent
  return ids.filter((id) => {
    let parent = parentOf(id)
    while (parent !== undefined && parent !== 0) {
      if (set.has(String(parent))) return false
      parent = parentOf(String(parent))
    }
    return true
  })
}

// One step for a whole creation gesture. Call it AFTER the entities exist (the
// capture reads the snapshot) and with the creation's own writes suppressed, so
// the step is the only trace of it — see actions/assets.ts.
export function pushEntityCreate(rootIds: string[]): void {
  if (suppress || rootIds.length === 0) return
  const created = outermost(rootIds)
    .map((id) => captureEntityDelete(id, 'subtree'))
    .filter((restore): restore is EntityRestore => restore !== null)
  if (created.length === 0) return
  push({ kind: 'create', created })
}

export function canUndo(): boolean {
  return undoStack.length > 0
}
export function canRedo(): boolean {
  return redoStack.length > 0
}

// Run writes that must NOT become undo steps (history replay itself does this
// inline; the scene-UI hide toggle borrows it — hiding chrome isn't an edit).
export async function withHistorySuppressed<T>(fn: () => Promise<T>): Promise<T> {
  suppress = true
  try {
    return await fn()
  } finally {
    suppress = false
  }
}

// A restore re-creates an entity under a fresh id, which strands every
// component step recorded against the old one (e.g. group a selection, ungroup,
// then undo twice: the second undo must remove the folder's components, but the
// folder now lives under the id the ungroup-undo allocated). The alias map
// re-points those steps at the live incarnation. Root ids only — descendants of
// a subtree restore are not aliased, matching what restoreEntityDelete reports.
const idAlias = new Map<string, string>()

function recordAlias(old: string, fresh: string): void {
  for (const [k, v] of idAlias) if (v === old) idAlias.set(k, fresh)
  idAlias.set(old, fresh)
}

function aliasOf(id: string): string {
  return idAlias.get(id) ?? id
}

// the restore lands on new ids; remember them so the next replay deletes what is
// actually there and a second undo has somewhere to come back from
async function bringBack(restore: EntityRestore): Promise<void> {
  const old = restore.live
  restore.live = await restoreEntityDelete(restore)
  if (old !== null && restore.live !== null && old !== restore.live) recordAlias(old, restore.live)
}

async function applyStep(step: HistoryStep, dir: 'before' | 'after'): Promise<void> {
  suppress = true
  try {
    if (step.kind === 'delete') {
      if (dir === 'before') await bringBack(step.restore)
      else await replayEntityDelete(step.restore)
      return
    }
    if (step.kind === 'create') {
      // The mirror image: undo takes the creation away, redo re-creates it.
      // Unwind in reverse so a root is removed after anything created under it,
      // and re-create forwards so a parent is back before its children look for it.
      if (dir === 'before') {
        for (const restore of [...step.created].reverse()) await replayEntityDelete(restore)
      } else {
        for (const restore of step.created) await bringBack(restore)
      }
      return
    }
    for (const e of step.entries) {
      const id = aliasOf(e.entityId)
      const value = dir === 'before' ? e.before : e.after
      if (value === undefined) {
        deleteComponent(id, e.name)
      } else {
        await writeComponent(id, e.name, JSON.stringify(value))
      }
    }
  } catch (err) {
    console.error('history apply failed:', err)
  } finally {
    suppress = false
  }
}

// The "move it in the code" offer is NOT cleared here. applyStep writes through
// writeComponent, whose observer recomputes the offer against the value the
// scene's code produced (boot.ts -> code-move-offer.ts) — so it survives an undo
// that leaves the entity displaced and disappears only when it is truly back.
export async function undo(): Promise<void> {
  const step = undoStack.pop()
  if (step === undefined) return
  redoStack.push(step)
  notify()
  await applyStep(step, 'before')
}

export async function redo(): Promise<void> {
  const step = redoStack.pop()
  if (step === undefined) return
  undoStack.push(step)
  notify()
  await applyStep(step, 'after')
}

// cmd/ctrl+z and cmd/ctrl+shift+z — except while typing in a field, where the
// input's own undo should win.
export function installHistoryKeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isMod(e)) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'd' && key !== 'c' && key !== 'v') return
      // Never steal the key from a text surface. contentEditable matters as much
      // as INPUT/TEXTAREA: Script Studio's CodeMirror edits a contentEditable DIV,
      // so without it ⌘Z inside the code editor undid a SCENE edit instead of the
      // typing, and CodeMirror's own history keymap never saw the key.
      const target = e.composedPath()[0] as HTMLElement | undefined
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true) return
      // ⌘C with text selected is the user copying text, not an entity
      if (key === 'c' && (window.getSelection()?.toString() ?? '') !== '') return
      e.preventDefault()
      e.stopPropagation()
      if (key === 'c') {
        if (state.activeEntity !== null && copyAction !== null) copyAction(state.activeEntity)
        return
      }
      if (key === 'v') {
        if (pasteAction !== null) void pasteAction()
        return
      }
      if (key === 'd') {
        if (state.activeEntity !== null && duplicateAction !== null) {
          void duplicateAction(state.activeEntity)
        }
        return
      }
      if (e.shiftKey) void redo()
      else void undo()
    },
    { capture: true }
  )
}

// injected by actions.ts (importing it here would be a dependency cycle)
let copyAction: ((id: string) => void) | null = null
let pasteAction: (() => Promise<void>) | null = null
export function setClipboardActions(copy: (id: string) => void, paste: () => Promise<void>): void {
  copyAction = copy
  pasteAction = paste
}

let duplicateAction: ((id: string) => Promise<void>) | null = null
export function setDuplicateAction(fn: (id: string) => Promise<void>): void {
  duplicateAction = fn
}

// convenience: capture the current snapshot value (deep clone) for a batch
export function snapshotValue(entityId: string, name: string): unknown {
  const v = state.snapshot[entityId]?.[name]
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}
