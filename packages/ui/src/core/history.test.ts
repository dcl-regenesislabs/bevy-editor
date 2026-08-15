import { describe, it, expect, vi, beforeEach } from 'vitest'

// A removal is a history entry with no `after`: undo writes the old value back,
// redo takes it away again.

const writes: Array<{ entityId: string; name: string; json: string }> = []
const deletes: Array<{ entityId: string; name: string }> = []
const restored: unknown[] = []
const replayed: unknown[] = []
let nextRestoredId = 900

// hoisted: the state mock reads it as the factory runs, before a plain const
// at this level would have been initialized
const { snapshot } = vi.hoisted(() => ({ snapshot: {} as Record<string, Record<string, unknown>> }))
vi.mock('@scene/state', () => ({ state: { snapshot } }))
vi.mock('@scene/reactive', () => ({ notify: () => {} }))
vi.mock('@scene/inspector', () => ({
  captureEntityDelete: (id: string, mode: string) => {
    if (snapshot[id] === undefined) return null
    const clip = { rootId: id, order: [id], components: { [id]: snapshot[id] } }
    return { clip, mode, children: [], live: id }
  },
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
  pushEntityCreate,
  undo,
  redo,
  canUndo,
  canRedo,
  isHistorySuppressed,
  withHistorySuppressed
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

// Creating is a delete read backwards. Before this step existed, undoing an
// import replayed the creation's writes with no `before` and left the entity
// behind with its components stripped — a husk the creator couldn't remove.
describe('undoing an entity creation', () => {
  const entity = (id: string, parent = 0): void => {
    snapshot[id] = { Transform: { parent }, 'core-schema::Name': { value: `Entity ${id}` } }
  }

  beforeEach(async () => {
    while (canUndo()) await undo()
    for (const key of Object.keys(snapshot)) delete snapshot[key]
    restored.length = 0
    replayed.length = 0
    nextRestoredId = 900
  })

  it('deletes what was created, and redo brings it back', async () => {
    entity('512')
    pushEntityCreate(['512'])

    await undo()
    expect(replayed).toEqual(['512'])
    expect(restored).toEqual([])

    await redo()
    expect(restored).toHaveLength(1)
    // back under a fresh id, so a second undo deletes what is actually there
    await undo()
    expect(replayed).toEqual(['512', '900'])
  })

  it('unwinds one gesture in reverse, so a root goes after what sits under it', async () => {
    entity('512')
    entity('513')
    pushEntityCreate(['512', '513'])

    await undo()
    expect(replayed).toEqual(['513', '512'])
  })

  it('keeps only the outermost roots, so a redo cannot restore a child twice', async () => {
    entity('512') // the group
    entity('513', 512) // placed under it in the same gesture
    entity('514', 513) // and one level deeper
    pushEntityCreate(['512', '513', '514'])

    await undo()
    expect(replayed).toEqual(['512'])
  })

  it('records nothing for an entity that never made it into the snapshot', async () => {
    pushEntityCreate(['512'])
    expect(canUndo()).toBe(false)
  })

  it('is not recorded while history is suppressed', async () => {
    entity('512')
    await withHistorySuppressed(async () => {
      pushEntityCreate(['512'])
    })
    expect(canUndo()).toBe(false)
  })

  it('hands the suppressed block its return value', async () => {
    const id = await withHistorySuppressed(async () => '512')
    expect(id).toBe('512')
  })
})
