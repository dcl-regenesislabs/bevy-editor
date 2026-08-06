import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uiSetSpawnedOnly } from './spawned-only'

// A folder's placement gesture must speak for its contents: the members carry
// their own Inert markers, so flipping only the folder would move the group in
// the tree while the save-time projection kept honouring the markers underneath
// — "From the start" showing entities the built game does not contain.

const { state, pushed } = vi.hoisted(() => ({
  state: {
    snapshot: {} as Record<string, Record<string, unknown>>,
    frozen: true
  },
  pushed: [] as Array<Array<{ entityId: string; name: string }>>
}))

vi.mock('@scene/state', () => ({ state }))
vi.mock('@scene/inspector', () => ({
  writeComponent: async (id: string, name: string) => {
    state.snapshot[id][name] = {}
  },
  deleteComponent: (id: string, name: string) => {
    delete state.snapshot[id][name]
  }
}))
vi.mock('../engine/bus', () => ({ sendToScene: async () => {} }))
vi.mock('../core/history', () => ({
  pushHistory: (batch: Array<{ entityId: string; name: string }>) => pushed.push(batch),
  snapshotValue: (id: string, name: string) => state.snapshot[id]?.[name],
  withHistorySuppressed: async (fn: () => Promise<void>) => fn()
}))

const entity = (parent: number, extra: Record<string, unknown> = {}) => ({
  Transform: { position: { x: 0, y: 0, z: 0 }, parent },
  ...extra
})

beforeEach(() => {
  state.snapshot = {
    '900': entity(0, { 'inspector::Folder': {}, 'inspector::Inert': {} }),
    '600': entity(900, { 'inspector::Inert': {} }),
    '601': entity(900, { 'inspector::Inert': {} }),
    '610': entity(601, { 'inspector::Inert': {} }),
    '700': entity(0, { 'inspector::Inert': {} })
  }
  pushed.length = 0
})

describe('uiSetSpawnedOnly on a folder', () => {
  it('cascades over the whole subtree as ONE undo step', async () => {
    await uiSetSpawnedOnly('900', false)
    for (const id of ['900', '600', '601', '610']) {
      expect(state.snapshot[id]['inspector::Inert']).toBeUndefined()
    }
    expect(state.snapshot['700']['inspector::Inert']).toBeDefined()
    expect(pushed).toHaveLength(1)
    // two entries per entity: the Inert mark and the editor hide that keeps
    // the eye honest ride the same batch
    expect([...new Set(pushed[0].map((e) => e.entityId))].sort()).toEqual(['600', '601', '610', '900'])
  })

  it('marks the whole subtree when moving a folder to When spawned', async () => {
    await uiSetSpawnedOnly('900', false)
    pushed.length = 0
    await uiSetSpawnedOnly('900', true)
    for (const id of ['900', '600', '601', '610']) {
      expect(state.snapshot[id]['inspector::Inert']).toBeDefined()
    }
    expect(pushed).toHaveLength(1)
  })
})

describe('uiSetSpawnedOnly on a plain entity', () => {
  it('touches only the entity itself', async () => {
    await uiSetSpawnedOnly('700', false)
    expect(state.snapshot['700']['inspector::Inert']).toBeUndefined()
    expect(state.snapshot['900']['inspector::Inert']).toBeDefined()
    expect([...new Set(pushed[0].map((e) => e.entityId))]).toEqual(['700'])
  })
})
