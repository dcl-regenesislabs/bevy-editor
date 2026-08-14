import { describe, it, expect } from 'vitest'

// The four ways this data lies to a careless reader: rows arrive in no promised
// order, a bag is usually partial, a week with no row is not a week with zero
// visitors, and a period string is a UTC date that must be read locally.

import {
  hasNoData,
  platformValue,
  projectScene,
  RETENTION_MIN_VISITORS,
  trendOf,
  weeklySeries,
  type LocationMetrics,
  type MetricBag,
  type MetricRow,
  type WeekBucket
} from './metrics-read'

const row = (series: string | null, value: number): MetricRow => ({ series, period: null, value })
const weekRow = (period: string, value: number, series: string | null = 'all'): MetricRow => ({ series, period, value })

const loc = (metrics: MetricBag): LocationMetrics => ({
  location_key: 'cozyfarm.dcl.eth|0|0',
  builder_project_id: null,
  metrics
})

const day = (y: number, m: number, d: number): number => new Date(y, m - 1, d).getTime()

const MONDAYS = ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03']

const bucket = (value: number | null, partial = false): WeekBucket => ({ start: 0, value, partial })

describe('platformValue', () => {
  it('picks the series it was asked for, whatever order the rows arrive in', () => {
    const bag = { unique_visitors_30d: [row('mobile', 2583), row('desktop', 50), row('all', 2772)] }
    expect(platformValue(bag, 'unique_visitors_30d', 'all')).toBe(2772)
    expect(platformValue(bag, 'unique_visitors_30d', 'desktop')).toBe(50)
    expect(platformValue(bag, 'unique_visitors_30d', 'mobile')).toBe(2583)
  })

  it('reports an absent metric and an absent series as absent, not as zero', () => {
    const bag = { unique_visitors_30d: [row('all', 2772)] }
    expect(platformValue(bag, 'unique_visitors_30d', 'mobile')).toBeNull()
    expect(platformValue(bag, 'd7_retention_rate_30d', 'all')).toBeNull()
    expect(platformValue({}, 'unique_visitors_30d', 'all')).toBeNull()
  })
})

describe('hasNoData', () => {
  it('is an empty bag and nothing else', () => {
    expect(hasNoData(loc({}))).toBe(true)
    expect(hasNoData(loc({ unique_visitors_30d: [row('all', 0)] }))).toBe(false)
  })
})

describe('weeklySeries', () => {
  const bag = {
    unique_visitors_weekly: [
      weekRow('2026-07-06', 310),
      weekRow('2026-06-15', 180),
      weekRow('2026-06-29', 240),
      weekRow('2026-06-22', 999, 'desktop')
    ]
  }

  it('reads the Monday at LOCAL midnight, not the UTC instant', () => {
    const weeks = weeklySeries(bag, 'unique_visitors_weekly', 'all')
    expect(new Date(weeks[0].start).getDate()).toBe(15)
    expect(weeks[0].start).toBe(day(2026, 6, 15))
  })

  it('sorts ascending and keeps a week with no row as a gap, never a zero', () => {
    expect(weeklySeries(bag, 'unique_visitors_weekly', 'all')).toEqual([
      { start: day(2026, 6, 15), value: 180 },
      { start: day(2026, 6, 22), value: null },
      { start: day(2026, 6, 29), value: 240 },
      { start: day(2026, 7, 6), value: 310 }
    ])
  })

  it('has nothing to plot when the series it was asked for has no rows', () => {
    expect(weeklySeries(bag, 'unique_visitors_weekly', 'mobile')).toEqual([])
    expect(weeklySeries({}, 'unique_visitors_weekly', 'all')).toEqual([])
  })
})

