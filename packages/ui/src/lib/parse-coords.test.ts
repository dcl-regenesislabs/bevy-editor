import { describe, expect, it } from 'vitest'
import { parseCoords } from './parse-coords'

describe('parseCoords', () => {
  it('parses plain and negative coordinates', () => {
    expect(parseCoords('9,9')).toEqual({ x: 9, y: 9 })
    expect(parseCoords('-3,-2')).toEqual({ x: -3, y: -2 })
    expect(parseCoords('0,0')).toEqual({ x: 0, y: 0 })
    expect(parseCoords('-4,0')).toEqual({ x: -4, y: 0 })
  })

  it('rejects anything it cannot read instead of guessing a parcel', () => {
    expect(parseCoords(null)).toBeNull()
    expect(parseCoords('')).toBeNull()
    expect(parseCoords('9, 9')).toBeNull()
    expect(parseCoords(' 9,9')).toBeNull()
    expect(parseCoords('9,9,1')).toBeNull()
    expect(parseCoords('a,b')).toBeNull()
    expect(parseCoords('9.5,9')).toBeNull()
    expect(parseCoords('9')).toBeNull()
    expect(parseCoords('9,')).toBeNull()
  })
})
