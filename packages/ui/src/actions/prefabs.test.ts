import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uiCreatePrefabFromSelection, uiDeletePrefab } from './prefabs'

// One gesture, one action: "Create spawnable prefab…" captures, flips Spawnable
// on and resolves where the captured copy sits, in that order. The order is the
// whole test — `state.assetBusy` is a boolean, not a counter, so every ui*
// sub-action clears it in its own `finally` and the grid un-greys mid-flight
// unless the create re-asserts it; and the announcement has to land after the
// refresh, or the card it flashes does not exist yet.

const { state, roots, calls, created, setSpawnable, setPlacement, refreshPrefabs, announceCreated, revealPrefab, deleteEntity, storeItems } =
  vi.hoisted(() => {
    const state = {
      snapshot: {} as Record<string, Record<string, unknown>>,
      assetBusy: false,
      saveStatus: '',
      frozen: true
    }
    const roots = { ids: ['512'] }
    const calls = { order: [] as string[], busyAtRefresh: [] as boolean[] }
    const created = {
      folder: 'custom/zombie',
      data: { id: 'z1', name: 'Zombie', category: 'custom' as const, tags: [] },
      warnings: [] as string[],
      entityCount: 3
    }
    const storeItems: Array<{ folder: string; data: typeof created.data }> = []
    return {
      state,
      roots,
      calls,
      created,
      storeItems,
      deleteEntity: vi.fn(async (id: string) => {
        calls.order.push(`delete:${id}`)
        delete state.snapshot[id]
      }),
      setSpawnable: vi.fn(async () => {
        calls.order.push('spawnable')
        state.assetBusy = false
      }),
      setPlacement: vi.fn(async () => {
        calls.order.push('placement')
        state.assetBusy = false
      }),
      refreshPrefabs: vi.fn(async () => {
        calls.order.push('refresh')
        calls.busyAtRefresh.push(state.assetBusy)
        return []
      }),
      announceCreated: vi.fn(() => calls.order.push('announce')),
      revealPrefab: vi.fn(() => calls.order.push('reveal'))
    }
  })

vi.mock('@scene/state', () => ({ state, topLevelSelected: () => roots.ids }))
vi.mock('@scene/inspector', () => ({ writeComponent: async () => {} }))
vi.mock('@scene/custom-components', () => ({ NAME_COMPONENT: 'core-schema::Name' }))
vi.mock('@scene/allowed-components', () => ({ TRIGGER_AREA: 'asset-packs::TriggerArea' }))
vi.mock('@scene/world-pos', () => ({ rootLocalForWorld: () => null }))
vi.mock('../engine/bus', () => ({ sendToScene: async () => {} }))
vi.mock('../assets', () => ({ dropPosition: async () => ({ x: 0, y: 0, z: 0 }), uniqueEntityName: (n: string) => n }))
vi.mock('../prefabs/instantiate', () => ({ instantiatePrefab: async () => ({ rootId: '600' }) }))
vi.mock('../prefabs/update', () => ({ updatePrefabCopy: async () => ({ updated: false }) }))
vi.mock('../prefabs/sdk-gate', () => ({ blockedBySdk: async () => false }))
vi.mock('../prefabs/storage', () => ({
  createPrefabFromSelection: async () => {
    calls.order.push('capture')
    return created
  },
  deletePrefabFolder: async () => {},
  renamePrefabFolder: async () => created.data
}))
vi.mock('../prefabs/library', () => ({
  commitPrefabImport: async () => ({}),
  copyLibraryPrefabIntoProject: async () => ({}),
  deleteLibraryPrefab: async () => {},
  libraryAvailable: () => false,
  savePrefabToLibrary: async () => ({})
}))
vi.mock('../panels/prefab-store', () => ({
  announceCreated,
  prefabStore: { items: storeItems },
  refreshLibrary: async () => [],
  refreshPrefabs,
  revealLibraryPrefab: () => {},
  revealPrefab
}))
vi.mock('../core/autosave', () => ({ flushPendingSave: async () => {} }))
vi.mock('./ghost', () => ({ uiSetPlacement: setPlacement }))
vi.mock('./spawnables', () => ({ uiSetSpawnable: setSpawnable }))
vi.mock('./entities', () => ({ uiDeleteEntityRecursive: deleteEntity }))
vi.mock('./selection', () => ({
  syncSelectionToScene: () => {},
  ensureTransformTool: () => {},
  focusPlaced: () => {}
}))

beforeEach(() => {
  state.assetBusy = false
  state.saveStatus = ''
  roots.ids = ['512']
  calls.order = []
  calls.busyAtRefresh = []
  setSpawnable.mockClear()
  setPlacement.mockClear()
  refreshPrefabs.mockClear()
  announceCreated.mockClear()
  revealPrefab.mockClear()
})

