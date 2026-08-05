import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrefabInstanceStrip, PrefabRuntimeChips } from './prefab-widgets'
import { prefabStore } from './prefab-store'
import type { DriftResult } from '../prefabs/drift'
import type { PlacementInstance } from '../prefabs/placement'
import type { GuaranteeChip } from '../prefabs/guarantees'
import type { PrefabData } from '../prefabs/format'
import { mount } from '../test/render'

const { driftFor } = vi.hoisted(() => ({
  driftFor: vi.fn(async (_folder: string, _rootId: string) => {
    await Promise.resolve()
    return { status: 'drifted', added: [{ localId: '0', component: 'asset-packs::Script' }], removed: [], changed: [] } as DriftResult
  })
}))

vi.mock('../actions/drift', () => ({
  instanceDriftFor: driftFor,
  uiSaveOverPrefab: vi.fn(),
  uiUpdateInstanceFromPrefab: vi.fn()
}))

const ZOMBIE_ID = 'a1'

function prefab(over: Partial<PrefabData> = {}): PrefabData {
  return { id: ZOMBIE_ID, name: 'Zombie', category: 'custom', tags: [], ...over }
}

const placed = (): PlacementInstance => ({ entityId: '7', prefabId: ZOMBIE_ID })

const planned: GuaranteeChip[] = [{ tone: 'info', label: 'Planned spawns', tip: 'Same spawns everywhere.' }]

function chips(props: {
  data?: PrefabData
  instances?: PlacementInstance[]
  guarantees?: GuaranteeChip[]
  stale?: boolean
  inProject?: boolean
}): ReturnType<typeof mount> {
  return mount(
    <PrefabRuntimeChips
      data={props.data ?? prefab({ spawnable: { max: 24, instancing: 'onDemand' } })}
      instances={props.instances ?? []}
      guarantees={props.guarantees ?? []}
      inProject={props.inProject ?? true}
    />
  )
}

afterEach(() => {
  prefabStore.items = []
  prefabStore.loaded = false
  driftFor.mockClear()
})

describe('PrefabInstanceStrip render', () => {
  const strip = (): ReturnType<typeof mount> => {
    prefabStore.items = [{ folder: 'custom/zombie', data: prefab(), hasGuide: false }]
    prefabStore.loaded = true
    return mount(<PrefabInstanceStrip assetId={ZOMBIE_ID} rootId="512" />)
  }

  it('offers the two prefab verbs from the instance itself, spawnable or not', async () => {
    const view = strip()
    view.click(view.byText('Compare…', '.eui-link'))
    await view.settle()
    expect(driftFor).toHaveBeenCalledWith('custom/zombie', '512')
    expect(view.text()).toContain('Save over prefab')
    expect(view.text()).toContain('Update from prefab')
    view.unmount()
  })

  it('names the prefab and still offers Show', () => {
    const view = strip()
    expect(view.text()).toContain('Instance of Zombie')
    expect(view.byText('Show', '.eui-link')).not.toBeNull()
    view.unmount()
  })
})

describe('PrefabRuntimeChips render', () => {
  it('says where the prefab stands, never whether it is spawnable', () => {
    const view = chips({ data: prefab() })
    const labels = view.all('.eui-prefab-chips .eui-ds-chip').map((c) => c.textContent)
    expect(labels).toContain('Not in the scene')
    expect(labels.some((l) => l?.includes('Spawnable') === true)).toBe(false)
    view.unmount()
  })

  it('reads a live instance as in-the-game and an inert one as editing-only', () => {
    const live = chips({ instances: [placed()] })
    expect(live.text()).toContain('1 in the scene')
    live.unmount()
    const ghost = chips({ instances: [placed()] })
    expect(ghost.text()).toContain('1 in the scene')
    ghost.unmount()
  })

  it('never claims a placement for a library master this project has not copied', () => {
    const view = chips({ inProject: false, guarantees: planned })
    const labels = view.all('.eui-prefab-chips .eui-ds-chip').map((c) => c.textContent)
    expect(labels.some((l) => l === 'Not in the scene')).toBe(false)
    expect(labels).not.toContain('Planned spawns')
    view.unmount()
  })

  it('marks a per-player prefab', () => {
    const view = chips({ data: prefab({ spawnable: { max: 32, instancing: 'perPlayer' } }) })
    expect(view.text()).toContain('Per player')
    view.unmount()
  })


  it('shows the derived guarantees last, in the colour language they carry', () => {
    const view = chips({
      guarantees: [
        { tone: 'server', label: 'Server-owned', tip: 'one copy' },
        { tone: 'client', label: 'read-only on clients', tip: 'validator wins' }
      ]
    })
    const all = view.all('.eui-prefab-chips .eui-ds-chip')
    expect(all[all.length - 2].className).toContain('server')
    expect(all[all.length - 1].className).toContain('client')
    view.unmount()
  })

  it('gives every chip a tooltip — the card is too narrow to read one whole', () => {
    const view = chips({ instances: [placed()], guarantees: planned })
    const all = view.all('.eui-prefab-chips .eui-ds-chip')
    expect(all.length).toBeGreaterThan(1)
    for (const chip of all) expect(chip.getAttribute('data-tip')).toBeTruthy()
    view.unmount()
  })
})
