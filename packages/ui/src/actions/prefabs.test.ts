import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uiAddSpawnerFor, uiCreatePrefabFromSelection, uiDeletePrefab, uiRenamePrefab } from './prefabs'

// One gesture, one action: Create prefab captures and, for "When spawned",
// removes what it captured — in that order. The order is the whole test:
// `state.assetBusy` is a boolean, not a counter, so every ui* sub-action clears
// it in its own `finally` and the grid un-greys mid-flight unless the create
// re-asserts it; and the announcement has to land after the refresh, or the
// card it flashes does not exist yet.

const {
  state,
  roots,
  calls,
  created,
  refreshPrefabs,
  announceCreated,
  revealPrefab,
  deleteEntity,
  setSpawnedOnly,
  storeItems,
  history,
  paramWrites,
  expandedKeys,
  revealInTree,
  writeScriptParamValues
} = vi.hoisted(() => {
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
  const history = { batches: [] as Array<Array<{ entityId: string; name: string }>> }
  const paramWrites: Array<Record<string, unknown>> = []
  const expandedKeys = new Set<string>()
  return {
    state,
    roots,
    calls,
    created,
    storeItems,
    history,
    paramWrites,
    expandedKeys,
    revealInTree: vi.fn(),
    writeScriptParamValues: vi.fn(async (id: string, values: Record<string, unknown>) => {
      paramWrites.push(values)
      const row = { path: 'custom/spawner/scripts/spawner.ts', priority: 0, layout: JSON.stringify({ params: values }) }
      state.snapshot[id] = { ...state.snapshot[id], 'asset-packs::Script': { value: [row] } }
      return Object.keys(values)
    }),
    setSpawnedOnly: vi.fn(async (id: string) => {
      calls.order.push(`spawned:${id}`)
    }),
    deleteEntity: vi.fn(async (id: string) => {
      calls.order.push(`delete:${id}`)
      delete state.snapshot[id]
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

vi.mock('@scene/state', () => ({
  state,
  topLevelSelected: () => roots.ids,
  componentKey: (id: string, name: string) => `${id}:${name}`,
  setComponentExpanded: (key: string, expanded: boolean) => {
    if (expanded) expandedKeys.add(key)
    else expandedKeys.delete(key)
  }
}))
vi.mock('@scene/inspector', () => ({
  writeComponent: async (id: string, name: string, json: string) => {
    state.snapshot[id] = { ...state.snapshot[id], [name]: JSON.parse(json) as unknown }
  }
}))
vi.mock('@scene/custom-components', () => ({
  NAME_COMPONENT: 'core-schema::Name',
  entityName: (snapshot: Record<string, Record<string, unknown>>, id: string) =>
    (snapshot[id]?.['core-schema::Name'] as { value?: string } | undefined)?.value
}))
vi.mock('@scene/allowed-components', () => ({ TRIGGER_AREA: 'TriggerArea' }))
vi.mock('@scene/world-pos', () => ({ rootLocalForWorld: () => null }))
vi.mock('../engine/bus', () => ({ sendToScene: async () => {} }))
vi.mock('../assets', () => ({ dropPosition: async () => ({ x: 0, y: 0, z: 0 }), uniqueEntityName: (n: string) => n }))
vi.mock('../prefabs/instantiate', () => ({
  instantiatePrefab: async () => ({
    rootId: '600',
    data: { id: 'sp1', name: 'Spawner' },
    warnings: [],
    permissionsAdded: [],
    hasScripts: true
  })
}))
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
  prefabStore: { items: storeItems, library: [] },
  refreshLibrary: async () => [],
  refreshPrefabs,
  revealLibraryPrefab: () => {},
  revealPrefab
}))
vi.mock('../core/autosave', () => ({ flushPendingSave: async () => {} }))
vi.mock('../core/history', () => ({
  pushHistory: (batch: Array<{ entityId: string; name: string }>) => history.batches.push(batch),
  snapshotValue: (id: string, name: string) => {
    const value = state.snapshot[id]?.[name]
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown)
  },
  withHistorySuppressed: async (fn: () => Promise<void>) => fn()
}))
vi.mock('../panels/reveal', () => ({ revealInTree }))
vi.mock('../script/params', () => ({ writeScriptParamValues }))
const regen = vi.hoisted(() => ({ count: 0 }))
vi.mock('../prefabs/generate', () => ({
  regenerateSpawnables: async () => {
    regen.count++
    return { written: false, attached: false, vendored: [], problems: [], blocked: false }
  }
}))
const projectFiles = vi.hoisted(() => ({ list: [] as string[], texts: new Map<string, string>() }))
vi.mock('../engine/datalayer', () => ({
  dataLayerListFiles: async () => projectFiles.list,
  dataLayerReadFile: async (path: string) => {
    const text = projectFiles.texts.get(path)
    if (text === undefined) throw new Error(`no such file ${path}`)
    return text
  }
}))
vi.mock('./entities', () => ({ uiDeleteEntityRecursive: deleteEntity }))
vi.mock('./spawned-only', () => ({ applySpawnedOnly: setSpawnedOnly }))
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
  regen.count = 0
  projectFiles.list = []
  projectFiles.texts.clear()
  deleteEntity.mockClear()
  setSpawnedOnly.mockClear()
  refreshPrefabs.mockClear()
  announceCreated.mockClear()
  revealPrefab.mockClear()
})

