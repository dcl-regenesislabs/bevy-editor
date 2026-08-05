import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { state, type Snapshot } from '@scene/state'
import { CreatePrefabDialog } from './CreatePrefabDialog'
import { MULTI_ROOT_NOTE } from './create-prefab'
import { mount } from '../test/render'

const { createPrefab } = vi.hoisted(() => ({
  createPrefab: vi.fn(async (_name: string, _options?: unknown): Promise<void> => {})
}))

vi.mock('../actions/prefabs', () => ({ uiCreatePrefabFromSelection: createPrefab }))

const row = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: {},
  ...extra
})

const script = (path: string): Record<string, unknown> => ({
  [SCRIPT_COMPONENT]: { value: [{ path, layout: '' }] }
})

const dialog = (): ReturnType<typeof mount> => mount(<CreatePrefabDialog onClose={() => {}} />)

const seg = (view: ReturnType<typeof mount>, label: string): HTMLElement[] =>
  Array.from(view.find(`[aria-label="${label}"]`)?.querySelectorAll<HTMLElement>('.eui-seg-btn') ?? [])

const activeSeg = (view: ReturnType<typeof mount>, label: string): string | undefined =>
  seg(view, label).find((b) => b.className.includes('active'))?.textContent ?? undefined

const submit = (view: ReturnType<typeof mount>): void => {
  view.click(view.byText('Create prefab', 'button'))
}

beforeEach(() => {
  state.status = 'ready'
  state.snapshot = { '512': row('Zombie') } as Snapshot
  state.selected = new Set(['512'])
  createPrefab.mockClear()
})

afterEach(() => {
  state.snapshot = {}
  state.selected = new Set<string>()
})

describe('CreatePrefabDialog', () => {
  it('asks a name and when it appears — nothing else', () => {
    const view = dialog()
    expect(view.find('input[placeholder="Prefab name"]')).not.toBeNull()
    expect(seg(view, 'Appears').map((b) => b.textContent)).toEqual(['From the start', 'When spawned'])
    expect(view.find('[aria-label="Max alive"]')).toBeNull()
    expect(view.find('[aria-label="Copies are made"]')).toBeNull()
    view.unmount()
  })

  it('keeps the selection in the scene by default', () => {
    const view = dialog()
    expect(activeSeg(view, 'Appears')).toBe('From the start')
    view.unmount()
  })

  it('creates with no spawn settings — every prefab is spawnable', async () => {
    const view = dialog()
    submit(view)
    await view.settle()
    expect(createPrefab).toHaveBeenCalledTimes(1)
    expect(createPrefab.mock.calls[0][0]).toBe('Zombie')
    expect(createPrefab.mock.calls[0][1]).toEqual({ spawnedOnly: false })
    view.unmount()
  })

  it('When spawned keeps the selection and marks it spawn-only', async () => {
    const view = dialog()
    view.click(seg(view, 'Appears')[1])
    submit(view)
    await view.settle()
    expect(createPrefab.mock.calls[0][1]).toEqual({ spawnedOnly: true })
    view.unmount()
  })

  it('does not ask about a multi-root selection, because nothing marks an instance', () => {
    state.snapshot = { '512': row('Zombie'), '513': row('Crate') } as Snapshot
    state.selected = new Set(['512', '513'])
    const view = dialog()
    expect(view.find('[aria-label="Appears"]')).toBeNull()
    expect(view.text()).toContain(MULTI_ROOT_NOTE)
    view.unmount()
  })

  it('refuses to create over an empty selection', () => {
    state.selected = new Set<string>()
    const view = dialog()
    submit(view)
    expect(createPrefab).not.toHaveBeenCalled()
    view.unmount()
  })
})
