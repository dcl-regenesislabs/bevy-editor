import { describe, it, expect, vi, beforeEach } from 'vitest'

// The offer must track "is this entity still somewhere the code never put it",
// not "was something just edited". Move three times and undo once and it IS
// still displaced — the offer has to stay, and say so with the REMAINING
// difference, not the last drag's.

import type { CodeMove } from './code-move'

let card: { entity: string; move: CodeMove } | null = null
vi.mock('./ai-store', () => ({
  setPendingCodeMove: (entity: string, move: CodeMove) => {
    card = { entity, move }
  },
  clearPendingCodeMove: () => {
    card = null
  }
}))

import { noteCodeOrigin, refreshCodeMove, resetCodeOrigins } from './code-move-offer'
import { formatDelta } from './code-move'

const at = (x: number): { position: { x: number; y: number; z: number } } => ({ position: { x, y: 9, z: 22 } })

describe('the move-it-in-the-code offer', () => {
  beforeEach(() => {
    card = null
    resetCodeOrigins()
  })

  // the reported bug
  it('survives one undo of three moves — the entity is still displaced', () => {
    noteCodeOrigin('1790', 'Transform', at(38.6)) // where the code put it
    refreshCodeMove('1790', 'Transform', at(20), null)
    refreshCodeMove('1790', 'Transform', at(10), null)
    refreshCodeMove('1790', 'Transform', at(2), null)
    expect(card).not.toBeNull()
    // one undo: back to the second move, NOT back to the code's value
    refreshCodeMove('1790', 'Transform', at(10), null)
    expect(card).not.toBeNull()
    // and it reads from the CODE's value to where the entity is now — not from
    // the last move's start (2), which is what a per-edit card would have shown
    expect(formatDelta((card as { move: CodeMove }).move)).toBe('Moved (38.6, 9, 22) → (10, 9, 22)')
  })

  it('goes away only when the entity is back where the code puts it', () => {
    noteCodeOrigin('1790', 'Transform', at(38.6))
    refreshCodeMove('1790', 'Transform', at(2), null)
    expect(card).not.toBeNull()
    refreshCodeMove('1790', 'Transform', at(38.6), null)
    expect(card).toBeNull()
  })

  it('keeps the first value it saw as the origin, not the latest', () => {
    noteCodeOrigin('1790', 'Transform', at(38.6))
    noteCodeOrigin('1790', 'Transform', at(2)) // a later edit's `before` — ignored
    refreshCodeMove('1790', 'Transform', at(38.6), null)
    expect(card).toBeNull()
  })

  it('says nothing about an entity it never recorded an origin for', () => {
    refreshCodeMove('999', 'Transform', at(2), null)
    expect(card).toBeNull()
  })

  it('clears a component edit that is back to its original value', () => {
    noteCodeOrigin('1790', 'GltfContainer', { src: 'a.glb' })
    refreshCodeMove('1790', 'GltfContainer', { src: 'b.glb' }, null)
    expect(card).not.toBeNull()
    refreshCodeMove('1790', 'GltfContainer', { src: 'a.glb' }, null)
    expect(card).toBeNull()
  })

  it('forgets origins on restart — the code rebuilt every entity', () => {
    noteCodeOrigin('1790', 'Transform', at(38.6))
    resetCodeOrigins()
    refreshCodeMove('1790', 'Transform', at(2), null)
    expect(card).toBeNull()
  })
})