describe('trendOf', () => {
  const eight = (values: number[]): WeekBucket[] => values.map((v) => bucket(v))

  it('calls it growing when the recent half clears the earlier one by more than the band', () => {
    expect(trendOf(eight([260, 260, 260, 260, 383, 383, 383, 383]))).toEqual({ kind: 'up', recent: 383, prior: 260 })
  })

  it('calls it falling the same way in reverse', () => {
    expect(trendOf(eight([383, 383, 383, 383, 260, 260, 260, 260]))).toEqual({ kind: 'down', recent: 260, prior: 383 })
  })

  it('calls a swing inside the band the same number, not a direction', () => {
    expect(trendOf(eight([380, 380, 390, 390, 400, 400, 380, 380]))).toMatchObject({ kind: 'flat' })
  })

  it('refuses a direction when the numbers are a handful of people', () => {
    expect(trendOf(eight([10, 10, 10, 10, 25, 25, 25, 25]))).toEqual({ kind: 'small', recent: 25, prior: 10 })
  })

  it('says nothing at all without eight complete weeks', () => {
    expect(trendOf(eight([260, 260, 260, 260, 383, 383, 383]))).toEqual({ kind: 'unknown', recent: 0, prior: 0 })
    expect(trendOf([bucket(null), ...eight([260, 260, 260, 383, 383, 383, 383])])).toMatchObject({ kind: 'unknown' })
    expect(trendOf([])).toMatchObject({ kind: 'unknown' })
  })

  it('leaves the week that is still filling out of both halves', () => {
    const nine = [...eight([100, 100, 100, 100, 100, 100, 100, 100]), bucket(9999, true)]
    expect(trendOf(nine)).toEqual({ kind: 'flat', recent: 100, prior: 100 })
  })
})

