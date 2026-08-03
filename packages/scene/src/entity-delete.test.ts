import { describe, it, expect, vi, beforeEach } from 'vitest'

// What undo needs is captured BEFORE the delete runs, and how much of it depends
// on which delete it was: the recursive one takes the children with it (they
// belong in the clip), the other two leave them in the scene (restoring them from
// a clip would duplicate entities that never went away).

vi.mock('./cmd', () => ({ cmd: {} }))

import { captureEntityDelete } from './inspector'
import { state } from './state'

const T = (parent: number, x = 0): Record<string, unknown> => ({
  Transform: { position: { x, y: 0, z: 0 }, parent }
})

describe('captureEntityDelete', () => {
  beforeEach(() => {
    // 512 (at scene root) with children 513 and 514, and a grandchild 515
    state.snapshot = {
      '512': { ...T(0), Visibility: { visible: true } },
      '513': T(512, 1),
      '514': T(512, 2),
      '515': T(513, 3)
    }
  })

  it('takes the whole subtree for a recursive delete', () => {
    const step = captureEntityDelete('512', 'subtree')
    expect(step?.clip.order).toEqual(['512', '513', '514', '515'])
    expect(step?.children).toEqual([]) // they are in the clip
    expect(step?.live).toBe('512')
  })

  it('takes the entity alone when the children stay, and remembers where they were', () => {
    const step = captureEntityDelete('512', 'keep-children')
    expect(step?.clip.order).toEqual(['512'])
    expect(step?.children.map((c) => c.entityId)).toEqual(['513', '514'])
    // their transforms as they stood — 'keep-children' is about to rewrite them
    expect(step?.children[0].before).toEqual({ position: { x: 1, y: 0, z: 0 }, parent: 512 })
  })

  it('clones, so the delete cannot mutate what undo replays', () => {
    const step = captureEntityDelete('512', 'entity')
    ;(state.snapshot['513'].Transform as { parent: number }).parent = 0
    state.snapshot['512'].Visibility = { visible: false }
    expect(step?.children[0].before).toEqual({ position: { x: 1, y: 0, z: 0 }, parent: 512 })
    expect(step?.clip.components['512'].Visibility).toEqual({ visible: true })
  })

  it('is null for an entity that is not there', () => {
    expect(captureEntityDelete('999', 'subtree')).toBeNull()
  })
})