describe('uiCreatePrefabFromSelection', () => {
  it('captures, then marks what it captured as spawn-only, in that order', async () => {
    await uiCreatePrefabFromSelection('Zombie', { spawnedOnly: true })
    expect(calls.order).toEqual(['capture', 'spawned:512', 'refresh', 'announce', 'reveal'])
  })

  it('keeps the grid greyed until the whole gesture is finished', async () => {
    await uiCreatePrefabFromSelection('Zombie', { spawnedOnly: true })
    expect(calls.busyAtRefresh).toEqual([true])
    expect(state.assetBusy).toBe(false)
  })

  it('leaves the copy alone when it should appear from the start', async () => {
    await uiCreatePrefabFromSelection('Zombie', { spawnedOnly: false })
    expect(setSpawnedOnly).not.toHaveBeenCalled()
  })

  it('never marks a multi-root capture — no instance identity, no exclusion', async () => {
    roots.ids = ['512', '513']
    await uiCreatePrefabFromSelection('Zombie', { spawnedOnly: true })
    expect(setSpawnedOnly).not.toHaveBeenCalled()
    expect(state.saveStatus).toContain('several roots')
  })

  it('points the create at the tab that now holds it', async () => {
    await uiCreatePrefabFromSelection('Zombie')
    expect(state.saveStatus).toContain('Created Zombie — find it in the Prefabs tab')
    expect(state.saveStatus).toContain('in custom/zombie')
    expect(announceCreated).toHaveBeenCalledWith({
      folder: 'custom/zombie',
      name: 'Zombie',
      placement: 'editorAndPlay'
    })
  })

  it('refuses an empty selection without touching anything', async () => {
    roots.ids = []
    await uiCreatePrefabFromSelection('Zombie', { spawnedOnly: true })
    expect(calls.order).toEqual([])
    expect(announceCreated).not.toHaveBeenCalled()
  })
})

