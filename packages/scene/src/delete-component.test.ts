import { describe, it, expect, vi, beforeEach } from 'vitest'

// Removing a component has to hand the observer the value it removed — that clone
// is the only record of it, and it's what the page's undo step writes back.

const deleted = vi.fn<(entityId: string, name: string) => Promise<string>>(() => Promise.resolve(''))

vi.mock('./cmd', () => ({
  cmd: {
    deleteComponent: (entityId: string, name: string) => deleted(entityId, name)
  }
}))

import { deleteComponent, setMutationObservers } from './inspector'
import { state } from './state'

describe('deleteComponent → observer', () => {
  const seen: Array<{ entityId: string; name: string; prev?: unknown }> = []

  beforeEach(() => {
    seen.length = 0
    deleted.mockClear()
    state.snapshot = {}
    setMutationObservers(
      () => {},
      () => {},
      (entityId, name, prev) => seen.push({ entityId, name, prev })
    )
  })

  it('reports the removed value', () => {
    state.snapshot = { '512': { Visibility: { visible: true } } }
    deleteComponent('512', 'Visibility')
    expect(seen).toEqual([{ entityId: '512', name: 'Visibility', prev: { visible: true } }])
  })

  it('clones it, so the undo step survives later snapshot churn', () => {
    const value = { visible: true }
    state.snapshot = { '512': { Visibility: value } }
    deleteComponent('512', 'Visibility')
    value.visible = false
    expect(seen[0].prev).toEqual({ visible: true })
  })

  it('reports undefined when the component was not there', () => {
    deleteComponent('512', 'Visibility')
    expect(seen).toEqual([{ entityId: '512', name: 'Visibility', prev: undefined }])
  })
})
