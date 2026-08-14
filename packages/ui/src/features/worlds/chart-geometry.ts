// Geometry and caption for the Visitors bar chart. Pure: the chart component is
// a comment-free .tsx that only interpolates these numbers into inline styles,
// so every calculation and every reason for it lives here.
import { formatCount } from '../../lib/format'

// Structural — metrics-read's buckets carry more fields and pass as-is.
export interface ChartBucket {
  start: number // epoch ms at LOCAL midnight of the week's Monday
  value: number | null // null = no row that week; a hole is not a zero
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// The chart draws no gridlines and prints every value as text above its bar, so
// the maximum is a denominator and nothing else — it is never labelled and never
// counted to. Rounding up to two significant figures keeps the tallest bar
// between 91% and 100% of the plot instead of wasting a third of the height on
// the "rounder" 1/2/5 ladder (620 → 620, not 800). toPrecision cleans up the
// binary-float residue that ceil-to-a-fractional-step leaves behind (7 → 7, not
// 7.000000000000001).
export function niceMax(values: Array<number | null>): number {
  let max = 0
  for (const v of values) if (v !== null && v > max) max = v
  if (max <= 0) return 0 // all-null, all-zero or empty: barPercent guards the divide
  const step = 10 ** Math.floor(Math.log10(max)) / 10
  return Number((Math.ceil(max / step) * step).toPrecision(12))
}

// Bar height as a percentage of the plot. The baseline is ALWAYS zero: a bar
// encodes its value by length, so a truncated baseline makes 520 look like half
// of 620. `null` in, `null` out — a week with no row draws no bar at all, and
// returning 0 here would render the zero-height sliver copy #14 forbids.
export function barPercent(value: number | null, max: number): number | null {
  if (value === null) return null
  if (max <= 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

// The plotted extent: first bucket's Monday to the end of the last bucket's
// week. Kept here so the component never does date arithmetic of its own.
export function extentOf(buckets: ChartBucket[]): { start: number; end: number } | null {
  if (buckets.length === 0) return null
  return { start: buckets[0].start, end: buckets[buckets.length - 1].start + WEEK_MS }
}

// Where the publish rule sits, as a percentage of the plot width. The columns
// are equal and each covers exactly one week, so a linear map over the extent
// lands the rule on the right day inside its own column.
// `null` when the publish predates the window or postdates it — that is what
// drops the marker clause from the caption (copy #13b) and the rule from the
// markup; a rule pinned to an edge would claim a date the chart cannot show.
export function markerPercent(ts: number | null, firstStart: number, lastEnd: number): number | null {
  if (ts === null || lastEnd <= firstStart) return null
  if (ts < firstStart || ts > lastEnd) return null
  return ((ts - firstStart) / (lastEnd - firstStart)) * 100
}

// Local getters on purpose: the buckets were parsed at local midnight, because
// `new Date('2026-07-27')` is UTC and would label every week a day early
// anywhere west of Greenwich.
export function weekLabel(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// What the rule means, on the rule itself. Naming it in a legend made the reader
// carry a key from the header down to a line and back.
export function publishedTip(ms: number | null): string | undefined {
  return ms === null ? undefined : `You last published this scene on ${weekLabel(ms)}`
}

// One sentence doing six jobs — chart title, what is measured, the range, the
// extreme, the legend for the dashed rule, and the plot's aria-label. It exists
// because every alternative (axis ticks, a legend chip, a tooltip) is a second
// thing to read that a screen reader gets a worse version of.
// The tallest week, or null when no week carries a number. Separate from the
// caption so the chart header can print it without re-deriving it.
export function busiestOf(buckets: ChartBucket[]): number | null {
  let busiest: number | null = null
  for (const b of buckets) if (b.value !== null && (busiest === null || b.value > busiest)) busiest = b.value
  return busiest
}

export function captionOf(buckets: ChartBucket[], marker: number | null): string {
  if (buckets.length === 0) return ''
  const range = `${weekLabel(buckets[0].start)} to ${weekLabel(buckets[buckets.length - 1].start)}`
  const busiest = busiestOf(buckets)
  // An all-null series still has a range worth stating; claiming a busiest week
  // when no week has a number would invent one.
  const head =
    busiest === null
      ? `Visitors per week, ${range}.`
      : `Visitors per week, ${range} — the busiest week was ${formatCount(Math.round(busiest))}.`
  return marker === null ? head : `${head} The dashed line is when you last published this scene.`
}
