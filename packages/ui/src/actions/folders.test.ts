import { beforeEach, describe, expect, it, vi } from 'vitest'
import { groupParent, groupSeat, isFolderEntity, uiGroupIntoFolder, uiUngroupSelection } from './folders'

// Grouping is create + N reparents, but it must LAND as one undo step whose
// batch carries the folder's components (before: undefined — undo removes them
// and the empty entity vanishes) alongside every member Transform that moved.
// The seat math matters too: the folder sits at the members' centroid so the
// gizmo and Focus get a sensible pivot, not the world origin.

const { state, selection, codeIds, engineCalls, pushed, renamed, deletedKeep } = vi.hoisted(() => ({
  state: {
    snapshot: {} as Record<string, Record<string, unknown>>,
    activeEntity: null as string | null,
    frozen: true
  },
  selection: { ids: [] as string[] },
  codeIds: new Set<string>(),
  engineCalls: { created: [] as Array<Record<string, unknown>>, reparented: [] as Array<[string[], string]> },
  pushed: [] as Array<Array<{ entityId: string; name: string; before: unknown; after: unknown }>>,
  renamed: [] as string[],
  deletedKeep: [] as string[]
}))

vi.mock('@scene/state', () => ({
  state,
  setSelected: (ids: string[]) => ids,
  topLevelSelected: () => selection.ids,
  provenanceBaseline: () => null
}))
vi.mock('@scene/inspector', () => ({
  createEntities: async (specs: Array<Record<string, unknown>>) => {
    engineCalls.created.push(...specs)
    state.snapshot['900'] = JSON.parse(JSON.stringify(specs[0])) as Record<string, unknown>
    return [900]
  },
  reparentEntitiesTo: async (ids: string[], parent: string) => {
    engineCalls.reparented.push([ids, parent])
    for (const id of ids) {
      const t = state.snapshot[id].Transform as { parent: number }
      state.snapshot[id] = { ...state.snapshot[id], Transform: { ...t, parent: Number(parent) } }
    }
    return ids
  }
}))
vi.mock('@scene/custom-components', () => ({ NAME_COMPONENT: 'core-schema::Name' }))
vi.mock('@scene/world-pos', () => ({
  worldTransformOf: (s: Record<string, Record<string, unknown>>, id: string) => ({
    position: (s[id]?.Transform as { position: { x: number; y: number; z: number } }).position
  }),
  rootLocalForWorld: (_s: unknown, world: { x: number; y: number; z: number }) => world
}))
vi.mock('../assets', () => ({ dropPosition: async () => ({ x: 8, y: 0, z: 8 }) }))
vi.mock('../panels/reveal', () => ({ revealAndRename: (id: string) => renamed.push(id) }))
vi.mock('../panels/hierarchy-model', () => ({
  hierarchyModel: () => ({ isCode: (id: string) => codeIds.has(id), isEngine: () => false })
}))
vi.mock('../panels/authored-ids', () => ({ authoredFromComposite: () => null }))
vi.mock('../core/history', () => ({
  pushHistory: (batch: Array<{ entityId: string; name: string; before: unknown; after: unknown }>) =>
    pushed.push(batch),
  snapshotValue: (id: string, name: string) => state.snapshot[id]?.[name],
  withHistorySuppressed: async (fn: () => Promise<void>) => fn()
}))
vi.mock('./run', () => ({ run: async (p: Promise<unknown>) => p }))
vi.mock('./selection', () => ({ syncSelectionToScene: () => {} }))
vi.mock('./entities', () => ({ uiDeleteEntityReparent: async (id: string) => deletedKeep.push(id) }))

const entity = (pos: { x: number; y: number; z: number }, parent = 0, extra: Record<string, unknown> = {}) => ({
  Transform: { position: pos, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parent },
  'core-schema::Name': { value: 'Thing' },
  ...extra
})

