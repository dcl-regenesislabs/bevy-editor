import { describe, it, expect, vi, beforeEach } from 'vitest'

// A removal is a history entry with no `after`: undo writes the old value back,
// redo takes it away again.

const writes: Array<{ entityId: string; name: string; json: string }> = []
const deletes: Array<{ entityId: string; name: string }> = []
const restored: unknown[] = []
const replayed: unknown[] = []
let nextRestoredId = 900

vi.mock('@scene/state', () => ({ state: { snapshot: {} } }))
vi.mock('@scene/reactive', () => ({ notify: () => {} }))
vi.mock('@scene/inspector', () => ({
  writeComponent: (entityId: string, name: string, json: string) => {
    writes.push({ entityId, name, json })
    return Promise.resolve()
  },
  deleteComponent: (entityId: string, name: string) => {
    deletes.push({ entityId, name })
  },
  restoreEntityDelete: (step: unknown) => {
    restored.push(step)
    return Promise.resolve(String(nextRestoredId++))
  },
  replayEntityDelete: (step: { live: string | null }) => {
    replayed.push(step.live)
    return Promise.resolve()
  }
}))

import {
  pushHistory,
  pushEntityDelete,
  undo,
  redo,
  canUndo,
  canRedo,
  isHistorySuppressed
} from './history'
import { type EntityRestore } from '@scene/inspector'

describe('undoing a component removal', () => {
  beforeEach(async () => {
    while (canUndo()) await undo()
    writes.length = 0
    deletes.length = 0
    restored.length = 0
    replayed.length = 0
  })

  it('writes the removed value back, then removes it again on redo', async () => {
    pushHistory([
      { entityId: '512', name: 'Visibility', before: { visible: true }, after: undefined }
    ])

    await undo()
    expect(writes).toEqual([{ entityId: '512', name: 'Visibility', json: '{"visible":true}' }])
    expect(deletes).toEqual([])
    expect(canRedo()).toBe(true)

    await redo()
    expect(deletes).toEqual([{ entityId: '512', name: 'Visibility' }])
  })

  it('does not record the replay as a fresh step', async () => {
    pushHistory([{ entityId: '512', name: 'Visibility', before: { visible: true } }])
    await undo()
    expect(canUndo()).toBe(false)
    expect(isHistorySuppressed()).toBe(false)
  })
})

describe('undoing an entity delete', () => {
  const step = (): EntityRestore => ({
    clip: { rootId: '512', order: ['512'], components: { '512': {} } },
    mode: 'subtree',
    children: [],
    live: '512'
  })

  beforeEach(async () => {
    while (canUndo()) await undo()
    restored.length = 0
    replayed.length = 0
    nextRestoredId = 900
  })

  it('brings the subtree back, and redo deletes the ids it came back under', async () => {
    const s = step()
    pushEntityDelete(s)

    await undo()
    expect(restored).toEqual([s])
    // the engine allocates ids, so the restored entity is not 512 any more —
    // a redo that still deleted 512 would delete nothing (or worse, someone else)
    expect(s.live).toBe('900')

    await redo()
    expect(replayed).toEqual(['900'])
  })

  it('re-creates from the same clip on every undo', async () => {
    const s = step()
    pushEntityDelete(s)
    await undo()
    await redo()
    await undo()
    expect(restored).toHaveLength(2)
    expect(s.live).toBe('901')
  })
})
