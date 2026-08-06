import { afterEach, describe, expect, it } from 'vitest'
import { PrefabInstanceStrip, PrefabRuntimeChips } from './prefab-widgets'
import { prefabStore } from './prefab-store'
import type { PlacementInstance } from '../prefabs/placement'
import type { GuaranteeChip } from '../prefabs/guarantees'
import type { PrefabData } from '../prefabs/format'
import { mount } from '../test/render'

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
})

describe('PrefabInstanceStrip render', () => {
  const strip = (): ReturnType<typeof mount> => {
    prefabStore.items = [{ folder: 'custom/zombie', data: prefab(), hasGuide: false }]
    prefabStore.loaded = true
    return mount(<PrefabInstanceStrip assetId={ZOMBIE_ID} rootId="512" />)
  }

  it('names the prefab and offers Show', async () => {
    const view = strip()
    await view.settle()
    expect(view.text()).toContain('Copy of Zombie')
    expect(view.byText('Show', '.eui-link')).not.toBeNull()
    view.unmount()
  })

  it('never grows a compare link — Show is the only link', async () => {
    const view = strip()
    await view.settle()
    expect(view.all('.eui-link').map((el) => el.textContent)).toEqual(['Show'])
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
