import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { state, type Snapshot } from '@scene/state'
import { CreatePrefabDialog } from './CreatePrefabDialog'
import { consumerStore } from '../prefabs/consumers'
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

const dialog = (spawnable: boolean): ReturnType<typeof mount> =>
  mount(<CreatePrefabDialog spawnable={spawnable} onClose={() => {}} />)

const seg = (view: ReturnType<typeof mount>, label: string): HTMLElement[] =>
  Array.from(view.find(`[aria-label="${label}"]`)?.querySelectorAll<HTMLElement>('.eui-seg-btn') ?? [])

const activeSeg = (view: ReturnType<typeof mount>, label: string): string | undefined =>
  seg(view, label).find((b) => b.className.includes('active'))?.textContent ?? undefined

const submit = (view: ReturnType<typeof mount>, label = 'Create spawnable prefab'): void => {
  view.click(view.byText(label, 'button'))
}

beforeEach(() => {
  state.status = 'ready'
  state.snapshot = { '512': row('Zombie') } as Snapshot
  state.selected = new Set(['512'])
  consumerStore.scripts = {}
  consumerStore.loaded = true
  createPrefab.mockClear()
})

afterEach(() => {
  state.snapshot = {}
  state.selected = new Set<string>()
  consumerStore.scripts = {}
  consumerStore.loaded = false
})

describe('CreatePrefabDialog', () => {
  it('keeps the plain create free of spawning controls', () => {
    const view = dialog(false)
    expect(view.find('[aria-label="Max alive"]')).toBeNull()
    expect(view.find('[aria-label="Copies are made"]')).toBeNull()
    view.unmount()
  })

  it('asks how many can be alive and how copies are made in spawnable mode', () => {
    const view = dialog(true)
    expect(view.find('[aria-label="Max alive"]')).not.toBeNull()
    expect(seg(view, 'Copies are made').map((b) => b.textContent)).toEqual(['On demand', 'One per player'])
    view.unmount()
  })

  it('creates once, carrying the spawning answers with it', async () => {
    const view = dialog(true)
    submit(view)
    await view.settle()
    expect(createPrefab).toHaveBeenCalledTimes(1)
    expect(createPrefab.mock.calls[0][0]).toBe('Zombie')
    expect(createPrefab.mock.calls[0][1]).toEqual({
      spawnable: { max: 8, instancing: 'onDemand' },
      placement: 'editingOnly'
    })
    view.unmount()
  })

  it('leaves a big on-demand pool out of the scene, and keeps a per-player one', () => {
    const view = dialog(true)
    view.type(view.find('[aria-label="Max alive"]'), '64')
    expect(activeSeg(view, 'This one in the scene')).toBe('Prefab only')
    view.click(seg(view, 'Copies are made')[1])
    expect(activeSeg(view, 'This one in the scene')).toBe('Keep it here')
    view.unmount()
  })

  it('stops recommending once the creator has answered that row themselves', () => {
    const view = dialog(true)
    view.type(view.find('[aria-label="Max alive"]'), '64')
    view.click(seg(view, 'This one in the scene')[0])
    expect(activeSeg(view, 'This one in the scene')).toBe('Keep it here')
    view.click(seg(view, 'Copies are made')[1])
    view.click(seg(view, 'Copies are made')[0])
    expect(activeSeg(view, 'This one in the scene')).toBe('Keep it here')
    view.unmount()
  })

  it('does not ask about a multi-root selection, because nothing marks an instance', () => {
    state.snapshot = { '512': row('Zombie'), '513': row('Crate') } as Snapshot
    state.selected = new Set(['512', '513'])
    const view = dialog(true)
    expect(view.find('[aria-label="This one in the scene"]')).toBeNull()
    expect(view.text()).toContain(MULTI_ROOT_NOTE)
    view.unmount()
  })

  it('never dims a kept copy while the project scripts are still unread', () => {
    consumerStore.loaded = false
    const view = dialog(true)
    submit(view)
    expect(createPrefab.mock.calls[0][1]).toMatchObject({ placement: 'editorAndPlay' })
    view.unmount()
  })

  it('dims a kept copy only when nothing in it runs on the server', () => {
    state.snapshot = { '512': row('Zombie', script('custom/zombie/zombie.ts')) } as Snapshot
    consumerStore.scripts = { 'custom/zombie/zombie.ts': 'export function main() {}' }
    const view = dialog(true)
    submit(view)
    expect(createPrefab.mock.calls[0][1]).toMatchObject({ placement: 'editingOnly' })
    view.unmount()
  })

  it('keeps a server half in the game', () => {
    state.snapshot = { '512': row('Zombie', script('custom/zombie/zombie.ts')) } as Snapshot
    consumerStore.scripts = { 'custom/zombie/zombie.ts': 'if (isServer()) { tick() }' }
    const view = dialog(true)
    submit(view)
    expect(createPrefab.mock.calls[0][1]).toMatchObject({ placement: 'editorAndPlay' })
    view.unmount()
  })

  it('refuses to create over an empty selection', () => {
    state.selected = new Set<string>()
    const view = dialog(true)
    expect(view.find('[aria-label="Max alive"]')).toBeNull()
    submit(view)
    expect(createPrefab).not.toHaveBeenCalled()
    view.unmount()
  })
})
