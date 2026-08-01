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

// UI nodes (any Ui* component) are screen elements with no world position, so a
// VIEWPORT pick or drag-box hit on one is always a mistake and state.ts drops it.
// The TREE / bus path is different: the hierarchy lists UI nodes, and selecting
// one is the only way to read its UiTransform/UiBackground in the inspector.
const snapshot = {
  '512': { Transform: {}, Name: { value: 'crate' } },
  '513': { Transform: {}, Name: { value: 'lamp' } },
  '609': { UiTransform: {}, UiBackground: {} }
} as unknown as Snapshot

beforeEach(() => {
  state.snapshot = snapshot
  clearSelection()
})

describe('UI entities are tree-selectable but never viewport-pickable', () => {
  it('setSelected keeps them — this is the tree/bus path', () => {
    setSelected(['512', '609'])
    expect([...state.selected]).toEqual(['512', '609'])
  })

  it('setSelected still drops ids that are not in the snapshot', () => {
    setSelected(['512', '999'])
    expect([...state.selected]).toEqual(['512'])
  })

  it('a viewport pick on one is refused', () => {
    selectionClick('609', false, false, true)
    expect(state.selected.size).toBe(0)
    expect(state.activeEntity).toBeNull()
  })

  it('a TREE click on one selects it — the only way to inspect a UiTransform', () => {
    selectionClick('609', false, false)
    expect([...state.selected]).toEqual(['609'])
    expect(state.activeEntity).toBe('609')
  })

  it('a tree click still ignores an id that is not in the snapshot', () => {
    selectionClick('999', false, false)
    expect(state.selected.size).toBe(0)
  })

  it('box selection filters them and repairs the active entity', () => {
    applyBoxSelection(['512', '513', '609'], false, false)
    expect([...state.selected].sort()).toEqual(['512', '513'])
    expect(state.activeEntity).toBe('513')
  })

  it('bus sync keeps a UI entity active so the inspector can open on it', () => {
    setSelectionAndActive(['512', '609'], '609')
    expect([...state.selected]).toEqual(['512', '609'])
    expect(state.activeEntity).toBe('609')
  })

  it('a stale selected UI entity can still be toggled off', () => {
    state.selected = new Set(['609'])
    state.activeEntity = '609'
    selectionClick('609', true, true)
    expect(state.selected.size).toBe(0)
    expect(state.activeEntity).toBeNull()
  })
})
