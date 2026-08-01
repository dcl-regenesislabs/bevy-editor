import { describe, it, expect } from 'vitest'
import { buildCodeMove, buildCodeEdit, codeMovePrompt, formatDelta, fmt } from './code-move'

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

// Typing a value in the inspector is exactly as unsaveable as dragging one, so
// the same card has to appear for it — this is the non-Transform path.
describe('buildCodeEdit', () => {
  const edit = (name: string, before: unknown, after: unknown) => ({ name, before, after })

  it('names the single field that changed', () => {
    const e = buildCodeEdit([edit('GltfContainer', { src: 'a.glb' }, { src: 'b.glb' })], 'Fountain')
    expect(formatDelta(e!)).toBe('Changed GltfContainer.src')
  })

  it('carries the real before -> after values into the prompt', () => {
    const e = buildCodeEdit(
      [edit('AudioSource', { audioClipUrl: 'old.mp3', volume: 0.5 }, { audioClipUrl: 'new.mp3', volume: 1 })],
      'Lobby Drift'
    )!
    const text = codeMovePrompt(e)
    expect(text).toContain('AudioSource.audioClipUrl: "old.mp3" → "new.mp3"')
    expect(text).toContain('AudioSource.volume: 0.5 → 1')
    // the whole point: never tell the assistant to go look it up
    expect(text).not.toMatch(/see the editor/i)
  })

  it('reports only the leaves that actually differ', () => {
    const e = buildCodeEdit([edit('T', { a: 1, b: 2 }, { a: 1, b: 3 })], null)!
    expect(e.fields[0].changes).toEqual([{ path: 'b', before: '2', after: '3' }])
  })

  it('walks nested objects into dotted paths', () => {
    const e = buildCodeEdit([edit('M', { albedo: { r: 1, g: 0 } }, { albedo: { r: 1, g: 0.5 } })], null)!
    expect(e.fields[0].changes).toEqual([{ path: 'albedo.g', before: '0', after: '0.5' }])
  })

  it('marks a newly set value rather than printing undefined', () => {
    const e = buildCodeEdit([edit('X', {}, { volume: 1 })], null)!
    expect(e.fields[0].changes[0]).toEqual({ path: 'volume', before: '(unset)', after: '1' })
  })

  it('summarises when several components changed', () => {
    const e = buildCodeEdit([edit('TextShape', { t: 'a' }, { t: 'b' }), edit('Material', { x: 1 }, { x: 2 })], null)!
    expect(formatDelta(e)).toBe('Changed TextShape.t +1 more')
  })

  it('is null when nothing identifiable changed', () => {
    expect(buildCodeEdit([], 'x')).toBeNull()
    expect(buildCodeEdit([edit('', 1, 2)], 'x')).toBeNull()
  })

  it('asks the assistant to change it, and never names an entity id', () => {
    const text = codeMovePrompt(buildCodeEdit([edit('GltfContainer', { src: 'a' }, { src: 'b' })], 'Fountain')!)
    expect(text).toMatch(/changed/)
    expect(text).toMatch(/GltfContainer/)
    expect(text).not.toMatch(/\b(entity\s*#?\d{2,}|id\s*\d+)\b/i)
  })
})
