import { beforeEach, describe, expect, it, vi } from 'vitest'

// The placement gesture, whoever asked for it: one download however many copies
// land, one createEntities call, one undo step, and names that don't collide.

const { state, calls, specs, downloads, createdIds, revealInTree } = vi.hoisted(() => ({
  state: { snapshot: {} as Record<string, Record<string, unknown>>, assetBusy: false, saveStatus: '' },
  calls: { creates: 0, undoSteps: [] as string[][] },
  specs: [] as Array<Record<string, unknown>>,
  downloads: [] as string[],
  createdIds: { next: 512 },
  revealInTree: vi.fn()
}))

vi.mock('@scene/state', () => ({ state, setSelected: vi.fn() }))
vi.mock('@scene/custom-components', () => ({ NAME_COMPONENT: 'core-schema::Name' }))
vi.mock('@scene/inspector', () => ({
  createEntities: async (list: Array<Record<string, unknown>>) => {
    calls.creates++
    specs.push(...list)
    return list.map(() => createdIds.next++)
  }
}))
vi.mock('../core/history', () => ({
  pushEntityCreate: (ids: string[]) => calls.undoSteps.push(ids),
  withHistorySuppressed: async <T>(fn: () => Promise<T>) => await fn()
}))
vi.mock('../panels/reveal', () => ({ revealInTree }))
vi.mock('../engine/bus', () => ({ sendToScene: vi.fn() }))
vi.mock('./selection', () => ({
  syncSelectionToScene: vi.fn(),
  ensureTransformTool: vi.fn(),
  focusPlaced: vi.fn()
}))
vi.mock('../assets', () => ({
  importCatalogFile: async (asset: { id: string }) => {
    downloads.push(asset.id)
    return `models/${asset.id}.glb`
  },
  // the real one reads the live snapshot; here the batch's own set is what matters
  uniqueEntityName: (base: string, alsoTaken?: ReadonlySet<string>) => {
    if (alsoTaken === undefined || !alsoTaken.has(base)) return base
    for (let i = 2; ; i++) if (!alsoTaken.has(`${base} ${i}`)) return `${base} ${i}`
  },
  projectFiles: async () => [],
  loadModelCatalog: async () => [],
  modelById: vi.fn(),
  importModel: vi.fn(),
  dropPosition: vi.fn(),
  loadLocalModels: vi.fn(),
  placeLocalModel: vi.fn(),
  uploadModel: vi.fn(),
  missingModelRefs: vi.fn()
}))

import { uiPlaceAsset } from './assets'
import type { ResolvedAsset } from '../place-asset'

const CATALOG_MODEL: ResolvedAsset = {
  kind: 'model',
  name: 'Pine Tree',
  ref: '',
  catalog: { id: 'a1', name: 'Pine Tree' } as never
}

const nameOf = (spec: Record<string, unknown>): string =>
  (spec['core-schema::Name'] as { value: string }).value

describe('placing an asset', () => {
  beforeEach(() => {
    calls.creates = 0
    calls.undoSteps.length = 0
    specs.length = 0
    downloads.length = 0
    createdIds.next = 512
    state.saveStatus = ''
  })

  it('downloads a catalog asset once for the whole batch and creates it in one call', async () => {
    const ids = await uiPlaceAsset(CATALOG_MODEL, [
      { position: { x: 1, y: 0, z: 1 } },
      { position: { x: 4, y: 0, z: 4 } },
      { position: { x: 8, y: 0, z: 8 } }
    ])

    expect(ids).toEqual(['512', '513', '514'])
    expect(downloads).toEqual(['a1'])
    expect(calls.creates).toBe(1)
    // the download decides the path, so every copy points at what landed
    for (const spec of specs) {
      expect(spec.GltfContainer).toEqual({ src: 'models/a1.glb', visibleMeshesCollisionMask: 3 })
    }
  })

  it('gives each copy its own name', async () => {
    await uiPlaceAsset(CATALOG_MODEL, [{}, {}, {}])
    expect(specs.map(nameOf)).toEqual(['Pine Tree', 'Pine Tree 2', 'Pine Tree 3'])
  })

  it('takes a name the caller chose over the asset\'s own', async () => {
    await uiPlaceAsset(CATALOG_MODEL, [{}], { name: 'Oak by the gate' })
    expect(specs.map(nameOf)).toEqual(['Oak by the gate'])
  })

  it('records the whole gesture as one undo step', async () => {
    await uiPlaceAsset(CATALOG_MODEL, [{}, {}])
    expect(calls.undoSteps).toEqual([['512', '513']])
  })

  it('skips the download for something already in the project', async () => {
    await uiPlaceAsset({ kind: 'audio-file', name: 'Ambient', ref: 'sounds/a.mp3' }, [{}], {
      settings: { loop: true, volume: 0.6 }
    })
    expect(downloads).toEqual([])
    expect(specs[0].AudioSource).toEqual({
      audioClipUrl: 'sounds/a.mp3',
      playing: true,
      loop: true,
      volume: 0.6
    })
  })

  it('does nothing at all when there is nowhere to put it', async () => {
    expect(await uiPlaceAsset(CATALOG_MODEL, [])).toEqual([])
    expect(calls.creates).toBe(0)
    expect(calls.undoSteps).toEqual([])
  })

  // A failed download must not leave a half-placed scene or a stuck busy flag.
  it('reports a failure and records no undo step', async () => {
    const broken: ResolvedAsset = { ...CATALOG_MODEL, catalog: { id: 'boom' } as never }
    const push = downloads.push.bind(downloads)
    downloads.push = () => {
      throw new Error('HTTP 404')
    }
    try {
      expect(await uiPlaceAsset(broken, [{}])).toEqual([])
    } finally {
      downloads.push = push
    }
    expect(calls.undoSteps).toEqual([])
    expect(state.saveStatus).toContain('place failed')
    expect(state.assetBusy).toBe(false)
  })
})
