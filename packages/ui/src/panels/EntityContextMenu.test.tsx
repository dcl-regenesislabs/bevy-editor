import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { state, type Snapshot } from '@scene/state'
import { EntityContextMenu } from './EntityContextMenu'
import { SUB_RESET, SUB_SAVE_OVER, TIP_IS_INSTANCE, TIP_PREFAB, TIP_SPAWNER, TIP_SPAWNER_SPAWNED } from './entity-menu'
import { mount } from '../test/render'
import { prefabStore } from './prefab-store'
import { uiAddSpawnerFor } from '../actions/prefabs'
import { uiSaveOverPrefab, uiUpdateInstanceFromPrefab } from '../actions/drift'

vi.mock('../actions/entities', () => ({
  uiAddEntity: vi.fn(),
  uiClearParent: vi.fn(),
  uiDeleteEntity: vi.fn(),
  uiDeleteEntityRecursive: vi.fn(),
  uiDeleteEntityReparent: vi.fn(),
  uiDuplicateEntity: vi.fn(),
  uiReparentToActive: vi.fn()
}))
vi.mock('../actions/selection', () => ({ uiFocusEntity: vi.fn() }))
vi.mock('../actions/prefabs', () => ({
  uiAddSpawnerFor: vi.fn(async () => '600'),
  uiCreatePrefabFromSelection: vi.fn()
}))
vi.mock('../actions/drift', () => ({
  uiSaveOverPrefab: vi.fn(async () => ({ ok: true, warnings: [] })),
  uiUpdateInstanceFromPrefab: vi.fn(async () => ({ ok: true, warnings: [] }))
}))

const CREATE = 'Create prefab…'
const SPAWNER = 'Add a spawner'

const row = (name: string): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: {}
})

function menu(
  isCode: boolean,
  handlers: { onCreatePrefab?: () => void; assetId?: string | null; spawnedOnly?: boolean } = {}
): ReturnType<typeof mount> {
  return mount(
    <EntityContextMenu
      ctx={{ x: 10, y: 10, id: '512' }}
      isCode={isCode}
      assetId={handlers.assetId ?? null}
      spawnedOnly={handlers.spawnedOnly ?? false}
      onClose={() => {}}
      onRename={() => {}}
      onCreatePrefab={handlers.onCreatePrefab ?? (() => {})}
    />
  )
}

const itemFor = (view: ReturnType<typeof mount>, label: string): HTMLElement | undefined =>
  view.all('.eui-menu-item').find((el) => el.textContent?.startsWith(label) === true)

beforeEach(() => {
  prefabStore.items = [
    { folder: 'custom/zombie', data: { id: 'z1', name: 'Zombie', category: 'custom', tags: [] }, hasGuide: false }
  ]
  state.status = 'ready'
  state.snapshot = { '512': row('Bench') } as Snapshot
  state.selected = new Set(['512'])
})

afterEach(() => {
  state.snapshot = {}
  state.selected = new Set<string>()
})

