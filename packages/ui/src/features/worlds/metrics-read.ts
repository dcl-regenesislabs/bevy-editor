// Reading one scene's metrics bag, and the render model the Visitors block draws.
//
// Every location comes back as a bag of metric name -> rows; a row carries the
// platform it counts (`all` / `desktop` / `mobile`, or null for the five
// single-series metrics) and, for the three weekly metrics, the Monday its week
// starts. Bags are routinely partial — 8 of the 17 keys is a normal answer — so
// every reading below falls back on its own to null and no absence is an
// incident.

export interface MetricRow {
  series: string | null
  period: string | null // "YYYY-MM-DD", always a Monday; null on the 14 trailing-window metrics
  value: number
}
export type MetricBag = Record<string, MetricRow[]>
export interface LocationMetrics {
  // the service's own ids. Kept for support (they are what its logs show) and
  // never read: our identity for a scene is the key we sent it under.
  location_key: string
  builder_project_id: string | null
  metrics: MetricBag
}

export type Series = 'all' | 'desktop' | 'mobile'

export interface WeekBucket {
  start: number // epoch ms at LOCAL midnight of the week's Monday
  value: number | null // null = no row that week; a hole is not a zero
  partial: boolean // the week is still filling at the export stamp
}

export interface TrendVerdict {
  kind: 'up' | 'flat' | 'down' | 'small' | 'unknown'
  recent: number // mean visitors a week over the last four complete weeks
  prior: number // ...and over the four before them
}

export interface SceneView {
  visitors: number | null
  visitsEach: number | null // visits ÷ visitors; null when either is missing or nobody came
  trend: TrendVerdict
  playtimeSeconds: number | null
  retention: number | null // ratio 0–1; null when absent OR withheld under the floor
  retentionSuppressed: boolean // a rate exists but too few visitors for it to mean anything
  mobile: number | null
  desktop: number | null
  weeks: WeekBucket[]
}

const VISITORS_30D = 'unique_visitors_30d'
const VISITS_30D = 'unique_visits_30d'
const PLAYTIME_30D = 'avg_playtime_seconds_30d'
const RETENTION_30D = 'd7_retention_rate_30d'
const VISITORS_WEEKLY = 'unique_visitors_weekly'

// Below this a return rate is one or two wallets wide and reads as precision it
// does not have, so the tile shows a dash and says why.
export const RETENTION_MIN_VISITORS = 30

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const PERIOD = /^(\d{4})-(\d{2})-(\d{2})$/

// `.find` on the series, never rows[0]: a platform-split metric answers three
// rows in an order the service never promised, so an index read hands back
// desktop's number under the label "all".
export function platformValue(bag: MetricBag, name: string, series: Series): number | null {
  const row = (bag[name] ?? []).find((r) => r.series === series)
  return row === undefined || !Number.isFinite(row.value) ? null : row.value
}

// `singleValue(bag, name)` is deliberately absent. The five metrics that answer
// with series: null — concurrent_users_avg_30d/_60d, concurrent_users_peak_30d/
// _60d and socially_engaged_ratio_weekly — are none of them rendered. Adding one
// means adding its reader in the same change: reading a split metric without
// naming a series yields the wrong number with no symptom at all.

