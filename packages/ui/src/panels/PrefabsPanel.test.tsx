import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { PrefabsPanel } from './PrefabsPanel'
import { prefabStore, type PrefabEntry } from './prefab-store'
import { consumerStore } from '../prefabs/consumers'
import { PLACEMENT_LABEL } from '../prefabs/placement'
import { NO_PREFABS_YET, OPEN_SHEET_LABEL } from '../prefabs/copy'
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
  prefabStore.sheetFor = null
  consumerStore.scripts = {}
  consumerStore.loaded = true
  placePrefab.mockClear()
})

afterEach(() => {
  prefabStore.items = []
  prefabStore.loaded = false
  prefabStore.created = null
  prefabStore.sheetFor = null
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

  it('opens the property sheet from the created notice, and puts the notice away', () => {
    prefabStore.items = [entry({ spawnable: { max: 12, instancing: 'onDemand' } })]
    prefabStore.created = {
      folder: 'custom/zombie',
      name: 'Zombie',
      placement: 'unplaced'
    }
    const view = panel()
    view.click(view.byText(OPEN_SHEET_LABEL, '.eui-link'))
    expect(view.find('.eui-prefab-sheet')).not.toBeNull()
    expect(prefabStore.created).toBeNull()
    view.unmount()
  })

  it('opens the sheet a scene check asked for, and clears the request', () => {
    prefabStore.items = [entry()]
    prefabStore.sheetFor = 'custom/zombie'
    const view = panel()
    expect(view.find('.eui-prefab-sheet')).not.toBeNull()
    expect(prefabStore.sheetFor).toBeNull()
    view.unmount()
  })

  it('drops a sheet request for a folder this project no longer has', () => {
    prefabStore.sheetFor = 'custom/gone'
    const view = panel()
    expect(view.find('.eui-prefab-sheet')).toBeNull()
    expect(prefabStore.sheetFor).toBeNull()
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

  it('carries no runtime chips on a prefab that is not spawnable', () => {
    prefabStore.items = [entry()]
    const view = panel()
    expect(view.find('.eui-prefab-card .eui-prefab-chips')).toBeNull()
    view.unmount()
  })

  it('shows the cap, the placement and the pending guarantee on a spawnable card', () => {
    prefabStore.items = [entry({ spawnable: { max: 24, instancing: 'onDemand' } })]
    const view = panel()
    const chips = view.all('.eui-prefab-card .eui-prefab-chips .eui-ds-chip').map((c) => c.textContent ?? '')
    expect(chips.some((c) => c.includes('24'))).toBe(true)
    expect(chips).toContain(PLACEMENT_LABEL.unplaced)
    expect(chips).toHaveLength(3)
    view.unmount()
  })

  it('marks a prefab that needs the auth-server SDK', () => {
    prefabStore.items = [entry({ requiresSdk: 'auth-server' })]
    const view = panel()
    const chip = view.all('.eui-prefab-card .eui-ds-chip').find((c) => c.textContent === 'Server')
    expect(chip).not.toBeUndefined()
    expect(chip?.getAttribute('data-tip')).toBeTruthy()
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

  it('reaches the property sheet from the card’s ⋯ button, without placing a copy', () => {
    prefabStore.items = [entry({ spawnable: { max: 8, instancing: 'onDemand' } })]
    const view = panel()
    const more = view.find('.eui-prefab-card .eui-prefab-more')
    expect(more).not.toBeNull()
    view.click(more)
    expect(placePrefab).not.toHaveBeenCalled()
    view.click(view.byText('Placement & spawning…', '.eui-menu-item'))
    expect(view.find('.eui-prefab-sheet')).not.toBeNull()
    view.unmount()
  })

  it('points at the ⋯ menu on a project card, since nothing else does', () => {
    prefabStore.items = [entry()]
    const view = panel()
    expect(view.find('.eui-prefab-card')?.getAttribute('data-tip')).toContain('⋯')
    expect(view.find('.eui-prefab-card')?.getAttribute('tabindex')).toBe('0')
    view.unmount()
  })

  it('opens the property sheet from the card menu, not from the click that places', () => {
    prefabStore.items = [entry({ spawnable: { max: 8, instancing: 'onDemand' } })]
    const view = panel()
    const card = view.find('.eui-prefab-card')
    run(() => {
      card?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    const open = view.byText('Placement & spawning…', '.eui-menu-item')
    expect(open).not.toBeNull()
    view.click(open)
    expect(view.find('.eui-prefab-sheet')).not.toBeNull()
    view.unmount()
  })
})