describe('EntityContextMenu create items', () => {
  it('offers the one create gesture on a scene entity, explained in the row', () => {
    const view = menu(false)
    const item = itemFor(view, CREATE)
    expect(item?.hasAttribute('disabled')).toBe(false)
    expect(item?.querySelector('.sub')?.textContent?.length ?? 0).toBeGreaterThan(20)
    expect(view.text()).not.toContain('Create spawnable prefab')
    view.unmount()
  })

  it('refuses to capture a prefab copy, and points at the prefab instead', () => {
    const view = menu(false, { assetId: 'z1' })
    const item = itemFor(view, CREATE)
    expect(item?.hasAttribute('disabled')).toBe(true)
    expect(item?.getAttribute('data-tip')).toBe(TIP_IS_INSTANCE)
    view.unmount()
  })

  it('disables it on a code entity and says why', () => {
    const view = menu(true)
    const item = itemFor(view, CREATE)
    expect(item?.hasAttribute('disabled')).toBe(true)
    expect(item?.getAttribute('data-tip')).toBe(TIP_PREFAB)
    view.unmount()
  })

  it('routes the one create item to its callback', () => {
    const onCreatePrefab = vi.fn()
    const view = menu(false, { onCreatePrefab })
    view.click(itemFor(view, CREATE) ?? null)
    expect(onCreatePrefab).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('keeps the create labels the same shape whatever the selection size', () => {
    const single = menu(false)
    const labels = single.all('.eui-menu-item .lbl').map((el) => el.textContent)
    single.unmount()
    state.selected = new Set(['512', '513'])
    const multi = menu(false)
    expect(multi.all('.eui-menu-item .lbl').map((el) => el.textContent)).toEqual(labels)
    multi.unmount()
  })

  it('treats a mark pointing at a deleted prefab as no instance at all', () => {
    const view = menu(false, { assetId: 'gone' })
    const item = view.all('.eui-menu-item').find((el) => el.textContent?.startsWith('Create prefab') === true)
    expect(item?.hasAttribute('disabled')).toBe(false)
    const move = view.all('.eui-menu-item').find((el) => el.textContent?.startsWith('Only when spawned') === true)
    expect(move?.querySelector('.sub')?.textContent).toContain('Make it a prefab')
    view.unmount()
  })

  it('promises the prefab when the entity is not one yet', () => {
    const view = menu(false)
    const item = view.all('.eui-menu-item').find((el) => el.textContent?.startsWith('Only when spawned') === true)
    expect(item?.querySelector('.sub')?.textContent).toContain('Make it a prefab')
    view.unmount()

    const instance = menu(false, { assetId: 'z1' })
    const row = instance.all('.eui-menu-item').find((el) => el.textContent?.startsWith('Only when spawned') === true)
    expect(row?.querySelector('.sub')?.textContent).not.toContain('Make it a prefab')
    instance.unmount()
  })

  // Spawning is the answer to "how does this appear while the game runs", which
  // is the question the two rows above it raise — so it sits with them, not down
  // among the structural edits.
  it('offers the spawner gesture directly under Create prefab', () => {
    const view = menu(false)
    const labels = view.all('.eui-menu-item .lbl').map((el) => el.textContent)
    expect(labels.indexOf(SPAWNER)).toBe(labels.indexOf(CREATE) + 1)
    view.unmount()
  })

  it('explains the spawner in the row, and hands the gesture the entity', () => {
    const view = menu(false)
    const item = itemFor(view, SPAWNER)
    expect(item?.hasAttribute('disabled')).toBe(false)
    expect(item?.querySelector('.sub')?.textContent).toContain('while the game runs')
    view.click(item ?? null)
    expect(uiAddSpawnerFor).toHaveBeenCalledWith('512')
    view.unmount()
  })

  it('refuses to spawn from a code entity and says why', () => {
    const view = menu(true)
    const item = itemFor(view, SPAWNER)
    expect(item?.hasAttribute('disabled')).toBe(true)
    expect(item?.getAttribute('data-tip')).toBe(TIP_SPAWNER)
    view.unmount()
  })

  // A spawner riding a spawned copy never starts — the gesture is refused where
  // it would silently do nothing, and the tip points at the scene instead.
  it('refuses the spawner on a spawn-only entity and says where it works', () => {
    const view = menu(false, { spawnedOnly: true })
    const item = itemFor(view, SPAWNER)
    expect(item?.hasAttribute('disabled')).toBe(true)
    expect(item?.getAttribute('data-tip')).toBe(TIP_SPAWNER_SPAWNED)
    view.unmount()
  })

  it('offers the move between the two folders, named after them', () => {
    const view = menu(false)
    const item = view.all('.eui-menu-item').find((el) => el.textContent?.startsWith('Only when spawned') === true)
    expect(item).not.toBeUndefined()
    view.unmount()

    const spawned = menu(false, { spawnedOnly: true })
    const back = spawned.all('.eui-menu-item').find((el) => el.textContent?.startsWith('Show from the start') === true)
    expect(back).not.toBeUndefined()
    spawned.unmount()
  })
})

// The two prefab-sync verbs live here on purpose, and only here: nothing
// surfaces a differing copy automatically, so the right-click menu is where a
// creator reconciles a copy with its prefab.
describe('EntityContextMenu prefab sync verbs', () => {
  const SAVE = 'Save over prefab'
  const RESET = 'Reset to prefab'

  it('offers both verbs on a prefab copy, neither on a plain entity', () => {
    const plain = menu(false)
    expect(itemFor(plain, SAVE)).toBeUndefined()
    expect(itemFor(plain, RESET)).toBeUndefined()
    plain.unmount()

    const view = menu(false, { assetId: 'z1' })
    expect(itemFor(view, SAVE)).not.toBeUndefined()
    expect(itemFor(view, RESET)).not.toBeUndefined()
    view.unmount()
  })

  it('offers neither when the mark points at a deleted prefab', () => {
    const view = menu(false, { assetId: 'gone' })
    expect(itemFor(view, SAVE)).toBeUndefined()
    expect(itemFor(view, RESET)).toBeUndefined()
    view.unmount()
  })

  it('says in each row what gets overwritten', () => {
    const view = menu(false, { assetId: 'z1' })
    expect(itemFor(view, SAVE)?.querySelector('.sub')?.textContent).toBe(SUB_SAVE_OVER)
    expect(itemFor(view, RESET)?.querySelector('.sub')?.textContent).toBe(SUB_RESET)
    view.unmount()
  })

  it('hands each verb the prefab folder and the clicked entity', () => {
    const view = menu(false, { assetId: 'z1' })
    view.click(itemFor(view, SAVE) ?? null)
    expect(uiSaveOverPrefab).toHaveBeenCalledWith('custom/zombie', '512')
    view.click(itemFor(view, RESET) ?? null)
    expect(uiUpdateInstanceFromPrefab).toHaveBeenCalledWith('custom/zombie', '512')
    view.unmount()
  })
})