// The right-click gesture. Everything after the placement is one undo step: the
// creator meant "add a spawner here", so ⌘Z has to answer that whole sentence and
// not leave a half-configured Spawner parented to nothing.
describe('uiAddSpawnerFor', () => {
  const NAME = 'core-schema::Name'

  beforeEach(() => {
    storeItems.length = 0
    storeItems.push({ folder: 'custom/spawner', data: { ...created.data, id: 'sp1', name: 'Spawner' } })
    state.snapshot = { '512': { [NAME]: { value: 'Bench' } } }
    history.batches.length = 0
    paramWrites.length = 0
    expandedKeys.clear()
    revealInTree.mockClear()
    writeScriptParamValues.mockClear()
  })

  it('parents the Spawner to what was clicked and sits it exactly on it', async () => {
    expect(await uiAddSpawnerFor('512')).toBe('600')
    expect(state.snapshot['600'].Transform).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      parent: 512
    })
  })

  it('makes an ordinary entity the thing a player clicks', async () => {
    await uiAddSpawnerFor('512')
    expect(paramWrites).toEqual([{ when: 'when clicked' }])
  })

  it('makes a trigger area spawn on the way in, naming the zone', async () => {
    state.snapshot = { '512': { [NAME]: { value: 'Front Door' }, TriggerArea: {} } }
    await uiAddSpawnerFor('512')
    expect(paramWrites).toEqual([{ when: 'when a player enters' }])
  })

  it('spends exactly one undo step on everything it configured', async () => {
    await uiAddSpawnerFor('512')
    expect(history.batches).toHaveLength(1)
    expect(history.batches[0].map((entry) => entry.name).sort()).toEqual([
      'Transform',
      'asset-packs::Script',
      'core-schema::Name'
    ])
    expect(history.batches[0].every((entry) => entry.entityId === '600')).toBe(true)
  })

  // The gesture cannot pick WHAT appears, so it has to end on the control that
  // can. Every inspector card but Transform starts collapsed, so without this the
  // creator lands on a header and the walkthrough dead-ends one click early.
  it('leaves the settings card open on the one thing it could not fill in', async () => {
    await uiAddSpawnerFor('512')
    expect([...expandedKeys]).toContain('600:asset-packs::Script')
  })

  it('names it after what it was added to, and shows it in the tree', async () => {
    await uiAddSpawnerFor('512')
    expect(state.snapshot['600'][NAME]).toEqual({ value: 'Bench Spawner' })
    expect(revealInTree).toHaveBeenCalledWith('600')
    expect(state.saveStatus).toContain('Added a Spawner to Bench')
  })

  // Re-headlining the placement's own line must not swallow what it said: the
  // Spawner carries scripts, so "ready on next Play" is the difference between a
  // creator waiting a beat and a creator filing a bug.
  it('keeps what the placement itself had to report', async () => {
    await uiAddSpawnerFor('512')
    expect(state.saveStatus).toContain('rebuilding in the background')
  })

  // The prefab picker the creator is about to open renders as flat text when the
  // project holds nothing to spawn, so the dead end has to be named before it.
  it('says what to do first when the project has nothing to spawn yet', async () => {
    await uiAddSpawnerFor('512')
    expect(state.saveStatus).toContain('nothing to spawn yet')

    storeItems.push({ folder: 'custom/zombie', data: created.data })
    await uiAddSpawnerFor('512')
    expect(state.saveStatus).not.toContain('nothing to spawn yet')
  })

  it('does nothing when the entity is gone', async () => {
    expect(await uiAddSpawnerFor('999')).toBeNull()
    expect(history.batches).toEqual([])
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

  // The registry compiles out of the folders: a deleted folder that stays in
  // src/scripts/spawnables.ts is a dangling import in generated code, and a
  // renamed one is a dangling alias — both break the creator's build silently.
  it('regenerates the registry after a delete and after a rename', async () => {
    storeItems.length = 0
    storeItems.push({ folder: 'custom/bench', data: { ...created.data, id: 'b1' } })
    state.snapshot = {}

    await uiDeletePrefab('custom/bench')
    expect(regen.count).toBe(1)

    await uiRenamePrefab('custom/bench', 'Fancy Bench')
    expect(regen.count).toBe(2)
  })

  // A creator's own script can import from the folder being deleted (the zone
  // card scaffolds exactly that). Deleting anyway is allowed — but silently is
  // not: the status has to name the scripts that will now break the build.
  it('names the scripts that still import from a deleted folder', async () => {
    storeItems.length = 0
    storeItems.push({ folder: 'custom/sit_spot', data: { ...created.data, id: 'sit1' } })
    state.snapshot = {}
    projectFiles.list = ['src/scripts/reaction.ts', 'src/scripts/unrelated.ts', 'assets/x.glb']
    projectFiles.texts.set(
      'src/scripts/reaction.ts',
      "import { SitSpot } from '../../custom/sit_spot/scripts/sit-spot'"
    )
    projectFiles.texts.set('src/scripts/unrelated.ts', "import { engine } from '@dcl/sdk/ecs'")

    await uiDeletePrefab('custom/sit_spot')

    expect(state.saveStatus).toContain('reaction.ts')
    expect(state.saveStatus).toContain('will break the build')
    expect(state.saveStatus).not.toContain('unrelated.ts')
  })
})
