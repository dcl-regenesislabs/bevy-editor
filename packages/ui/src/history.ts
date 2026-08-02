// Undo/redo for component edits (typed fields, renames, gizmo drags). Each
// history step is a batch of {entity, component, before, after}; undo re-writes
// `before` through the normal write path (engine + bus mirror), so everything
// downstream stays consistent. Component/entity *deletions* are not undoable
// yet (recreating engine entities needs id remapping).
import { state } from '../../scene/src/state'
import { notify } from '../../scene/src/reactive'
import { writeComponent, deleteComponent } from '../../scene/src/inspector'

export type HistoryEntry = {
  entityId: string
  name: string
  before?: unknown // undefined = component did not exist
  after?: unknown
}

const MAX_STEPS = 100
const undoStack: HistoryEntry[][] = []
const redoStack: HistoryEntry[][] = []
let suppress = false

export function isHistorySuppressed(): boolean {
  return suppress
}

export function pushHistory(batch: HistoryEntry[]): void {
  if (suppress || batch.length === 0) return
  undoStack.push(batch)
  if (undoStack.length > MAX_STEPS) undoStack.shift()
  redoStack.length = 0
  notify() // canUndo/canRedo are read via selectors — refresh the toolbar buttons
}

export function canUndo(): boolean {
  return undoStack.length > 0
}
export function canRedo(): boolean {
  return redoStack.length > 0
}

// Run writes that must NOT become undo steps (history replay itself does this
// inline; the scene-UI hide toggle borrows it — hiding chrome isn't an edit).
export async function withHistorySuppressed(fn: () => Promise<void>): Promise<void> {
  suppress = true
  try {
    await fn()
  } finally {
    suppress = false
  }
}

async function applyBatch(batch: HistoryEntry[], dir: 'before' | 'after'): Promise<void> {
  suppress = true
  try {
    for (const e of batch) {
      const value = dir === 'before' ? e.before : e.after
      if (value === undefined) {
        deleteComponent(e.entityId, e.name)
      } else {
        await writeComponent(e.entityId, e.name, JSON.stringify(value))
      }
    }
  } catch (err) {
    console.error('history apply failed:', err)
  } finally {
    suppress = false
  }
}

// The "move it in the code" offer is NOT cleared here. applyBatch writes through
// writeComponent, whose observer recomputes the offer against the value the
// scene's code produced (boot.ts -> code-move-offer.ts) — so it survives an undo
// that leaves the entity displaced and disappears only when it is truly back.
export async function undo(): Promise<void> {
  const batch = undoStack.pop()
  if (batch === undefined) return
  redoStack.push(batch)
  notify()
  await applyBatch(batch, 'before')
}

export async function redo(): Promise<void> {
  const batch = redoStack.pop()
  if (batch === undefined) return
  undoStack.push(batch)
  notify()
  await applyBatch(batch, 'after')
}

// cmd/ctrl+z and cmd/ctrl+shift+z — except while typing in a field, where the
// input's own undo should win.
export function installHistoryKeys(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
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
