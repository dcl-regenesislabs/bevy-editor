import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uiSyncSpawnSpot, uiSyncSpawnSpotFromSnapshot } from './spawn-spot'
import type { ScriptParam } from '../script/parser'

// The 'custom spot' gesture is a param change with a visible consequence: the
// marker child appears carrying the picked prefab's model, selected so the
// gizmos land on it. These tests pin the rules that make it safe — only spawner
// scripts trigger it, an existing marker (uniquified names included) is adopted
// rather than duplicated, the model follows the spawn param while custom is
// active, and the assistant's executor path lands the same marker the
// inspector's dropdown does.

const { state, created, written, selected } = vi.hoisted(() => ({
  state: {
    snapshot: {} as Record<string, Record<string, unknown> | undefined>,
    activeEntity: null as string | null,
    saveStatus: ''
  },
  created: [] as Array<Record<string, unknown>>,
  written: [] as Array<{ id: string; name: string; json: string }>,
  selected: [] as string[][]
}))

vi.mock('@scene/state', () => ({
  state,
  setSelected: (ids: string[]) => selected.push(ids)
}))
vi.mock('@scene/inspector', () => ({
  createEntities: async (specs: Array<Record<string, unknown>>) => {
    created.push(...specs)
    return [777]
  },
  writeComponent: async (id: string, name: string, json: string) => {
    written.push({ id, name, json })
  }
}))
vi.mock('@scene/custom-components', () => ({ NAME_COMPONENT: 'core-schema::Name' }))
vi.mock('../assets', () => ({
  uniqueEntityName: (base: string) => `${base} 2`
}))
vi.mock('../panels/prefab-store', () => ({
  prefabStore: {
    items: [{ folder: 'custom/bed', data: { id: 'bed-1', name: 'Bed', category: 'custom', tags: [] } }]
  }
}))
vi.mock('../prefabs/storage', () => ({
  readPrefabFolder: async () => ({
    data: { id: 'bed-1', name: 'Bed', category: 'custom', tags: [] },
    composite: {
      version: 1,
      components: [
        {
          name: 'core::GltfContainer',
          data: { '0': { json: { src: '{assetPath}/Bed.glb' } } }
        }
      ]
    }
  })
}))
vi.mock('../panels/reveal', () => ({ revealInTree: () => {} }))
vi.mock('./selection', () => ({ syncSelectionToScene: () => {}, ensureTransformTool: () => {} }))

const SPAWNER = 'custom/spawner/scripts/spawner.ts'

const params = (where: string, spawn = 'bed-1'): Record<string, ScriptParam> => ({
  spawn: { type: 'prefab', value: spawn },
  where: { type: 'enum', value: where, options: [] }
})

const marker = (parent: number, name: string): Record<string, unknown> => ({
  Transform: { parent },
  'core-schema::Name': { value: name }
})

beforeEach(() => {
  state.snapshot = { '512': { Transform: { parent: 0 } } }
  state.activeEntity = '512'
  created.length = 0
  written.length = 0
  selected.length = 0
})

describe('uiSyncSpawnSpot', () => {
  it('materializes the marker with the prefab model when custom spot is picked', async () => {
    await uiSyncSpawnSpot('512', SPAWNER, ['where'], params('custom spot'), { aim: true })
    expect(created).toHaveLength(1)
    const spec = created[0]
    expect((spec['core-schema::Name'] as { value: string }).value).toBe('Spawn Spot 2')
    expect((spec.Transform as { parent: number }).parent).toBe(512)
    const gltf = spec.GltfContainer as { src: string; visibleMeshesCollisionMask: number }
    expect(gltf.src).toBe('custom/bed/Bed.glb')
    expect(gltf.visibleMeshesCollisionMask).toBe(0)
    expect(selected).toEqual([['777']])
  })

  it('adopts an existing marker — uniquified names included — instead of making a second one', async () => {
    state.snapshot['600'] = marker(512, 'Spawn Spot 3')
    await uiSyncSpawnSpot('512', SPAWNER, ['where'], params('custom spot'), { aim: true })
    expect(created).toHaveLength(0)
    expect(written).toHaveLength(1)
    expect(selected).toEqual([['600']])
  })

  it('swaps the marker model when spawn changes while custom, without stealing selection', async () => {
    state.snapshot['600'] = marker(512, 'Spawn Spot')
    await uiSyncSpawnSpot('512', SPAWNER, ['spawn'], params('custom spot'), { aim: true })
    expect(written).toHaveLength(1)
    expect(written[0].id).toBe('600')
    expect(written[0].name).toBe('GltfContainer')
    expect(JSON.parse(written[0].json).src).toBe('custom/bed/Bed.glb')
    expect(selected).toHaveLength(0)
  })

  it('does nothing for other params, other where values, or non-spawner scripts', async () => {
    await uiSyncSpawnSpot('512', SPAWNER, ['spawn'], params('at this spawner'))
    await uiSyncSpawnSpot('512', SPAWNER, ['hoverLabel'], params('custom spot'))
    await uiSyncSpawnSpot('512', 'src/scripts/mine.ts', ['where'], params('custom spot'))
    await uiSyncSpawnSpot('512', 'custom/spawner/scripts/runtime/spawner.ts', ['where'], params('custom spot'))
    expect(created).toHaveLength(0)
    expect(written).toHaveLength(0)
  })

  it('still makes the marker, empty, when no prefab is picked yet', async () => {
    await uiSyncSpawnSpot('512', SPAWNER, ['where'], params('custom spot', ''))
    expect(created).toHaveLength(1)
    expect((created[0].GltfContainer as { src: string }).src).toBe('')
  })
})

describe('uiSyncSpawnSpotFromSnapshot', () => {
  it('lands the marker from the assistant path by reading the spawner row back', async () => {
    state.snapshot['512'] = {
      Transform: { parent: 0 },
      'asset-packs::Script': {
        value: [{ path: SPAWNER, layout: JSON.stringify({ params: params('custom spot') }) }]
      }
    }
    await uiSyncSpawnSpotFromSnapshot('512', ['where'])
    expect(created).toHaveLength(1)
    expect(selected).toHaveLength(0)
  })

  it('does nothing for an entity with no spawner script', async () => {
    await uiSyncSpawnSpotFromSnapshot('512', ['where'])
    expect(created).toHaveLength(0)
  })
})