// Parsed by hand at LOCAL midnight: `new Date('2026-07-27')` is UTC, which
// labels every bucket a day early anywhere west of Greenwich.
function localMidnight(period: string): number | null {
  const m = PERIOD.exec(period)
  if (m === null) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

// Ascending, with the weeks between the first and last row filled in. A week the
// service did not answer for stays null and draws no bar — zero-filling a hole
// would report an outage as an audience that left. Stepping by calendar days
// rather than 7×24h keeps every start at local midnight across a DST change.
export function weeklySeries(
  bag: MetricBag,
  name: string,
  series: Series
): Array<{ start: number; value: number | null }> {
  const byStart = new Map<number, number>()
  for (const r of bag[name] ?? []) {
    if (r.series !== series || r.period === null || !Number.isFinite(r.value)) continue
    const start = localMidnight(r.period)
    if (start !== null) byStart.set(start, r.value)
  }
  if (byStart.size === 0) return []
  const starts = [...byStart.keys()].sort((a, b) => a - b)
  const last = starts[starts.length - 1]
  const out: Array<{ start: number; value: number | null }> = []
  const cursor = new Date(starts[0])
  while (cursor.getTime() <= last) {
    const start = cursor.getTime()
    out.push({ start, value: byStart.get(start) ?? null })
    cursor.setDate(cursor.getDate() + 7)
  }
  return out
}

// An empty bag means EITHER "this wallet may not read this location" OR "no rows
// in today's export", and the service will not say which. It is never an error.
export function hasNoData(loc: LocationMetrics): boolean {
  return Object.keys(loc.metrics).length === 0
}

const HALF = 4 // weeks per half; two disjoint halves, never a trailing window inside another
const BAND = 0.15 // within ±15% of the earlier half is the same number, not a direction
const MIN_MEAN = 30 // under this a swing is a handful of people, not a trend

// Two disjoint four-week halves over the same ~8-week horizon, so "before" and
// "after" really are before and after. Only complete weeks count, and all eight
// must be present: the sentence is the one claim this tab makes rather than
// reports, so it refuses to speak on a gap.
// `recent`/`prior` are rounded here so the component stays free of arithmetic;
// the comparison itself uses the unrounded means.
export function trendOf(buckets: WeekBucket[]): TrendVerdict {
  const tail = buckets.filter((b) => !b.partial).slice(-HALF * 2)
  if (tail.length < HALF * 2 || tail.some((b) => b.value === null)) return { kind: 'unknown', recent: 0, prior: 0 }
  const mean = (part: WeekBucket[]): number => part.reduce((sum, b) => sum + (b.value ?? 0), 0) / part.length
  const recent = mean(tail.slice(HALF))
  const prior = mean(tail.slice(0, HALF))
  const said = { recent: Math.round(recent), prior: Math.round(prior) }
  if (Math.max(recent, prior) < MIN_MEAN) return { kind: 'small', ...said }
  if (recent >= prior * (1 + BAND)) return { kind: 'up', ...said }
  if (recent <= prior * (1 - BAND)) return { kind: 'down', ...said }
  return { kind: 'flat', ...said }
}

// One scene's whole render model.
//
// There is no world-level total here and there cannot be one: unique visitors do
// not add across scenes — the same person can walk through two of them — which is
// the same non-additivity the service proves inside a single scene, where `all`
// (2,772) is nowhere near desktop (50) plus mobile (2,583). A world total would
// have to be a sum, so it would be wrong, so it does not exist.
export function projectScene(loc: LocationMetrics, exportedAt: string | null): SceneView {
  const bag = loc.metrics
  const visitors = platformValue(bag, VISITORS_30D, 'all')
  const visits = platformValue(bag, VISITS_30D, 'all')
  const rate = platformValue(bag, RETENTION_30D, 'all')
  // suppression explains a rate we are withholding; a rate the export simply
  // does not carry is a plain absence and says so itself
  const suppressed = rate !== null && visitors !== null && visitors < RETENTION_MIN_VISITORS
  const stamp = exportedAt === null ? NaN : Date.parse(exportedAt)
  const weeks = weeklySeries(bag, VISITORS_WEEKLY, 'all').map((b) => ({
    ...b,
    partial: Number.isFinite(stamp) && b.start + WEEK_MS > stamp
  }))
  return {
    visitors,
    visitsEach: visits === null || visitors === null || visitors === 0 ? null : visits / visitors,
    trend: trendOf(weeks),
    playtimeSeconds: platformValue(bag, PLAYTIME_30D, 'all'),
    retention: suppressed ? null : rate,
    retentionSuppressed: suppressed,
    mobile: platformValue(bag, VISITORS_30D, 'mobile'),
    desktop: platformValue(bag, VISITORS_30D, 'desktop'),
    weeks
  }
}
