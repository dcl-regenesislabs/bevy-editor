import { describe, expect, it } from 'vitest'
import { SceneStatsEntry, formatBytes, formatRate, toRow, toRows } from './ops-data'

function entry(overrides: Partial<SceneStatsEntry>): SceneStatsEntry {
  return { sceneId: 'bafkreiscene', active: true, participants: 0, latest: null, ...overrides }
}

describe('toRow', () => {
  it('rate-normalizes deltas by the scene reporting window', () => {
    const row = toRow(
      entry({
        world: 'demo.dcl.eth',
        participants: 3,
        latest: {
          receivedAt: '2026-01-01T00:00:00.000Z',
          windowSeconds: 5,
          stats: { cpu: { run_ms: 50, ticks: 150 }, crdt: { bytes: 1000 }, mem: { heap_used: 42 } }
        }
      })
    )
    expect(row.name).toBe('demo.dcl.eth')
    expect(row.cpuMsPerSec).toBe(10)
    expect(row.ticksPerSec).toBe(30)
    expect(row.crdtBytesPerSec).toBe(200)
    expect(row.heapUsedBytes).toBe(42)
    expect(row.participants).toBe(3)
  })

  it('survives a scene with no snapshot yet', () => {
    const row = toRow(entry({ position: '10,20' }))
    expect(row.name).toBe('10,20')
    expect(row.cpuMsPerSec).toBe(0)
  })
})

describe('toRows', () => {
  it('sorts active-first, then hottest CPU first', () => {
    const rows = toRows({
      engine: null,
      scenes: [
        entry({ sceneId: 'dead', active: false }),
        entry({
          sceneId: 'cool',
          latest: { receivedAt: '', windowSeconds: 10, stats: { cpu: { run_ms: 10 } } }
        }),
        entry({
          sceneId: 'hot',
          latest: { receivedAt: '', windowSeconds: 10, stats: { cpu: { run_ms: 90 } } }
        })
      ]
    })
    expect(rows.map((r) => r.sceneId)).toEqual(['hot', 'cool', 'dead'])
  })
})

describe('formatting', () => {
  it('formats byte magnitudes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('formats rates by magnitude', () => {
    expect(formatRate(0)).toBe('0')
    expect(formatRate(0.123)).toBe('0.12')
    expect(formatRate(2.34)).toBe('2.3')
    expect(formatRate(123.4)).toBe('123')
  })
})

describe('duplicate world names', () => {
  it('appends the sceneId tail when a redeploy leaves two rows with one name', () => {
    const rows = toRows({
      engine: null,
      scenes: [
        entry({ sceneId: 'bafkreiNEWDEPLOY', world: 'cozy.dcl.eth' }),
        entry({ sceneId: 'bafkreiOLDDEPLOY', world: 'cozy.dcl.eth', active: false }),
        entry({ sceneId: 'bafkreiother', world: 'other.dcl.eth' })
      ]
    })
    expect(rows.map((r) => r.name)).toEqual(['cozy.dcl.eth · DEPLOY', 'cozy.dcl.eth · DEPLOY', 'other.dcl.eth'])
    expect(rows[0].sceneId).toBe('bafkreiNEWDEPLOY')
  })
})
