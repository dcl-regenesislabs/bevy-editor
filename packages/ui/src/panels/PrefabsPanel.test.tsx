import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { PrefabsPanel } from './PrefabsPanel'
import { prefabStore, type PrefabEntry } from './prefab-store'
import { consumerStore } from '../prefabs/consumers'
import { NO_PREFABS_YET } from '../prefabs/copy'
import type { PrefabData } from '../prefabs/format'
import { mount, run } from '../test/render'

const { placePrefab } = vi.hoisted(() => ({ placePrefab: vi.fn(async (_id: string): Promise<void> => {}) }))

vi.mock('../actions/prefabs', () => ({
  uiDeleteLibraryPrefab: vi.fn(),
  uiDeletePrefab: vi.fn(),
  uiPlaceLibraryPrefab: vi.fn(),
  uiPlacePrefab: placePrefab,
  uiRenamePrefab: vi.fn(),
  uiSavePrefabToLibrary: vi.fn()
}))

const LONG_NAME = 'Zombie horde spawner with a name nobody should have typed but did'

function entry(over: Partial<PrefabData> & { folder?: string; thumbnail?: string } = {}): PrefabEntry {
  const { folder = 'custom/zombie', thumbnail, ...data } = over
  return {
    folder,
    thumbnail,
    hasGuide: false,
    data: { id: folder, name: 'Zombie', category: 'custom', tags: [], ...data }
  }
}

function panel(): ReturnType<typeof mount> {
  return mount(<PrefabsPanel onView={() => {}} onCreatePrefab={() => {}} />)
}

beforeEach(() => {
  state.status = 'ready'
  state.snapshot = {}
  state.assetBusy = false
  state.selected = new Set<string>()
  prefabStore.items = []
  prefabStore.library = []
  prefabStore.loading = false
  prefabStore.loaded = true
  prefabStore.error = null
  prefabStore.libraryError = null
  prefabStore.created = null
  consumerStore.scripts = {}
  consumerStore.loaded = true
  placePrefab.mockClear()
})

afterEach(() => {
  prefabStore.items = []
  prefabStore.loaded = false
  prefabStore.created = null
  consumerStore.loaded = false
})

describe('PrefabsPanel cards', () => {
  it('says the library is empty instead of showing a blank grid', () => {
    const view = panel()
    expect(view.find('.eui-empty')?.textContent).toBeTruthy()
    expect(view.all('.eui-prefab-card')).toHaveLength(0)
    view.unmount()
  })

  it('names the gesture that makes a prefab, and offers the tab it happens in', () => {
    const seen: string[] = []
    const view = mount(<PrefabsPanel onView={(v) => seen.push(v)} onCreatePrefab={() => {}} />)
    expect(view.text()).toContain(NO_PREFABS_YET)
    view.click(view.byText('Go to the Scene tab', '.eui-link'))
    expect(seen).toEqual(['scene'])
    view.unmount()
  })

  it('draws the card menu as an icon rather than a text glyph', () => {
    prefabStore.items = [entry()]
    const view = panel()
    expect(view.find('.eui-prefab-more svg')).not.toBeNull()
    view.unmount()
  })

  it('names the prefab a create just made, and what it does while the game runs', () => {
    prefabStore.items = [entry({ spawnable: { max: 12, instancing: 'onDemand' } })]
    prefabStore.created = {
      folder: 'custom/zombie',
      name: 'Zombie',
      placement: 'unplaced'
    }
    const view = panel()
    const created = view.find('.eui-prefab-created')
    expect(created?.textContent).toContain('Zombie')
    expect(created?.textContent).toContain('spawn copies')
    expect(created?.querySelector('.path')?.textContent).toBe('custom/zombie')
    view.unmount()
  })



  it('drops a sheet request for a folder this project no longer has', () => {
    const view = panel()
    expect(view.find('.eui-prefab-sheet')).toBeNull()
    view.unmount()
  })

  it('offers the save-selection tile, disabled until something is selected', () => {
    const view = panel()
    const tile = view.find('.eui-prefab-new')
    expect(tile?.hasAttribute('disabled')).toBe(true)
    expect(tile?.getAttribute('data-tip')).toBeTruthy()
    run(() => {
      state.selected = new Set(['512'])
    })
    expect(view.find('.eui-prefab-new')?.hasAttribute('disabled')).toBe(false)
    view.unmount()
  })

  it('falls back to the prefab glyph when a folder has no thumbnail', () => {
    prefabStore.items = [entry()]
    const view = panel()
    const card = view.find('.eui-prefab-card')
    expect(card?.querySelector('img')).toBeNull()
    expect(card?.querySelector('.glyph svg')).not.toBeNull()
    view.unmount()
  })

  it('renders the thumbnail when there is one', () => {
    prefabStore.items = [entry({ thumbnail: 'blob:thumb' })]
    const view = panel()
    expect(view.find('.eui-prefab-card img')?.getAttribute('src')).toBe('blob:thumb')
    view.unmount()
  })

  it('keeps a long name inside the tile and still says the whole thing on hover', () => {
    prefabStore.items = [entry({ name: LONG_NAME })]
    const view = panel()
    const card = view.find('.eui-prefab-card')
    expect(card?.querySelector('.name')?.textContent).toBe(LONG_NAME)
    expect(card?.getAttribute('data-tip')).toContain(LONG_NAME)
    view.unmount()
  })

  it('says whether a prefab has a copy in the scene, never a spawnable flag', () => {
    prefabStore.items = [entry()]
    const view = panel()
    const chips = view.all('.eui-prefab-card .eui-prefab-chips .eui-ds-chip').map((c) => c.textContent ?? '')
    expect(chips).toContain('Not in the scene')
    expect(chips.some((c) => c.includes('Spawnable'))).toBe(false)
    view.unmount()
  })

  it('says nothing about the SDK on a card — the install is offered when it is placed', () => {
    prefabStore.items = [entry({ requiresSdk: 'auth-server' })]
    const view = panel()
    const chips = view.all('.eui-prefab-card .eui-ds-chip').map((c) => c.textContent ?? '')
    expect(chips).not.toContain('Server')
    view.unmount()
  })

  it('surfaces a read failure with a retry rather than an empty tab', () => {
    prefabStore.error = 'the prefabs folder is unreadable'
    const view = panel()
    expect(view.text()).toContain('the prefabs folder is unreadable')
    expect(view.byText('Retry', 'button')).not.toBeNull()
    view.unmount()
  })

  it('answers an unmatched search instead of leaving the grid blank', () => {
    prefabStore.items = [entry()]
    const view = panel()
    view.type(view.find('.eui-ds-search input'), 'nothing-matches-this', false)
    expect(view.all('.eui-prefab-card')).toHaveLength(0)
    expect(view.text()).toContain('No prefabs match')
    view.unmount()
  })


  it('points at the ⋯ menu on a project card, since nothing else does', () => {
    prefabStore.items = [entry()]
    const view = panel()
    expect(view.find('.eui-prefab-card')?.getAttribute('data-tip')).toContain('⋯')
    expect(view.find('.eui-prefab-card')?.getAttribute('tabindex')).toBe('0')
    view.unmount()
  })

})