describe('uiCreatePrefabFromSelection', () => {
  it('captures, turns Spawnable on and places, in that order', async () => {
    await uiCreatePrefabFromSelection('Zombie', {
      spawnable: { max: 64, instancing: 'onDemand' },
      placement: 'unplaced'
    })
    expect(calls.order).toEqual(['capture', 'spawnable', 'placement', 'refresh', 'announce', 'reveal'])
    expect(setSpawnable).toHaveBeenCalledWith('custom/zombie', { max: 64, instancing: 'onDemand' })
    expect(setPlacement).toHaveBeenCalledWith('custom/zombie', created.data, 'unplaced')
  })

  it('keeps the grid greyed until the whole gesture is finished', async () => {
    await uiCreatePrefabFromSelection('Zombie', {
      spawnable: { max: 64, instancing: 'onDemand' },
      placement: 'unplaced'
    })
    expect(calls.busyAtRefresh).toEqual([true])
    expect(state.assetBusy).toBe(false)
  })

  it('writes no placement when the captured copy is already where it belongs', async () => {
    await uiCreatePrefabFromSelection('Zombie', {
      spawnable: { max: 4, instancing: 'perPlayer' },
      placement: 'editorAndPlay'
    })
    expect(setPlacement).not.toHaveBeenCalled()
  })

  it('writes no placement for a multi-root capture, which marks no instance', async () => {
    roots.ids = ['512', '513']
    await uiCreatePrefabFromSelection('Zombie', {
      spawnable: { max: 64, instancing: 'onDemand' },
      placement: 'unplaced'
    })
    expect(setPlacement).not.toHaveBeenCalled()
    expect(state.saveStatus).toContain('several roots')
  })

  it('says what it made and where, with the folder out of the headline', async () => {
    await uiCreatePrefabFromSelection('Zombie', { spawnable: { max: 12, instancing: 'onDemand' } })
    expect(state.saveStatus).toContain('Created Zombie — spawnable, up to 12 alive at once')
    expect(state.saveStatus).toContain('in custom/zombie')
  })

  it('points a plain create at the tab that now holds it', async () => {
    await uiCreatePrefabFromSelection('Zombie')
    expect(setSpawnable).not.toHaveBeenCalled()
    expect(state.saveStatus).toContain('Created Zombie — find it in the Prefabs tab')
    expect(announceCreated).toHaveBeenCalledWith({
      folder: 'custom/zombie',
      name: 'Zombie',
      max: null,
      instancing: 'onDemand',
      placement: 'editorAndPlay'
    })
  })

  it('carries the spawning answers into what the Prefabs tab will say', async () => {
    await uiCreatePrefabFromSelection('Zombie', {
      spawnable: { max: 24, instancing: 'perPlayer' },
      placement: 'unplaced'
    })
    expect(announceCreated).toHaveBeenCalledWith({
      folder: 'custom/zombie',
      name: 'Zombie',
      max: 24,
      instancing: 'perPlayer',
      placement: 'unplaced'
    })
  })

  it('refuses an empty selection without touching anything', async () => {
    roots.ids = []
    await uiCreatePrefabFromSelection('Zombie', { spawnable: { max: 8, instancing: 'onDemand' } })
    expect(calls.order).toEqual([])
    expect(announceCreated).not.toHaveBeenCalled()
  })
})

// Deleting a prefab folder used to strand its placed copies — invisible ones
// (Sit Spot) survived as unexplained editor markers the creator could not click.
describe('uiDeletePrefab', () => {
  it('removes placed instances along with the folder', async () => {
    storeItems.length = 0
    storeItems.push({ folder: 'custom/sit_spot', data: { ...created.data, id: 'sit1' } })
    state.snapshot = {
      '700': { 'inspector::CustomAsset': { assetId: 'sit1' }, 'core-schema::Name': { value: 'Sit Spot' } },
      '701': { 'inspector::CustomAsset': { assetId: 'sit1' } },
      '702': { 'inspector::CustomAsset': { assetId: 'other' } }
    }
    deleteEntity.mockClear()

    await uiDeletePrefab('custom/sit_spot')

    expect(deleteEntity.mock.calls.map((c) => c[0]).sort()).toEqual(['700', '701'])
    expect(state.saveStatus).toBe('Deleted custom/sit_spot')
  })

  it('deletes a folder with no instances without touching the scene', async () => {
    storeItems.length = 0
    storeItems.push({ folder: 'custom/bench', data: { ...created.data, id: 'b1' } })
    state.snapshot = { '800': { 'inspector::CustomAsset': { assetId: 'zzz' } } }
    deleteEntity.mockClear()

    await uiDeletePrefab('custom/bench')

    expect(deleteEntity).not.toHaveBeenCalled()
  })
})
