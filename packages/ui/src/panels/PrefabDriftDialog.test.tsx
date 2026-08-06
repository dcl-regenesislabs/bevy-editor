import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrefabDriftDialog } from './PrefabDriftDialog'
import type { DriftEntry, DriftResult } from '../prefabs/drift'
import { mount } from '../test/render'

const { state: mockState, updateFromPrefab, saveOverPrefab } = vi.hoisted(() => ({
  state: { result: null as DriftResult | null, failure: null as string | null },
  updateFromPrefab: vi.fn(async (_folder: string, _rootId: string) => ({ ok: true })),
  saveOverPrefab: vi.fn(async (_folder: string, _rootId: string) => ({ ok: true }))
}))

vi.mock('../actions/drift', () => ({
  instanceDriftFor: async (): Promise<DriftResult | null> => {
    if (mockState.failure !== null) throw new Error(mockState.failure)
    return mockState.result
  },
  uiUpdateInstanceFromPrefab: updateFromPrefab,
  uiSaveOverPrefab: saveOverPrefab
}))

const entry = (localId: string, component: string): DriftEntry => ({ localId, component })

const drifted: DriftResult = {
  status: 'drifted',
  added: [entry('1', 'core::MeshRenderer')],
  changed: [entry('0', 'core::Transform'), entry('2', 'asset-packs::Script')],
  removed: []
}

async function dialog(): Promise<ReturnType<typeof mount>> {
  const view = mount(
    <PrefabDriftDialog folder="custom/player-rig" name="Player Rig" rootId="512" onClose={() => {}} />
  )
  await view.settle()
  return view
}

beforeEach(() => {
  mockState.result = { status: 'clean', added: [], changed: [], removed: [] }
  mockState.failure = null
  updateFromPrefab.mockClear()
  saveOverPrefab.mockClear()
})

describe('PrefabDriftDialog render', () => {
  it('says it is comparing before the answer arrives', () => {
    const view = mount(
      <PrefabDriftDialog folder="custom/player-rig" name="Player Rig" rootId="512" onClose={() => {}} />
    )
    expect(view.find('.eui-prefab-drift-busy')).not.toBeNull()
    expect(view.text()).toContain('Comparing this copy with its prefab')
    view.unmount()
  })

  it('offers no verbs at all when the instance matches its folder', async () => {
    const view = await dialog()
    expect(view.find('.eui-prefab-drift-busy')).toBeNull()
    expect(view.all('.eui-modal-foot button')).toHaveLength(1)
    expect(view.byText('Close', 'button')).not.toBeNull()
    view.unmount()
  })

  it('lists what drifted under styled rows, never a bare browser list', async () => {
    mockState.result = drifted
    const view = await dialog()
    expect(view.all('.eui-prefab-drift-list')).toHaveLength(2)
    expect(view.all('.eui-prefab-drift-list li')).toHaveLength(3)
    expect(view.all('ul:not(.eui-prefab-drift-list)')).toHaveLength(0)
    view.unmount()
  })

  it('counts each group with a chip', async () => {
    mockState.result = drifted
    const view = await dialog()
    expect(view.all('.eui-prefab-drift-head .eui-ds-chip').map((c) => c.textContent)).toEqual(['1', '2'])
    view.unmount()
  })

  it('caps the list and says how many more there are', async () => {
    mockState.result = {
      status: 'drifted',
      added: [],
      changed: Array.from({ length: 11 }, (_, i) => entry(String(i), `c${i}`)),
      removed: []
    }
    const view = await dialog()
    expect(view.all('.eui-prefab-drift-list li')).toHaveLength(9)
    expect(view.text()).toContain('3 more')
    view.unmount()
  })

  it('makes both verbs two-step, and neither fires on the first click', async () => {
    mockState.result = drifted
    const view = await dialog()
    const verbs = view.all('.eui-modal-foot button').filter((b) => b.textContent !== 'Close')
    expect(verbs).toHaveLength(2)
    view.click(verbs[0])
    expect(updateFromPrefab).not.toHaveBeenCalled()
    view.click(view.all('.eui-modal-foot button').filter((b) => b.textContent !== 'Close')[0])
    await view.settle()
    expect(updateFromPrefab).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('still offers both verbs on an instance it cannot compare', async () => {
    mockState.result = { status: 'unknown', added: [], changed: [], removed: [] }
    const view = await dialog()
    expect(view.all('.eui-modal-foot button')).toHaveLength(3)
    expect(view.all('.eui-prefab-drift-list')).toHaveLength(0)
    view.unmount()
  })

  it('reports a failed comparison as an error, not as a clean instance', async () => {
    mockState.failure = 'folder unreadable'
    const view = await dialog()
    expect(view.find('.eui-prefab-drift-error')?.textContent).toContain('folder unreadable')
    expect(view.find('.eui-prefab-drift-busy')).toBeNull()
    view.unmount()
  })
})
