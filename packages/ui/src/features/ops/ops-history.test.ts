import { describe, expect, it } from 'vitest'
import type { SceneRow } from './ops-data'
import { HISTORY_CAP, pushHistory, seriesOf, SceneHistory } from './ops-history'

function row(sceneId: string, cpu: number, active = true): SceneRow {
  return {
    sceneId,
    name: sceneId,
    active,
    participants: 0,
    cpuMsPerSec: cpu,
    ticksPerSec: 0,
    crdtBytesPerSec: 0,
    commsMsgsPerSec: 0,
    fetchPerSec: 0,
    fetchFailed: 0,
    storagePerSec: 0,
    storageUnauthorized: 0,
    logLinesPerSec: 0,
    heapUsedBytes: 0
  }
}

describe('pushHistory', () => {
  it('accumulates per scene and caps the ring', () => {
    const history: SceneHistory = new Map()
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      pushHistory(history, [row('a', i), row('b', i * 2)])
    }
    expect(history.get('a')).toHaveLength(HISTORY_CAP)
    expect(history.get('b')).toHaveLength(HISTORY_CAP)
    expect(history.get('a')![HISTORY_CAP - 1].cpuMsPerSec).toBe(HISTORY_CAP + 9)
    expect(history.get('a')![0].cpuMsPerSec).toBe(10)
  })
})

describe('seriesOf', () => {
  it('nulls out samples where the scene was inactive', () => {
    expect(seriesOf([row('a', 5), row('a', 7, false)], (r) => r.cpuMsPerSec)).toEqual([5, null])
  })
})
