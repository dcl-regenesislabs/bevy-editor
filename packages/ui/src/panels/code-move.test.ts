import { describe, it, expect } from 'vitest'
import { buildCodeMove, codeMovePrompt, formatDelta, fmt } from './code-move'

const at = (x: number, y: number, z: number) => ({ position: { x, y, z } })

describe('buildCodeMove', () => {
  it('returns null when nothing moved', () => {
    expect(buildCodeMove(at(1, 2, 3), at(1, 2, 3), null)).toBeNull()
  })

  it('ignores sub-threshold jitter', () => {
    expect(buildCodeMove(at(1, 2, 3), at(1.001, 2, 3), null)).toBeNull()
  })

  it('captures only the channels that changed', () => {
    const move = buildCodeMove(
      { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { position: { x: 4, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      null
    )
    expect(move?.position).not.toBeNull()
    expect(move?.scale).toBeNull()
    expect(move?.rotation).toBeNull()
  })

  it('survives a missing or malformed transform', () => {
    expect(buildCodeMove(undefined, at(1, 1, 1), null)).toBeNull()
    expect(buildCodeMove(at(0, 0, 0), { position: { x: 1, y: null } }, null)).toBeNull()
  })

  it('drops a blank label', () => {
    expect(buildCodeMove(at(0, 0, 0), at(1, 0, 0), '   ')?.label).toBeNull()
  })
})

describe('formatting', () => {
  it('rounds to 2dp without trailing zeros', () => {
    expect(fmt({ x: 8, y: 0, z: 8 })).toBe('(8, 0, 8)')
    expect(fmt({ x: 12.005, y: 0.5, z: 6.129 })).toBe('(12.01, 0.5, 6.13)')
  })

  it('summarises the leading channel', () => {
    const move = buildCodeMove(at(8, 0, 8), at(12, 0.5, 6), null)!
    expect(formatDelta(move)).toBe('Moved (8, 0, 8) → (12, 0.5, 6)')
  })
})

describe('codeMovePrompt', () => {
  const move = buildCodeMove(at(8, 0, 8), at(12, 0.5, 6), 'Balloon')!

  it('never names an entity id', () => {
    expect(codeMovePrompt(move)).not.toMatch(/\b(entity\s*#?\d{2,}|id\s*\d+)\b/i)
  })

  it('quotes the label and both poses', () => {
    const text = codeMovePrompt(move)
    expect(text).toContain('"Balloon"')
    expect(text).toContain('(8, 0, 8)')
    expect(text).toContain('(12, 0.5, 6)')
  })

  it('omits channels that did not change', () => {
    const text = codeMovePrompt(move)
    expect(text).toContain('position:')
    expect(text).not.toContain('scale:')
    expect(text).not.toContain('rotation')
  })

  it('asks for a constant or param rather than a hardcoded value', () => {
    expect(codeMovePrompt(move)).toMatch(/constant|param/i)
  })

  it('falls back to a generic noun with no label', () => {
    const text = codeMovePrompt(buildCodeMove(at(0, 0, 0), at(1, 0, 0), null)!)
    expect(text).toContain('the entity your code spawns')
  })
})
