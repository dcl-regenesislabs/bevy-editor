// Timeline model for the drill-down charts: a fixed 60-slot ribbon at the 10s
// poll cadence, newest at the right edge, keyed by REAL timestamps (the
// snapshot's receivedAt when parseable, else the poll time). A slot nobody
// filled stays null — a scene that was down, a page opened mid-flight, a
// missed poll — which is a hole in the chart, not a zero. Slots are seeded
// from the server's ?history=1 snapshots and merged with live polls by
// timestamp, so duplicates collapse instead of stacking.
import { barPercent } from '../worlds/chart-geometry'
import type { MetricKey, SceneMetrics, SceneSnapshot } from './ops-data'
import { snapshotMetrics } from './ops-data'

export const SLOT_MS = 10_000
export const TIMELINE_SLOTS = 60

export interface TimelinePoint {
  timestamp: number
  metrics: SceneMetrics
}

export type SceneTimeline = Map<number, TimelinePoint> // slot index → sample
export type SceneHistory = Map<string, SceneTimeline>

export function slotOf(timestamp: number): number {
  return Math.round(timestamp / SLOT_MS)
}

export function pointOf(snap: SceneSnapshot, participants: number | null, fallbackTime: number): TimelinePoint {
  const parsed = Date.parse(snap.receivedAt)
  return {
    timestamp: Number.isFinite(parsed) ? parsed : fallbackTime,
    metrics: snapshotMetrics(snap, participants)
  }
}

// Live polls overwrite their slot (they carry participants, which server
// history snapshots do not); a seed never clobbers a slot already filled, so
// re-seeding every poll is idempotent. Slots older than the newest 60 are
// dropped to keep the ring bounded.
export function recordPoint(history: SceneHistory, sceneId: string, point: TimelinePoint, mode: 'live' | 'seed'): void {
  const timeline = history.get(sceneId) ?? new Map<number, TimelinePoint>()
  const slot = slotOf(point.timestamp)
  if (mode === 'live' || !timeline.has(slot)) timeline.set(slot, point)
  let newest = -Infinity
  for (const s of timeline.keys()) if (s > newest) newest = s
  for (const s of timeline.keys()) if (s < newest - (TIMELINE_SLOTS - 1)) timeline.delete(s)
  history.set(sceneId, timeline)
}

export interface TimelineView {
  points: Array<TimelinePoint | null> // oldest first, newest at the right edge
  times: number[] // each slot's epoch ms, for the axis and tooltips
}

export function timelineView(timeline: SceneTimeline | undefined, now: number): TimelineView {
  // Slots are keyed by SERVER receivedAt; a server clock ahead of this machine
  // would put the newest samples past slotOf(now) and off the right edge, so
  // the window's end is whichever is newer.
  let end = slotOf(now)
  if (timeline) for (const s of timeline.keys()) if (s > end) end = s
  const points: Array<TimelinePoint | null> = []
  const times: number[] = []
  for (let slot = end - (TIMELINE_SLOTS - 1); slot <= end; slot++) {
    times.push(slot * SLOT_MS)
    points.push(timeline?.get(slot) ?? null)
  }
  return { points, times }
}

export function seriesOf(points: Array<TimelinePoint | null>, key: MetricKey): Array<number | null> {
  return points.map((point) => (point === null ? null : point.metrics[key]))
}

// null = hole, draw nothing. '1px' = a TRUE zero's baseline tick — visibly
// present, visibly not a bar. Real values get a 5% floor (~3px on the 64px
// plot) so tiny rates stay clearly taller than the zero tick.
export function barHeight(value: number | null, max: number): string | null {
  if (value === null) return null
  if (value === 0 || max <= 0) return '1px'
  return `${Math.max(barPercent(value, max) ?? 0, 5)}%`
}

export function timeLabel(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function barTip(ms: number, value: number | null, format: (v: number) => string): string {
  return `${timeLabel(ms)} — ${value === null ? 'no data' : format(value)}`
}