describe('projectScene', () => {
  const full = loc({
    unique_visitors_30d: [row('all', 2772), row('desktop', 50), row('mobile', 2583)],
    unique_visits_30d: [row('all', 6100)],
    avg_playtime_seconds_30d: [row('all', 241.2)],
    d7_retention_rate_30d: [row('all', 0.083816)],
    unique_visitors_weekly: MONDAYS.map((p, i) => weekRow(p, [180, 220, 240, 310, 520, 620, 540, 412][i]))
  })

  it('reads every element the Visitors block prints', () => {
    const v = projectScene(full, '2026-08-12T00:17:01.099Z')
    expect(v.visitors).toBe(2772)
    expect(v.visitsEach).toBeCloseTo(2.2, 1)
    expect(v.playtimeSeconds).toBe(241.2)
    expect(v.retention).toBeCloseTo(0.083816, 6)
    expect(v.retentionSuppressed).toBe(false)
    expect(v.desktop).toBe(50)
    expect(v.mobile).toBe(2583)
    // the default window is 30 days, so the chart is cut to it — the trend still
    // reads the full horizon underneath, which is why it can still say "up"
    expect(v.weeks).toHaveLength(5)
    expect(v.trend).toMatchObject({ kind: 'up' })
  })

  it('runs the weeks to the export stamp, so a quiet last week is a gap and not an early ending', () => {
    const quiet = loc({
      unique_visitors_weekly: MONDAYS.slice(0, 4).map((p, i) => weekRow(p, [180, 220, 240, 310][i]))
    })
    // rows stop at 6 Jul; the export knows about everything up to 12 Aug
    const v = projectScene(quiet, '2026-08-12T00:17:01.099Z', '60d')
    expect(v.weeks).toHaveLength(9)
    expect(v.weeks.slice(4).every((b) => b.value === null)).toBe(true)
    expect(new Date(v.weeks[8].start).getDate()).toBe(10)
  })

  it('never adds desktop and mobile into a total — they do not make `all`', () => {
    const v = projectScene(full, null)
    expect((v.desktop ?? 0) + (v.mobile ?? 0)).not.toBe(v.visitors)
  })

  it('falls back field by field, because a partial bag is the normal answer', () => {
    const v = projectScene(loc({ unique_visitors_30d: [row('all', 2772)] }), '2026-08-12T00:17:01.099Z')
    expect(v.visitors).toBe(2772)
    expect(v.visitsEach).toBeNull()
    expect(v.playtimeSeconds).toBeNull()
    expect(v.retention).toBeNull()
    expect(v.retentionSuppressed).toBe(false)
    expect(v.mobile).toBeNull()
    expect(v.weeks).toEqual([])
    expect(v.trend).toMatchObject({ kind: 'unknown' })
  })

  it('drops the visits-each clause rather than dividing by nobody', () => {
    const v = projectScene(loc({ unique_visitors_30d: [row('all', 0)], unique_visits_30d: [row('all', 0)] }), null)
    expect(v.visitsEach).toBeNull()
  })

  it(`withholds the return rate under ${RETENTION_MIN_VISITORS} visitors and hands it over at exactly that many`, () => {
    const withVisitors = (n: number): LocationMetrics =>
      loc({ unique_visitors_30d: [row('all', n)], d7_retention_rate_30d: [row('all', 0.5)] })
    expect(projectScene(withVisitors(29), null)).toMatchObject({ retention: null, retentionSuppressed: true })
    expect(projectScene(withVisitors(30), null)).toMatchObject({ retention: 0.5, retentionSuppressed: false })
    expect(projectScene(withVisitors(31), null)).toMatchObject({ retention: 0.5, retentionSuppressed: false })
  })

  it('explains an absent rate as an absence, not as a suppression', () => {
    const v = projectScene(loc({ unique_visitors_30d: [row('all', 12)] }), null)
    expect(v.retention).toBeNull()
    expect(v.retentionSuppressed).toBe(false)
  })

  it('marks the week that has not finished at the export stamp', () => {
    const v = projectScene(full, '2026-08-05T00:17:01.099Z', '60d')
    // one quiet week ahead of the first answered row: the 60-day window opens 6 Jun
    expect(v.weeks.map((w) => w.partial)).toEqual([false, false, false, false, false, false, false, false, true])
    expect(v.weeks[0].value).toBeNull()
  })

  it('opens the window 60 days back, so quiet weeks before the first visitor are drawn too', () => {
    // rows only from 6 Jul, but the export covers everything back to ~15 Jun
    const late = loc({
      unique_visitors_weekly: MONDAYS.slice(3).map((p, i) => weekRow(p, [310, 520, 620, 540, 412][i]))
    })
    const v = projectScene(late, '2026-08-14T00:17:01.099Z', '60d')
    expect(new Date(v.weeks[0].start).getDate()).toBe(15) // 15 Jun, not 6 Jul
    expect(v.weeks.slice(0, 3).every((b) => b.value === null)).toBe(true)
    expect(v.weeks).toHaveLength(9)
  })

  it('cuts the chart to the chosen window while the trend keeps the full horizon', () => {
    const thirty = projectScene(full, '2026-08-12T00:17:01.099Z', '30d')
    const sixty = projectScene(full, '2026-08-12T00:17:01.099Z', '60d')
    expect(thirty.weeks).toHaveLength(5)
    expect(sixty.weeks).toHaveLength(9)
    expect(new Date(thirty.weeks[0].start).getDate()).toBe(13) // 13 Jul, the 30-day boundary
    // both read the same eight complete weeks, so the sentence does not change
    expect(thirty.trend).toEqual(sixty.trend)
    expect(thirty.trend.kind).toBe('up')
  })

  it('reads the export stamp as a date, not as an instant', () => {
    // The boundary is a date; the buckets start at local midnight. Left as an
    // instant, a stamp of 00:17 pushes the boundary past the Monday sitting on it
    // and drops a week — but only where the local clock reads past midnight, so
    // it passed locally and failed on a UTC runner. Both stamps below land on the
    // same local date in every real timezone (offsets are 15-minute multiples),
    // so the window they open must be identical. A stamp far enough apart to
    // cross into another local date SHOULD move the window, and is not pinned.
    const at = (time: string): number[] =>
      projectScene(full, `2026-08-12T${time}`, '30d').weeks.map((b) => b.start)
    expect(at('00:17:01.099Z')).toEqual(at('00:00:00.000Z'))
  })

  it('marks nothing partial when there is no export stamp to compare against', () => {
    expect(projectScene(full, null).weeks.every((w) => !w.partial)).toBe(true)
  })
})
