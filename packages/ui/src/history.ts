// Undo/redo for component edits (typed fields, renames, gizmo drags). Each
// history step is a batch of {entity, component, before, after}; undo re-writes
// `before` through the normal write path (engine + bus mirror), so everything
// downstream stays consistent. Component/entity *deletions* are not undoable
// yet (recreating engine entities needs id remapping).
import { state } from '../../scene/src/state'
import { writeComponent, deleteComponent } from '../../scene/src/inspector'
import { bump } from './store'

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
  bump()
}

export function canUndo(): boolean {
  return undoStack.length > 0
}
export function canRedo(): boolean {
  return redoStack.length > 0
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
    bump()
  }
}

export async function undo(): Promise<void> {
  const batch = undoStack.pop()
  if (batch === undefined) return
  redoStack.push(batch)
  await applyBatch(batch, 'before')
}

export async function redo(): Promise<void> {
  const batch = redoStack.pop()
  if (batch === undefined) return
  undoStack.push(batch)
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
      if (key !== 'z' && key !== 'd') return
      const target = e.composedPath()[0] as HTMLElement | undefined
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      e.stopPropagation()
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
let duplicateAction: ((id: string) => Promise<void>) | null = null
export function setDuplicateAction(fn: (id: string) => Promise<void>): void {
  duplicateAction = fn
}

// convenience: capture the current snapshot value (deep clone) for a batch
export function snapshotValue(entityId: string, name: string): unknown {
  const v = state.snapshot[entityId]?.[name]
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v))
}
