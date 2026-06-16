import { describe, it, expect } from 'vitest'
import { deepEqual, optionForSource, defaultSelection, type DiffRow } from './save-diff'

describe('deepEqual', () => {
  it('treats float64 vs float32-rounded numbers as equal (the reload-churn case)', () => {
    // 0.1 stored as f32 and re-emitted differs from 0.1 at ~1 ULP; deepEqual must ignore that.
    expect(deepEqual(0.1, Math.fround(0.1))).toBe(true)
    expect(deepEqual(1 / 3, Math.fround(1 / 3))).toBe(true)
  })

  it('applies the float32 tolerance at EVERY nesting level, not just the top', () => {
    // Refutes the assumption that nested floats are compared as float64.
    const a = { position: { x: 0.1, y: 0.2, z: 0.3 } }
    const b = { position: { x: Math.fround(0.1), y: Math.fround(0.2), z: Math.fround(0.3) } }
    expect(deepEqual(a, b)).toBe(true)
    const arr = [{ p: [0.1, 0.2] }]
    expect(deepEqual(arr, [{ p: [Math.fround(0.1), Math.fround(0.2)] }])).toBe(true)
  })

  it('distinguishes genuinely different numbers (beyond f32 ULP)', () => {
    expect(deepEqual(0.1, 0.2)).toBe(false)
    expect(deepEqual({ x: 1 }, { x: 1.5 })).toBe(false)
  })

  it('compares arrays by length and element-wise', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
    expect(deepEqual([1, 2, 3], { 0: 1, 1: 2, 2: 3 })).toBe(false) // array vs object
  })

  it('compares objects by key set and value', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true) // order-independent
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false) // extra key
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false) // missing key
  })

  it('handles null / undefined / type mismatches', () => {
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual(undefined, undefined)).toBe(true)
    expect(deepEqual(1, '1')).toBe(false)
  })
})

describe('option collapse (optionForSource / defaultSelection)', () => {
  const row = (cells: DiffRow['cells'], options: DiffRow['options']): DiffRow => ({
    entityId: '512',
    component: 'Transform',
    cells,
    options
  })

  it('returns the requested source when it is its own distinct option', () => {
    const r = row(
      { initial: { present: true, value: 1 }, editor: { present: true, value: 2 }, live: { present: true, value: 3 } },
      ['initial', 'editor', 'live']
    )
    expect(optionForSource(r, 'live')).toBe('live')
    expect(defaultSelection(r)).toBe('editor')
  })

  it('collapses a source onto an equal earlier option', () => {
    // live == editor: asking for live returns the editor button (the surviving option)
    const r = row(
      { initial: { present: true, value: 1 }, editor: { present: true, value: 2 }, live: { present: true, value: 2 } },
      ['initial', 'editor']
    )
    expect(optionForSource(r, 'live')).toBe('editor')
    expect(defaultSelection(r)).toBe('editor')
  })

  it('falls back to the first option when nothing matches', () => {
    const r = row(
      { initial: { present: true, value: 1 }, editor: { present: false }, live: { present: false } },
      ['initial']
    )
    expect(optionForSource(r, 'live')).toBe('initial')
  })
})
