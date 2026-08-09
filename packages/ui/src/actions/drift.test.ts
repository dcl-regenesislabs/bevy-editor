import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INERT_COMPONENT, TRANSFORM_COMPONENT } from '../prefabs/format'

// "Update from prefab" deletes the instance and places the folder again. Anything
// the instance owned and the folder does not has to be carried across by hand —
// and its placement state is exactly that: the ghost markers are excluded from a
// prefab on purpose, so nothing brings them back.

// hoisted: the module factories below run before this file's own consts exist
const { state } = vi.hoisted(() => ({
  state: {
    snapshot: {} as Record<string, Record<string, unknown>>,
    assetBusy: false,
    saveStatus: ''
  }
}))

const setGhost = vi.fn<(entityId: string, on: boolean) => Promise<void>>(async () => {})
const deleted = vi.fn<(entityId: string) => Promise<void>>(async () => {})
const placed = vi.fn(async () => ({
  rootId: '600',
  warnings: [] as string[],
  hasScripts: false,
  data: { id: 'rig-uuid', name: 'Player Rig', category: 'custom', tags: [] }
}))

vi.mock('@scene/state', () => ({
  state,
  isRuntimeEntity: () => false,
  provenanceBaseline: () => ({})
}))
vi.mock('@scene/inspector', () => ({ writeComponent: async () => {} }))
vi.mock('@scene/custom-components', () => ({ NAME_COMPONENT: 'core-schema::Name' }))
vi.mock('../engine/datalayer', () => ({
  dataLayerReadFile: async () => '',
  dataLayerReadFileBytes: async () => new Uint8Array(),
  dataLayerSaveFile: async () => {},
  dataLayerSaveFileBytes: async () => {}
}))
vi.mock('../gltf-refs', () => ({ gltfExternalUris: () => [] }))
vi.mock('../prefabs/capture', () => ({
  authoredOnly: (snapshot: unknown) => snapshot,
  captureSelectionAsPrefab: () => ({ composite: { version: 1, components: [] }, resources: [], warnings: [] })
}))
vi.mock('../prefabs/drift', () => ({
  instanceDrift: () => ({ changed: [] }),
  realignCapturedResources: (composite: unknown, resources: unknown) => ({ composite, resources })
}))
vi.mock('../prefabs/instantiate', () => ({ instantiatePrefab: () => placed() }))
vi.mock('../prefabs/storage', () => ({
  readPrefabFolder: async () => ({
    folder: 'custom/player_rig',
    data: { id: 'rig-uuid', name: 'Player Rig', category: 'custom', tags: [] },
    composite: { version: 1, components: [] }
  }),
  writeJsonFile: async () => {},
  pointAtProjectRuntime: (text: string) => text
}))
vi.mock('../prefabs/generate', () => ({ regenerateSpawnables: async () => ({}) }))
vi.mock('../panels/prefab-store', () => ({ refreshPrefabs: async () => {} }))
vi.mock('../core/autosave', () => ({ flushPendingSave: async () => ({ pending: false, ok: true }) }))
vi.mock('./entities', () => ({ uiDeleteEntityRecursive: (id: string) => deleted(id) }))
vi.mock('./spawned-only', () => ({ uiSetSpawnedOnly: (id: string, on: boolean) => setGhost(id, on) }))

import { uiUpdateInstanceFromPrefab } from './drift'

const TRANSFORM = { position: { x: 4, y: 0, z: 8 } }

beforeEach(() => {
  setGhost.mockClear()
  deleted.mockClear()
  state.snapshot = {}
  state.saveStatus = ''
})

describe('update from prefab', () => {
  // The chip flipping from "Editing only" to "In the game" is not cosmetic: the
  // anchor's scripts start running in the built scene next to the clones.
  it('brings an editing-only anchor back editing-only', async () => {
    state.snapshot = {
      '512': { [TRANSFORM_COMPONENT]: TRANSFORM, [INERT_COMPONENT]: {}, 'inspector::Hide': { value: true } }
    }

    const result = await uiUpdateInstanceFromPrefab('custom/player_rig', '512')

    expect(result.ok).toBe(true)
    expect(deleted).toHaveBeenCalledWith('512')
    expect(setGhost).toHaveBeenCalledWith('600', true)
  })

  it('leaves an ordinary instance placed in the scene', async () => {
    state.snapshot = { '512': { [TRANSFORM_COMPONENT]: TRANSFORM } }

    await uiUpdateInstanceFromPrefab('custom/player_rig', '512')

    expect(setGhost).not.toHaveBeenCalled()
  })
})
