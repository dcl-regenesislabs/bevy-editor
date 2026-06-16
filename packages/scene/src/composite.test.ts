import { describe, it, expect } from 'vitest'
import { isAuthoredEntity } from './composite'

describe('isAuthoredEntity', () => {
  it('treats the scene root (0) as authored', () => {
    expect(isAuthoredEntity(0)).toBe(true)
  })

  it('treats reserved entities (1..511) as NOT authored', () => {
    expect(isAuthoredEntity(1)).toBe(false)
    expect(isAuthoredEntity(5)).toBe(false) // the world origin
    expect(isAuthoredEntity(511)).toBe(false)
  })

  it('treats scene entities (>=512) as authored', () => {
    expect(isAuthoredEntity(512)).toBe(true)
    expect(isAuthoredEntity(99999)).toBe(true)
  })
})
