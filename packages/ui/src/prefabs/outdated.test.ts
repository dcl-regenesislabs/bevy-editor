import { describe, expect, it } from 'vitest'
import { computeOutdated } from './outdated'
import type { PrefabData } from './format'

function master(id: string, version: string, changelog: PrefabData['changelog']): PrefabData {
  return {
    id,
    name: id,
    category: 'custom',
    tags: [],
    version,
    changelog,
    origin: { source: 'builtin' }
  }
}

function copy(folder: string, id: string, version?: string): { folder: string; data: PrefabData } {
  return {
    folder,
    data: {
      id,
      name: id,
      category: 'custom',
      tags: [],
      ...(version === undefined ? {} : { version }),
      origin: { source: 'builtin' }
    }
  }
}

describe('computeOutdated', () => {
  const clockMaster = master('clock', '0.4.0', [
    { version: '0.4.0', notes: 'Dropdown params' },
    { version: '0.3.0', notes: 'Sync fixes' },
    { version: '0.2.0', notes: '2D UI option' },
    { version: '0.1.0', notes: 'Initial' }
  ])

  it('flags a copy older than its master, with only the newer changelog entries', () => {
    const outdated = computeOutdated([copy('custom/server_clock', 'clock', '0.2.0')], [clockMaster])
    expect(outdated.get('clock')).toEqual({
      slug: 'custom/server_clock',
      copyVersion: '0.2.0',
      masterVersion: '0.4.0',
      notes: [
        { version: '0.4.0', notes: 'Dropdown params' },
        { version: '0.3.0', notes: 'Sync fixes' }
      ]
    })
  })

  it('treats an unversioned copy as 0.0.0 — the whole changelog applies', () => {
    const outdated = computeOutdated([copy('custom/server_clock', 'clock')], [clockMaster])
    expect(outdated.get('clock')?.copyVersion).toBe('0.0.0')
    expect(outdated.get('clock')?.notes.map((n) => n.version)).toEqual([
      '0.4.0',
      '0.3.0',
      '0.2.0',
      '0.1.0'
    ])
  })

  it('leaves up-to-date, newer and unrelated copies alone', () => {
    const outdated = computeOutdated(
      [
        copy('custom/a', 'clock', '0.4.0'),
        copy('custom/b', 'clock2', '9.9.9'),
        copy('custom/c', 'made-here', '0.0.1')
      ],
      [clockMaster, master('clock2', '1.0.0', [{ version: '1.0.0', notes: 'Initial release' }])]
    )
    expect(outdated.size).toBe(0)
  })

  it('sorts notes newest first even when the master changelog is oldest-first', () => {
    const shuffled = master('clock', '0.4.0', [
      { version: '0.1.0', notes: 'Initial' },
      { version: '0.3.0', notes: 'Sync fixes' },
      { version: '0.4.0', notes: 'Dropdown params' }
    ])
    const outdated = computeOutdated([copy('custom/x', 'clock', '0.1.0')], [shuffled])
    expect(outdated.get('clock')?.notes.map((n) => n.version)).toEqual(['0.4.0', '0.3.0'])
  })
})
