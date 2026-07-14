import { describe, expect, it } from 'vitest'
import { inlineJson, parseLoose, prettyJson, valueHint } from './json-value'

describe('parseLoose', () => {
  it('parses valid JSON to its typed value', () => {
    expect(parseLoose('{"a":1}')).toEqual({ a: 1 })
    expect(parseLoose('[1,2,3]')).toEqual([1, 2, 3])
    expect(parseLoose('123')).toBe(123)
    expect(parseLoose('true')).toBe(true)
    expect(parseLoose('null')).toBeNull()
  })

  it('falls back to the raw string for non-JSON input (no quotes needed)', () => {
    expect(parseLoose('hello')).toBe('hello')
    expect(parseLoose('{not json')).toBe('{not json')
  })

  it('trims before parsing but keeps the raw string on the fallback', () => {
    expect(parseLoose('  42  ')).toBe(42)
    expect(parseLoose('  hi ')).toBe('  hi ') // fallback returns the untrimmed input
  })

  it('maps empty/whitespace-only input to an empty string', () => {
    expect(parseLoose('')).toBe('')
    expect(parseLoose('   ')).toBe('')
  })
})

describe('valueHint', () => {
  it('labels each kind with a singular/plural count', () => {
    expect(valueHint(null)).toBe('null')
    expect(valueHint([1])).toBe('array · 1 item')
    expect(valueHint([1, 2])).toBe('array · 2 items')
    expect(valueHint({ a: 1 })).toBe('object · 1 field')
    expect(valueHint({ a: 1, b: 2 })).toBe('object · 2 fields')
    expect(valueHint('abcd')).toBe('text · 4 chars')
    expect(valueHint(7)).toBe('number')
    expect(valueHint(true)).toBe('boolean')
  })
})

describe('json stringifiers', () => {
  it('prettyJson indents; inlineJson is compact', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(inlineJson({ a: 1 })).toBe('{"a":1}')
  })
  it('undefined stringifies to empty string, not the literal "undefined"', () => {
    expect(prettyJson(undefined)).toBe('')
    expect(inlineJson(undefined)).toBe('')
  })
})
