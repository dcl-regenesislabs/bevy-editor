import { describe, it, expect, vi, beforeEach } from 'vitest'

// Turning Spawnable on or off is a write whose only visible trace is a card in a
// tab that may not even be open. The reveal is what gives the write somewhere to
// land, so it is asserted here rather than left to the panel.

// hoisted: the module factories below run before this file's own consts exist
const { state, reveal, refresh, readFolder } = vi.hoisted(() => ({
  state: { assetBusy: false, saveStatus: '' },
  reveal: vi.fn<(folder: string) => void>(),
  refresh: vi.fn(async () => []),
  readFolder: vi.fn(async () => ({
    folder: 'custom/zombie',
    data: { id: 'z1', name: 'Zombie', category: 'custom', tags: [] },
    composite: { version: 1, components: [] }
  }))
}))

vi.mock('@scene/state', () => ({ state }))
vi.mock('../panels/prefab-store', () => ({ refreshPrefabs: refresh, revealPrefab: reveal }))
vi.mock('../engine/datalayer', () => ({
  dataLayerListFiles: async () => [],
  dataLayerReadFile: async () => {
    throw new Error('no such file')
  },
  dataLayerSaveFile: async () => {}
}))
vi.mock('../prefabs/storage', () => ({ readPrefabFolder: readFolder, writeJsonFile: async () => {} }))
vi.mock('../prefabs/generate', () => ({
  prefabScriptPaths: () => [],
  readRuntimeMasters: async () => ({}),
  regenerateSpawnables: async () => ({ problems: [], blocked: false, written: true, attached: false, vendored: [] }),
  vendorRegistryRuntime: async () => ({ problems: [] })
}))

import { uiSetSpawnable } from './spawnables'

beforeEach(() => {
  reveal.mockClear()
  refresh.mockClear()
  state.assetBusy = false
  state.saveStatus = ''
})

describe('uiSetSpawnable', () => {
  it('flashes the card once the write has landed, turning it on', async () => {
    await uiSetSpawnable('custom/zombie', { max: 12, instancing: 'onDemand' })

    expect(reveal).toHaveBeenCalledWith('custom/zombie')
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(reveal.mock.invocationCallOrder[0])
    expect(state.saveStatus).toContain('12')
  })

  it('flashes the card turning it off too, and says what is left', async () => {
    await uiSetSpawnable('custom/zombie', null)

    expect(reveal).toHaveBeenCalledWith('custom/zombie')
    expect(state.saveStatus).toContain('no longer spawnable')
    expect(state.saveStatus).toContain('place by hand')
  })

  it('never flashes a card for a write that threw', async () => {
    readFolder.mockRejectedValueOnce(new Error('unreadable'))

    await uiSetSpawnable('custom/zombie', null)

    expect(reveal).not.toHaveBeenCalled()
    expect(state.assetBusy).toBe(false)
  })
})
