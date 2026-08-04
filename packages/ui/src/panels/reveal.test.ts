import { describe, expect, it } from 'vitest'
import {
  consumeRenameRequest,
  renameRequested,
  revealAndRename,
  revealInTree,
  revealSeq,
  revealTarget
} from './reveal'

// The rename request is one-shot state on a module the panel polls through the
// reveal counter — the failure it exists to prevent is a stale request landing
// on whatever row is revealed next.
describe('reveal-and-rename signal', () => {
  it('reveals the row and asks for the inline rename exactly once', () => {
    const before = revealSeq()
    revealAndRename('512')
    expect(revealTarget()).toBe('512')
    expect(revealSeq()).toBe(before + 1)
    expect(consumeRenameRequest()).toBe(true)
    expect(consumeRenameRequest()).toBe(false)
  })

  it('leaves a plain reveal alone', () => {
    revealInTree('512')
    expect(consumeRenameRequest()).toBe(false)
  })

  it('lets the shell peek without taking the request', () => {
    revealAndRename('512')
    expect(renameRequested()).toBe(true)
    expect(renameRequested()).toBe(true)
    expect(consumeRenameRequest()).toBe(true)
    expect(renameRequested()).toBe(false)
  })

  it('never lets a plain reveal inherit an unconsumed rename', () => {
    revealAndRename('512')
    revealInTree('513')
    expect(revealTarget()).toBe('513')
    expect(consumeRenameRequest()).toBe(false)
  })
})
