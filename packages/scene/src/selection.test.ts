import { describe, it, expect, beforeEach } from 'vitest'
import {
  state,
  clearSelection,
  setSelected,
  setSelectionAndActive,
  selectionClick,
  applyBoxSelection,
  type Snapshot
} from './state'

// UI nodes (any Ui* component) are screen elements, not scene objects: whatever
// path tries to select one — pick, box, tree, bus sync — the choke point in
// state.ts must drop it, so the inspector never opens on a leaderboard row.
const snapshot = {
  '512': { Transform: {}, Name: { value: 'crate' } },
  '513': { Transform: {}, Name: { value: 'lamp' } },
  '609': { UiTransform: {}, UiBackground: {} }
} as unknown as Snapshot

beforeEach(() => {
  state.snapshot = snapshot
  clearSelection()
})

describe('UI entities never enter the selection', () => {
  it('setSelected drops them', () => {
    setSelected(['512', '609'])
    expect([...state.selected]).toEqual(['512'])
  })

  it('selectionClick ignores a click on one', () => {
    selectionClick('609', false, false)
    expect(state.selected.size).toBe(0)
    expect(state.activeEntity).toBeNull()
  })

  it('box selection filters them and repairs the active entity', () => {
    applyBoxSelection(['512', '513', '609'], false, false)
    expect([...state.selected].sort()).toEqual(['512', '513'])
    expect(state.activeEntity).toBe('513')
  })

  it('bus sync falls back when the active id was a UI entity', () => {
    setSelectionAndActive(['512', '609'], '609')
    expect([...state.selected]).toEqual(['512'])
    expect(state.activeEntity).toBe('512')
  })

  it('a stale selected UI entity can still be toggled off', () => {
    state.selected = new Set(['609'])
    state.activeEntity = '609'
    selectionClick('609', true, true)
    expect(state.selected.size).toBe(0)
    expect(state.activeEntity).toBeNull()
  })
})
