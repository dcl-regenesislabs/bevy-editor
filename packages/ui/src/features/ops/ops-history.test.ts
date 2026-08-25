import { describe, expect, it } from 'vitest'
import type { SceneSnapshot } from './ops-data'
import {
  SLOT_MS,
  TIMELINE_SLOTS,
  SceneHistory,
  barHeight,
  barTip,
  pointOf,
  recordPoint,
  seriesOf,
  slotOf,
  timeLabel,
  timelineView
} from './ops-history'

// slot-aligned so Math.round jitter never moves a sample across a boundary
const T0 = Date.parse('2026-01-01T12:00:00.000Z')

function snap(offsetMs: number, runMs = 100, windowSeconds?: number): SceneSnapshot {
  return { receivedAt: new Date(T0 + offsetMs).toISOString(), windowSeconds, stats: { cpu: { run_ms: runMs } } }
}

describe('pointOf', () => {
  it('keys by the snapshot receivedAt and rate-normalizes by its window', () => {
    const point = pointOf(snap(0, 50, 5), null, T0 + 999_999)
    expect(point.timestamp).toBe(T0)
    expect(point.metrics.cpuMsPerSec).toBe(10)
    expect(point.metrics.participants).toBeNull()
  })

  it('defaults the window to 10s and falls back to the poll time on a bad date', () => {
    const point = pointOf({ receivedAt: 'garbage', stats: { cpu: { run_ms: 100 } } }, 3, T0)
    expect(point.timestamp).toBe(T0)
    expect(point.metrics.cpuMsPerSec).toBe(10)
    expect(point.metrics.participants).toBe(3)
  })
})

describe('recordPoint', () => {
  it('merges by slot: a seed never clobbers a filled slot, a live sample does', () => {
    const history: SceneHistory = new Map()
    recordPoint(history, 'a', pointOf(snap(0, 100), null, T0), 'seed')
    recordPoint(history, 'a', pointOf(snap(0, 999), null, T0), 'seed')
    const slot = slotOf(T0)
    expect(history.get('a')!.get(slot)!.metrics.cpuMsPerSec).toBe(10)
    recordPoint(history, 'a', pointOf(snap(0, 100), 2, T0), 'live')
    expect(history.get('a')!.get(slot)!.metrics.participants).toBe(2)
    expect(history.get('a')!.size).toBe(1)
  })

  it('drops slots older than the newest 60', () => {
    const history: SceneHistory = new Map()
    for (let i = 0; i < TIMELINE_SLOTS + 10; i++) {
      recordPoint(history, 'a', pointOf(snap(i * SLOT_MS), null, T0), 'live')
    }
    const timeline = history.get('a')!
    expect(timeline.size).toBe(TIMELINE_SLOTS)
    expect(timeline.has(slotOf(T0 + 9 * SLOT_MS))).toBe(false)
    expect(timeline.has(slotOf(T0 + 10 * SLOT_MS))).toBe(true)
  })
})

describe('timelineView', () => {
  it('projects 60 slots ending at now, oldest first, holes as null', () => {
    const history: SceneHistory = new Map()
    recordPoint(history, 'a', pointOf(snap(0), null, T0), 'live')
    recordPoint(history, 'a', pointOf(snap(2 * SLOT_MS), null, T0), 'live')
    const view = timelineView(history.get('a'), T0 + 2 * SLOT_MS)
    expect(view.points).toHaveLength(TIMELINE_SLOTS)
    expect(view.times).toHaveLength(TIMELINE_SLOTS)
    expect(view.times[TIMELINE_SLOTS - 1]).toBe(slotOf(T0 + 2 * SLOT_MS) * SLOT_MS)
    expect(view.points[TIMELINE_SLOTS - 1]?.timestamp).toBe(T0 + 2 * SLOT_MS)
    expect(view.points[TIMELINE_SLOTS - 2]).toBeNull() // missed poll = hole
    expect(view.points[TIMELINE_SLOTS - 3]?.timestamp).toBe(T0)
    expect(view.points[0]).toBeNull()
  })

  it('is all holes when the scene has no timeline yet', () => {
    const view = timelineView(undefined, T0)
    expect(view.points.every((p) => p === null)).toBe(true)
  })

  it('extends the right edge to a sample from a server clock ahead of ours', () => {
    const history: SceneHistory = new Map()
    recordPoint(history, 'a', pointOf(snap(2 * SLOT_MS), null, T0), 'live') // server 20s ahead
    const view = timelineView(history.get('a'), T0)
    expect(view.points[TIMELINE_SLOTS - 1]?.timestamp).toBe(T0 + 2 * SLOT_MS)
  })
})

describe('seriesOf', () => {
  it('maps holes to null and picks the metric', () => {
    const point = pointOf(snap(0, 50), null, T0)
    expect(seriesOf([null, point], 'cpuMsPerSec')).toEqual([null, 5])
    expect(seriesOf([point], 'participants')).toEqual([null]) // seeded: unknown, not zero
  })
})

describe('barHeight', () => {
  it('distinguishes hole, true zero and value', () => {
    expect(barHeight(null, 100)).toBeNull()
    expect(barHeight(0, 100)).toBe('1px')
    expect(barHeight(50, 100)).toBe('50%')
    expect(barHeight(0.1, 100)).toBe('5%') // floor keeps tiny rates visibly taller than the zero tick
  })
})

describe('time labels', () => {
  it('formats HH:MM:SS zero-padded, local time', () => {
    const ms = new Date(2026, 0, 1, 9, 5, 3).getTime()
    expect(timeLabel(ms)).toBe('09:05:03')
    expect(barTip(ms, 42, String)).toBe('09:05:03 — 42')
    expect(barTip(ms, null, String)).toBe('09:05:03 — no data')
  })
})