beforeEach(() => {
  state.snapshot = {
    '600': entity({ x: 2, y: 0, z: 2 }),
    '601': entity({ x: 4, y: 0, z: 6 }),
    '700': entity({ x: 1, y: 1, z: 1 }, 601)
  }
  state.activeEntity = null
  selection.ids = []
  codeIds.clear()
  engineCalls.created.length = 0
  engineCalls.reparented.length = 0
  pushed.length = 0
  renamed.length = 0
  deletedKeep.length = 0
})

describe('groupParent', () => {
  it('keeps the parent every member shares', () => {
    expect(groupParent(state.snapshot, ['700'], () => false)).toBe('601')
  })
  it('falls back to the root when parents disagree', () => {
    expect(groupParent(state.snapshot, ['600', '700'], () => false)).toBe('0')
  })
  it('never targets a code-made parent', () => {
    expect(groupParent(state.snapshot, ['700'], (id) => id === '601')).toBe('0')
  })
})

describe('groupSeat', () => {
  it('averages sibling locals in the shared frame', () => {
    expect(groupSeat(state.snapshot, ['600', '601'], '0')).toEqual({ x: 3, y: 0, z: 4 })
  })
  it('averages world positions when parents are mixed', () => {
    expect(groupSeat(state.snapshot, ['600', '700'], '0')).toEqual({ x: 1.5, y: 0.5, z: 1.5 })
  })
})

describe('uiGroupIntoFolder', () => {
  it('creates the folder at the centroid, moves the members, and pushes ONE batch', async () => {
    selection.ids = ['600', '601']
    await uiGroupIntoFolder()

    const spec = engineCalls.created[0]
    expect((spec.Transform as { position: unknown; parent: number }).position).toEqual({ x: 3, y: 0, z: 4 })
    expect(spec['inspector::Folder']).toEqual({})
    expect(engineCalls.reparented).toEqual([[['600', '601'], '900']])

    expect(pushed).toHaveLength(1)
    const batch = pushed[0]
    const folderEntries = batch.filter((e) => e.entityId === '900')
    expect(folderEntries.map((e) => e.name).sort()).toEqual(['Transform', 'core-schema::Name', 'inspector::Folder'])
    expect(folderEntries.every((e) => e.before === undefined)).toBe(true)
    const moved = batch.filter((e) => e.entityId !== '900')
    expect(moved.map((e) => e.entityId).sort()).toEqual(['600', '601'])
    expect(renamed).toEqual(['900'])
    expect(state.activeEntity).toBe('900')
  })

  it('marks the folder spawned-only when every member is', async () => {
    state.snapshot['600']['inspector::Inert'] = {}
    state.snapshot['601']['inspector::Inert'] = {}
    selection.ids = ['600', '601']
    await uiGroupIntoFolder()
    expect(engineCalls.created[0]['inspector::Inert']).toEqual({})
    expect(pushed[0].some((e) => e.entityId === '900' && e.name === 'inspector::Inert')).toBe(true)
  })

  it('leaves the folder placed when the selection is mixed', async () => {
    state.snapshot['600']['inspector::Inert'] = {}
    selection.ids = ['600', '601']
    await uiGroupIntoFolder()
    expect(engineCalls.created[0]['inspector::Inert']).toBeUndefined()
  })

  it('groups nothing when the whole selection is code-made', async () => {
    codeIds.add('600')
    selection.ids = ['600']
    await uiGroupIntoFolder()
    expect(engineCalls.created).toHaveLength(0)
    expect(pushed).toHaveLength(0)
  })
})

describe('uiUngroupSelection', () => {
  it('ungroups only the folders in the selection', async () => {
    state.snapshot['601']['inspector::Folder'] = {}
    selection.ids = ['600', '601']
    await uiUngroupSelection()
    expect(deletedKeep).toEqual(['601'])
  })
})

describe('isFolderEntity', () => {
  it('is the marker, nothing else', () => {
    expect(isFolderEntity(state.snapshot, '600')).toBe(false)
    state.snapshot['600']['inspector::Folder'] = {}
    expect(isFolderEntity(state.snapshot, '600')).toBe(true)
  })
})
