import { describe, expect, it } from 'vitest'
import { formatCount, formatMinutes, formatPercent1 } from './format'

describe('formatCount', () => {
  it('groups thousands and never compacts', () => {
    expect(formatCount(2772)).toBe('2,772')
    expect(formatCount(1470000)).toBe('1,470,000')
    expect(formatCount(50)).toBe('50')
    expect(formatCount(0)).toBe('0')
  })

  it('renders an absent count as an em dash', () => {
    expect(formatCount(null)).toBe('—')
    expect(formatCount(NaN)).toBe('—')
  })
})

describe('formatPercent1', () => {
  it('scales a 0–1 ratio to one decimal place', () => {
    expect(formatPercent1(0.083816)).toBe('8.4%')
    expect(formatPercent1(0)).toBe('0.0%')
    expect(formatPercent1(1)).toBe('100.0%')
  })

  it('renders an absent ratio as an em dash', () => {
    expect(formatPercent1(null)).toBe('—')
    expect(formatPercent1(NaN)).toBe('—')
  })
})

describe('formatMinutes', () => {
  it('converts seconds to minutes at one decimal place', () => {
    expect(formatMinutes(241.2)).toBe('4.0 min')
    expect(formatMinutes(90)).toBe('1.5 min')
    expect(formatMinutes(0)).toBe('0.0 min')
  })

  it('renders absent seconds as an em dash', () => {
    expect(formatMinutes(null)).toBe('—')
    expect(formatMinutes(NaN)).toBe('—')
  })
})
