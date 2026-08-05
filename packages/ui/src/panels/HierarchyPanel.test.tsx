import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { state, type Snapshot } from '@scene/state'
import { HierarchyPanel } from './HierarchyPanel'
import { INERT_COMPONENT } from '../prefabs/format'
import { mount } from '../test/render'

const ZOMBIE_ID = 'a1'

const row = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: {},
  ...extra
})

function panel(): ReturnType<typeof mount> {
  return mount(
    <HierarchyPanel
      onNewEntity={() => {}}
      onCreatePrefab={() => {}}
      onCreateSpawnable={() => {}}
      onView={() => {}}
    />
  )
}

function marksOf(view: ReturnType<typeof mount>, name: string): string[] {
  const label = view.all('.eui-row .label').find((el) => el.textContent?.includes(name) === true)
  const marks = label?.parentElement?.querySelector('.row-marks')
  return Array.from(marks?.querySelectorAll('.eui-ds-chip') ?? []).map((c) => c.textContent ?? '')
}

beforeEach(() => {
  state.status = 'ready'
  state.snapshot = {}
  state.selected = new Set<string>()
  state.expandedEntities = new Set<string>()
})

afterEach(() => {
  state.snapshot = {}
  state.selected = new Set<string>()
})

describe('HierarchyPanel ghost badge', () => {
  it('mounts a plain scene without a badge on anything', () => {
    state.snapshot = { '512': row('Bench') } as Snapshot
    const view = panel()
    expect(view.text()).toContain('Bench')
    expect(marksOf(view, 'Bench')).toEqual([])
    view.unmount()
  })

  it('badges an inert anchor as Editing only', () => {
    state.snapshot = {
      '512': row('Player Rig', {
        [INERT_COMPONENT]: {},
        'inspector::CustomAsset': { assetId: ZOMBIE_ID }
      })
    } as Snapshot
    const view = panel()
    expect(marksOf(view, 'Player Rig')).toContain('Editing only')
    view.unmount()
  })

  it('explains the badge rather than showing a bare word', () => {
    state.snapshot = { '512': row('Player Rig', { [INERT_COMPONENT]: {} }) } as Snapshot
    const view = panel()
    const badge = view.all('.eui-ds-chip').find((c) => c.textContent === 'Editing only')
    expect(badge?.getAttribute('data-tip')?.length ?? 0).toBeGreaterThan(20)
    view.unmount()
  })

  it('badges the marked entity alone, never every descendant', () => {
    state.snapshot = {
      '512': row('Player Rig', { [INERT_COMPONENT]: {} }),
      '513': { [NAME_COMPONENT]: { value: 'HandAnchor' }, Transform: { parent: 512 } }
    } as Snapshot
    state.expandedEntities = new Set(['512'])
    const view = panel()
    expect(view.text()).toContain('HandAnchor')
    expect(view.all('.eui-ds-chip').filter((c) => c.textContent === 'Editing only')).toHaveLength(1)
    view.unmount()
  })

  it('keeps the prefab-instance mark and the ghost badge on the same row', () => {
    state.snapshot = {
      '512': row('Player Rig', { [INERT_COMPONENT]: {}, 'inspector::CustomAsset': { assetId: ZOMBIE_ID } })
    } as Snapshot
    const view = panel()
    const rowEl = view.all('.eui-row').find((el) => el.textContent?.includes('Player Rig') === true)
    expect(rowEl?.className).toContain('eui-prefab-row')
    expect(rowEl?.querySelector('.eui-prefab-mark')).not.toBeNull()
    expect(marksOf(view, 'Player Rig')).toContain('Editing only')
    view.unmount()
  })
})

describe('HierarchyPanel prefab button', () => {
  it('says what the button would do once something is selected', () => {
    state.snapshot = { '512': row('Bench') } as Snapshot
    state.selected = new Set(['512'])
    const view = panel()
    const button = view.find('.eui-head-actions .eui-btn.icon:not([disabled])[data-tip]')
    expect(view.all('[data-tip="Create a prefab from the selection"]')).toHaveLength(1)
    expect(button).not.toBeNull()
    view.unmount()
  })

  it('says what is missing while nothing is selected, instead of going quiet', () => {
    state.snapshot = { '512': row('Bench') } as Snapshot
    state.selected = new Set<string>()
    const view = panel()
    const button = view.find('[data-tip="Select entities to create a prefab from them"]')
    expect(button?.hasAttribute('disabled')).toBe(true)
    view.unmount()
  })
})

describe('HierarchyPanel Game Config', () => {
  it('reaches the scene root Game Config, which the tree itself never shows', () => {
    state.snapshot = { '0': { 'inspector::Nodes': {} }, '512': row('Bench') } as Snapshot
    const view = panel()
    // the root is not a row — the head button is the only way in
    expect(view.all('.eui-row')).toHaveLength(1)
    expect(view.find('.eui-modal')).toBeNull()
    view.click(view.find('[aria-label="Game Config"]'))
    expect(view.find('.eui-modal')?.textContent).toContain('Game Config')
    view.unmount()
  })
})
