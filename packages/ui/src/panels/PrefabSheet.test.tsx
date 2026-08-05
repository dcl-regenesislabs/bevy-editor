import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { PrefabSheet } from './PrefabSheet'
import { consumerStore } from '../prefabs/consumers'
import { PLACEMENT_LABEL, PLACEMENT_TIP, type PlacementMode } from '../prefabs/placement'
import { maxLine, SPAWNABLE_OFF_LINE, SPAWNABLE_ON_LINE } from '../prefabs/copy'
import { PENDING_EXPLAINER } from '../prefabs/guarantees'
import type { PrefabData, PrefabSpawnable } from '../prefabs/format'
import { mount } from '../test/render'

const { setPlacement, setSpawnable } = vi.hoisted(() => ({
  setPlacement: vi.fn(async (_folder: string, _data: unknown, _mode: PlacementMode): Promise<void> => {}),
  setSpawnable: vi.fn(async (_folder: string, _next: PrefabSpawnable | null): Promise<void> => {})
}))

vi.mock('../actions/ghost', () => ({ uiSetPlacement: setPlacement }))
vi.mock('../actions/spawnables', () => ({ uiSetSpawnable: setSpawnable }))

const ZOMBIE_ID = 'a1'
const RIG_ID = 'b2'

function prefab(over: Partial<PrefabData> = {}): PrefabData {
  return { id: ZOMBIE_ID, name: 'Zombie', category: 'custom', tags: [], ...over }
}

const instance = (prefabId: string, inert = false): Record<string, unknown> => ({
  'inspector::CustomAsset': { assetId: prefabId },
  ...(inert ? { 'inspector::Inert': {} } : {})
})

beforeEach(() => {
  state.snapshot = {}
  state.assetBusy = false
  consumerStore.scripts = {}
  consumerStore.loaded = true
  setPlacement.mockClear()
  setSpawnable.mockClear()
})

afterEach(() => {
  state.snapshot = {}
  consumerStore.loaded = false
  consumerStore.scripts = {}
})

const sheet = (data: PrefabData): ReturnType<typeof mount> =>
  mount(<PrefabSheet folder="custom/zombie" data={data} onClose={() => {}} />)

