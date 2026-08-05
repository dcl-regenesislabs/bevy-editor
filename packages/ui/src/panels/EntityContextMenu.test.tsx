import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { state, type Snapshot } from '@scene/state'
import { EntityContextMenu } from './EntityContextMenu'
import { TIP_PREFAB } from './entity-menu'
import { mount } from '../test/render'

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

const CREATE = 'Create prefab…'

const row = (name: string): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: {}
})

function menu(
  isCode: boolean,
  handlers: { onCreatePrefab?: () => void } = {}
): ReturnType<typeof mount> {
  return mount(
    <EntityContextMenu
      ctx={{ x: 10, y: 10, id: '512' }}
      isCode={isCode}
      onClose={() => {}}
      onRename={() => {}}
      onCreatePrefab={handlers.onCreatePrefab ?? (() => {})}
    />
  )
}

const itemFor = (view: ReturnType<typeof mount>, label: string): HTMLElement | undefined =>
  view.all('.eui-menu-item').find((el) => el.textContent?.startsWith(label) === true)

beforeEach(() => {
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
})
