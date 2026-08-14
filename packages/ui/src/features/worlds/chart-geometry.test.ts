import { describe, it, expect } from 'vitest'

// The encoding rules the Visitors chart cannot break: bars start at zero, a week
// with no row is a gap rather than a zero, the publish rule only appears where it
// really falls, and the caption says exactly as much as the data supports.

import {
  barPercent,
  captionOf,
  extentOf,
  markerPercent,
  niceMax,
  weekLabel,
  type ChartBucket
} from './chart-geometry'

// Local midnight, the way metrics-read parses a period.
const day = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime()

const WEEKS: ChartBucket[] = [
  { start: day(2026, 6, 15), value: 180 },
  { start: day(2026, 6, 22), value: null },
  { start: day(2026, 6, 29), value: 240 },
  { start: day(2026, 7, 6), value: 310 },
  { start: day(2026, 7, 13), value: 520 },
  { start: day(2026, 7, 20), value: 620 },
  { start: day(2026, 7, 27), value: 540 },
  { start: day(2026, 8, 3), value: 412 }
]

describe('niceMax', () => {
  it('wastes no headroom on the tallest bar', () => {
    expect(niceMax([180, 620])).toBe(620)
    expect(niceMax([621])).toBe(630)
    expect(niceMax([1234])).toBe(1300)
  })

  it('leaves no floating-point residue', () => {
    expect(niceMax([7])).toBe(7)
    expect(niceMax([43])).toBe(43)
  })

  it('has nothing to scale when there is nothing to plot', () => {
    expect(niceMax([null, null])).toBe(0)
    expect(niceMax([])).toBe(0)
    expect(niceMax([0])).toBe(0)
  })
})

describe('barPercent', () => {
  it('measures from zero, so length is the value', () => {
    expect(barPercent(620, 620)).toBe(100)
    expect(barPercent(310, 620)).toBe(50)
    expect(barPercent(180, 620)).toBeCloseTo(29.03, 2)
  })

  it('gives a week with no row no bar at all', () => {
    expect(barPercent(null, 620)).toBeNull()
  })

  it('never overflows the plot', () => {
    expect(barPercent(700, 620)).toBe(100)
    expect(barPercent(-5, 620)).toBe(0)
    expect(barPercent(5, 0)).toBe(0)
  })
})

describe('extentOf', () => {
  it('runs from the first Monday to the end of the last week', () => {
    expect(extentOf(WEEKS)).toEqual({ start: day(2026, 6, 15), end: day(2026, 8, 3) + 7 * 86400000 })
    expect(extentOf([])).toBeNull()
  })
})

describe('markerPercent', () => {
  const ext = extentOf(WEEKS)!

  it('lands on the right day inside its own week', () => {
    // 16 Jul is day 3 of the 13 Jul bucket, the fifth of eight columns.
    const pct = markerPercent(day(2026, 7, 16), ext.start, ext.end)!
    expect(pct).toBeGreaterThan(50)
    expect(pct).toBeLessThan(62.5)
    expect(pct).toBeCloseTo(55.36, 0)
  })

  it('is null outside the window, which is what drops the caption clause', () => {
    expect(markerPercent(day(2026, 6, 14), ext.start, ext.end)).toBeNull()
    expect(markerPercent(day(2026, 8, 11), ext.start, ext.end)).toBeNull()
    expect(markerPercent(null, ext.start, ext.end)).toBeNull()
  })

  it('keeps both edges of the window', () => {
    expect(markerPercent(ext.start, ext.start, ext.end)).toBe(0)
    expect(markerPercent(ext.end, ext.start, ext.end)).toBe(100)
  })
})

describe('weekLabel', () => {
  it('reads as a date a creator writes, with no leading zero', () => {
    expect(weekLabel(day(2026, 6, 15))).toBe('15 Jun')
    expect(weekLabel(day(2026, 8, 3))).toBe('3 Aug')
  })
})

describe('captionOf', () => {
  it('is the title, the range, the extreme and the legend in one sentence', () => {
    expect(captionOf(WEEKS, 55.36)).toBe(
      'Visitors per week, 15 Jun to 3 Aug — the busiest week was 620. The dashed line is when you last published this scene.'
    )
  })

  it('drops the marker clause when the rule is not drawn', () => {
    expect(captionOf(WEEKS, null)).toBe('Visitors per week, 15 Jun to 3 Aug — the busiest week was 620.')
  })

  it('groups a busiest week that runs into thousands', () => {
    expect(captionOf([{ start: day(2026, 6, 15), value: 2772 }], null)).toContain('the busiest week was 2,772.')
  })

  it('claims no busiest week when no week has a number', () => {
    const empty = WEEKS.map((b) => ({ ...b, value: null }))
    expect(captionOf(empty, null)).toBe('Visitors per week, 15 Jun to 3 Aug.')
    expect(captionOf([], null)).toBe('')
  })
})