describe('PrefabSheet render', () => {
  it('says what the window is for, not just which prefab it is', () => {
    const view = sheet(prefab())
    expect(view.find('.eui-modal-head')?.textContent).toContain('Zombie')
    expect(view.find('.eui-modal-head')?.textContent).not.toBe('Zombie')
    expect(view.find('.eui-prefab-sheet-lead')).not.toBeNull()
    view.unmount()
  })

  it('explains every placement in the sheet itself, with nothing to hover', () => {
    const unplaced = sheet(prefab())
    expect(unplaced.text()).toContain(PLACEMENT_TIP.unplaced)
    expect(unplaced.text()).not.toContain(PLACEMENT_TIP.editingOnly)
    unplaced.unmount()

    state.snapshot = { '7': instance(ZOMBIE_ID) }
    const live = sheet(prefab())
    expect(live.text()).toContain(PLACEMENT_TIP.editorAndPlay)
    live.unmount()

    state.snapshot = { '7': instance(ZOMBIE_ID, true) }
    const ghost = sheet(prefab())
    expect(ghost.text()).toContain(PLACEMENT_TIP.editingOnly)
    ghost.unmount()
  })

  it('counts the copies already placed next to the placement it explains', () => {
    state.snapshot = { '7': instance(ZOMBIE_ID), '8': instance(ZOMBIE_ID) }
    const view = sheet(prefab())
    expect(view.text()).toContain('2 copies are placed right now.')
    view.unmount()
  })

  it('explains the Spawnable toggle while it is off, not only once it is on', () => {
    const off = sheet(prefab())
    expect(off.text()).toContain(SPAWNABLE_OFF_LINE)
    off.unmount()

    const on = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    expect(on.text()).toContain(SPAWNABLE_ON_LINE)
    on.unmount()
  })

  it('shows both ways copies are made, with no menu to open', () => {
    const view = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    const labels = view.all('[aria-label="Copies are made"] .eui-seg-btn').map((b) => b.textContent)
    expect(labels).toEqual(['On demand', 'One per player'])
    expect(view.find('.eui-ds-select')).toBeNull()
    view.unmount()
  })

  it('reads Max alive in players once every player gets a copy', () => {
    const view = sheet(prefab({ spawnable: { max: 12, instancing: 'perPlayer' } }))
    expect(view.text()).toContain(maxLine('perPlayer', 12, 'Zombie'))
    view.unmount()
  })

  it('mounts a non-spawnable prefab with placement only', () => {
    const view = sheet(prefab())
    expect(view.find('.eui-prefab-sheet')).not.toBeNull()
    expect(view.find('[aria-label="Spawnable"]')?.getAttribute('aria-checked')).toBe('false')
    expect(view.find('[aria-label="Max alive"]')).toBeNull()
    expect(view.find('[aria-label="Copies are made"]')).toBeNull()
    expect(view.find('.eui-prefab-chips')).toBeNull()
    view.unmount()
  })

  it('shows Max alive and Instancing once Spawnable is on', () => {
    const view = sheet(prefab({ spawnable: { max: 16, instancing: 'onDemand' } }))
    expect(view.find('[aria-label="Spawnable"]')?.getAttribute('aria-checked')).toBe('true')
    expect((view.find('[aria-label="Max alive"]') as HTMLInputElement).value).toBe('16')
    expect(view.find('[aria-label="Copies are made"]')).not.toBeNull()
    view.unmount()
  })

  it('offers all three placement states and marks the derived one active', () => {
    state.snapshot = { '7': instance(ZOMBIE_ID) }
    const view = sheet(prefab())
    const labels = view.all('.eui-seg-btn').map((b) => b.textContent)
    expect(labels).toEqual([PLACEMENT_LABEL.unplaced, PLACEMENT_LABEL.editorAndPlay, PLACEMENT_LABEL.editingOnly])
    expect(view.find('.eui-seg-btn.active')?.textContent).toBe(PLACEMENT_LABEL.editorAndPlay)
    view.unmount()
  })

  it('reads an inert instance as Editing only', () => {
    state.snapshot = { '7': instance(ZOMBIE_ID, true) }
    const view = sheet(prefab())
    expect(view.find('.eui-seg-btn.active')?.textContent).toBe(PLACEMENT_LABEL.editingOnly)
    view.unmount()
  })

  it('moves placement straight through when nothing is placed', () => {
    const view = sheet(prefab())
    view.click(view.byText(PLACEMENT_LABEL.editorAndPlay, '.eui-seg-btn'))
    expect(setPlacement).toHaveBeenCalledTimes(1)
    expect(setPlacement.mock.calls[0][2]).toBe('editorAndPlay')
    view.unmount()
  })

  it('never re-applies the placement already in effect', () => {
    const view = sheet(prefab())
    view.click(view.byText(PLACEMENT_LABEL.unplaced, '.eui-seg-btn'))
    expect(setPlacement).not.toHaveBeenCalled()
    view.unmount()
  })

  it('confirms before Unplaced deletes placed copies, and names how many', () => {
    state.snapshot = { '7': instance(ZOMBIE_ID), '8': instance(ZOMBIE_ID) }
    const view = sheet(prefab())
    view.click(view.byText(PLACEMENT_LABEL.unplaced, '.eui-seg-btn'))
    expect(setPlacement).not.toHaveBeenCalled()
    expect(view.text()).toContain('2')
    const destructive = view.find('.eui-modal-foot .eui-ds-btn.danger')
    expect(destructive).not.toBeNull()
    view.click(destructive)
    expect(setPlacement.mock.calls[0][2]).toBe('unplaced')
    view.unmount()
  })

  it('promises an undo only where one press delivers it', () => {
    state.snapshot = { '7': instance(ZOMBIE_ID) }
    const one = sheet(prefab())
    one.click(one.byText(PLACEMENT_LABEL.unplaced, '.eui-seg-btn'))
    expect(one.text()).toContain('Undo puts it back.')
    one.unmount()

    state.snapshot = { '7': instance(ZOMBIE_ID), '8': instance(ZOMBIE_ID) }
    const two = sheet(prefab())
    two.click(two.byText(PLACEMENT_LABEL.unplaced, '.eui-seg-btn'))
    expect(two.text()).not.toContain('Undo')
    two.unmount()
  })

  it('lets the creator back out of the unplace confirm', () => {
    state.snapshot = { '7': instance(ZOMBIE_ID) }
    const view = sheet(prefab())
    view.click(view.byText(PLACEMENT_LABEL.unplaced, '.eui-seg-btn'))
    view.click(view.byText('Cancel', 'button'))
    expect(setPlacement).not.toHaveBeenCalled()
    expect(view.find('[aria-label="Placement"]')).not.toBeNull()
    view.unmount()
  })

  it('asks about an anchor before turning Spawnable on', () => {
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    expect(setSpawnable).not.toHaveBeenCalled()
    expect(view.find('[aria-label="Spawnable"]')).toBeNull()
    expect(view.find('[aria-label="Placement"]')).toBeNull()
    expect(view.all('.eui-modal-foot button')).toHaveLength(2)
    view.unmount()
  })

  it('turns Spawnable on without an anchor when the creator declines', () => {
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    view.click(view.all('.eui-modal-foot button')[0])
    expect(setSpawnable).toHaveBeenCalledTimes(1)
    expect(setSpawnable.mock.calls[0][1]).toEqual({ max: 8, instancing: 'onDemand' })
    expect(setPlacement).not.toHaveBeenCalled()
    view.unmount()
  })

  it('sends the decline through the unplace confirm when a copy is already placed', async () => {
    state.snapshot = { '7': instance(ZOMBIE_ID) }
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    view.type(view.find('[aria-label="Max alive"]'), '64')
    view.click(view.all('.eui-modal-foot button')[0])
    await view.settle()
    expect(setSpawnable.mock.calls[0][1]).toEqual({ max: 64, instancing: 'onDemand' })
    expect(setPlacement).not.toHaveBeenCalled()
    const destructive = view.find('.eui-modal-foot .eui-ds-btn.danger')
    expect(destructive).not.toBeNull()
    view.click(destructive)
    expect(setPlacement).toHaveBeenCalledTimes(1)
    expect(setPlacement.mock.calls[0][2]).toBe('unplaced')
    view.unmount()
  })

  it('never promises an unplacement it does not perform', () => {
    const empty = sheet(prefab())
    empty.click(empty.find('[aria-label="Spawnable"]'))
    expect(empty.all('.eui-modal-foot button')[0].textContent).toBe('Leave it out')
    empty.unmount()

    state.snapshot = { '7': instance(ZOMBIE_ID), '8': instance(ZOMBIE_ID) }
    const placed = sheet(prefab())
    placed.click(placed.find('[aria-label="Spawnable"]'))
    expect(placed.all('.eui-modal-foot button')[0].textContent).toBe('Remove all 2')
    placed.unmount()
  })

  it('sets the pool inside the anchor question, so the default is informed', () => {
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    expect(view.find('[aria-label="Max alive"]')).not.toBeNull()
    expect(view.find('[aria-label="Copies are made"]')).not.toBeNull()
    view.type(view.find('[aria-label="Max alive"]'), '64')
    view.click(view.all('.eui-modal-foot button')[1])
    expect(setSpawnable.mock.calls[0][1]).toEqual({ max: 64, instancing: 'onDemand' })
    view.unmount()
  })

  it('leads with “leave it unplaced” once the pool is too big to stand in the editor', () => {
    const view = sheet(prefab())
    const leads = (): string => view.find('.eui-modal-foot .eui-ds-btn.primary')?.textContent ?? ''
    view.click(view.find('[aria-label="Spawnable"]'))
    expect(leads()).not.toBe('Leave it out')
    view.type(view.find('[aria-label="Max alive"]'), '64')
    expect(leads()).toBe('Leave it out')
    view.unmount()
  })

  it('lets one-per-player win the pool-size default, since that anchor is the point', () => {
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    view.type(view.find('[aria-label="Max alive"]'), '64')
    view.click(view.byText('One per player', '.eui-seg-btn'))
    expect(view.find('.eui-modal-foot .eui-ds-btn.primary')?.textContent).not.toBe('Leave it unplaced')
    view.click(view.all('.eui-modal-foot button')[1])
    expect(setSpawnable.mock.calls[0][1]).toEqual({ max: 64, instancing: 'perPlayer' })
    view.unmount()
  })

  it('keeps a server half in the built scene, never as a ghost', async () => {
    consumerStore.scripts = { 'custom/player-rig/rig.ts': 'if (isServer()) validate()' }
    const view = mount(
      <PrefabSheet folder="custom/player-rig" data={prefab({ id: RIG_ID, name: 'Player Rig' })} onClose={() => {}} />
    )
    view.click(view.find('[aria-label="Spawnable"]'))
    view.click(view.byText('Keep it in the game', 'button'))
    await view.settle()
    expect(setPlacement.mock.calls[0][2]).toBe('editorAndPlay')
    view.unmount()
  })

  it('ghosts an anchor only when the prefab has no server half', async () => {
    consumerStore.scripts = { 'custom/zombie/brain.ts': 'export class Brain { start() {} }' }
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    view.click(view.byText('Keep it, editing only', 'button'))
    await view.settle()
    expect(setPlacement.mock.calls[0][2]).toBe('editingOnly')
    view.unmount()
  })

  it('never ghosts an anchor before the project scripts have been read', async () => {
    consumerStore.loaded = false
    const view = sheet(prefab())
    view.click(view.find('[aria-label="Spawnable"]'))
    view.click(view.byText('Keep it in the game', 'button'))
    await view.settle()
    expect(setPlacement.mock.calls[0][2]).toBe('editorAndPlay')
    view.unmount()
  })

  it('turns Spawnable off in one gesture, with no anchor question', () => {
    const view = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    view.click(view.find('[aria-label="Spawnable"]'))
    expect(setSpawnable).toHaveBeenCalledWith('custom/zombie', null)
    view.unmount()
  })

  it('shows the pending guarantee while no script opens a pool, and says why', () => {
    const view = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    const chips = view.all('.eui-prefab-chips .eui-ds-chip')
    expect(chips).toHaveLength(1)
    expect(chips[0].className).toContain('info')
    expect(view.text()).toContain(PENDING_EXPLAINER)
    view.unmount()
  })

  it('derives the full clause row from the script that opens the pool', () => {
    state.snapshot = {
      '9': {
        'asset-packs::Script': {
          value: [{ path: 'src/scripts/director.ts', layout: JSON.stringify({ params: { zombie: { type: 'prefab', value: ZOMBIE_ID } } }) }]
        }
      }
    }
    consumerStore.scripts = {
      'src/scripts/director.ts': "import * as spawner from './runtime/spawner'\nspawner.plan(this.zombie, (t) => [])"
    }
    const view = sheet(prefab({ spawnable: { max: 24, instancing: 'onDemand' } }))
    const chips = view.all('.eui-prefab-chips .eui-ds-chip')
    expect(chips.length).toBeGreaterThan(1)
    expect(chips.map((c) => c.className).join(' ')).toContain('server')
    expect(chips.map((c) => c.className).join(' ')).toContain('client')
    view.unmount()
  })

  it('locks every write while an asset operation is running', () => {
    state.assetBusy = true
    const view = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    expect(view.find('[aria-label="Spawnable"]')?.hasAttribute('disabled')).toBe(true)
    expect(view.find('[aria-label="Max alive"]')?.hasAttribute('disabled')).toBe(true)
    view.click(view.byText(PLACEMENT_LABEL.editorAndPlay, '.eui-seg-btn'))
    expect(setPlacement).not.toHaveBeenCalled()
    view.unmount()
  })

  it('leaves a cleared max empty while typing, and never writes NaN', () => {
    const view = sheet(prefab({ spawnable: { max: 12, instancing: 'onDemand' } }))
    view.type(view.find('[aria-label="Max alive"]'), '', false)
    expect((view.find('[aria-label="Max alive"]') as HTMLInputElement).value).toBe('')
    view.type(view.find('[aria-label="Max alive"]'), '')
    expect((view.find('[aria-label="Max alive"]') as HTMLInputElement).value).toBe('12')
    const maxes = setSpawnable.mock.calls.map(([, next]) => next?.max)
    expect(maxes.every((value) => value === undefined || Number.isFinite(value))).toBe(true)
    view.unmount()
  })

  it('writes a clamped max on blur', () => {
    const view = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    view.type(view.find('[aria-label="Max alive"]'), '5000')
    expect(setSpawnable).toHaveBeenCalledTimes(1)
    expect(setSpawnable.mock.calls[0][1]).toEqual({ max: 1024, instancing: 'onDemand' })
    expect((view.find('[aria-label="Max alive"]') as HTMLInputElement).value).toBe('1024')
    view.unmount()
  })

  it('writes nothing when the max settles back on the stored value', () => {
    const view = sheet(prefab({ spawnable: { max: 8, instancing: 'onDemand' } }))
    view.type(view.find('[aria-label="Max alive"]'), '8')
    expect(setSpawnable).not.toHaveBeenCalled()
    view.unmount()
  })
})
