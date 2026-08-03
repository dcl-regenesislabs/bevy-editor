import { describe, expect, it } from 'vitest'
import { listenerLine, zoneListeners, zonePrompts } from './zone-listeners'
import type { Snapshot } from '../../../../scene/src/state'

const NAME = 'core-schema::Name'
const SCRIPT = 'asset-packs::Script'

function layout(params: Record<string, { type: string; value: unknown; options?: string[] }>): string {
  return JSON.stringify({ params, actions: [] })
}

function scripted(name: string, entries: Array<[string, string]>): Record<string, unknown> {
  return {
    [NAME]: { value: name },
    [SCRIPT]: { value: entries.map(([path, l]) => ({ path, priority: 0, layout: l })) }
  }
}

function scene(): Snapshot {
  return {
    '512': scripted('Front Hall', [['custom/trigger_zone/scripts/trigger-zone.ts', layout({ who: { type: 'enum', value: 'this player', options: ['this player', 'any player'] } })]])
  }
}

describe('zoneListeners', () => {
  it('finds a script whose string param names the zone', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: 'Front Hall' } })]])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall')).toEqual([
      { entityId: '513', entity: 'Door', script: 'HallDoor' }
    ])
  })

  it('matches trimmed and case-folded, the way zoneBus does', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: '  FRONT hall ' } })]])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall')).toHaveLength(1)
  })

  it('ignores the zone entity itself, so its detector is not a listener', () => {
    const snapshot: Snapshot = {
      '512': scripted('Front Hall', [['custom/trigger_zone/scripts/trigger-zone.ts', layout({ zone: { type: 'string', value: 'Front Hall' } })]])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall')).toEqual([])
  })

  it('ignores non-string params that happen to hold the name', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [
        ['src/scripts/HallDoor.ts', layout({ mode: { type: 'enum', value: 'Front Hall', options: ['Front Hall'] } })]
      ])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall')).toEqual([])
  })

  it('ignores a different zone, a missing layout and unparseable JSON', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: 'Back Room' } })]]),
      '514': { [NAME]: { value: 'Lamp' }, [SCRIPT]: { value: [{ path: 'src/scripts/Lamp.ts', priority: 0 }] } },
      '515': { [NAME]: { value: 'Sign' }, [SCRIPT]: { value: [{ path: 'src/scripts/Sign.ts', priority: 0, layout: '{oops' }] } },
      '516': { [NAME]: { value: 'Bare' } }
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall')).toEqual([])
  })

  it('reports one row per listening script, and falls back to the id for an unnamed entity', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [
        ['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: 'Front Hall' } })],
        ['src/scripts/Chime.ts', layout({ zone: { type: 'string', value: 'front hall' } })]
      ]),
      '514': { [SCRIPT]: { value: [{ path: 'src/scripts/Light.ts', priority: 0, layout: layout({ zone: { type: 'string', value: 'Front Hall' } }) }] } }
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall').map((l) => `${l.script}/${l.entity}`)).toEqual([
      'HallDoor/Door',
      'Chime/Door',
      'Light/#514'
    ])
  })

  it('returns nothing for a blank zone name', () => {
    const snapshot: Snapshot = {
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: '' } })]])
    }
    expect(zoneListeners(snapshot, '512', '   ')).toEqual([])
  })
})

describe('listenerLine', () => {
  const row = (script: string, entity: string): { entityId: string; entity: string; script: string } => ({
    entityId: '0',
    entity,
    script
  })

  it('is empty when nothing listens', () => {
    expect(listenerLine([])).toBe('')
  })

  it('agrees with itself in the singular', () => {
    expect(listenerLine([row('HallDoor', 'Door')])).toBe('1 script listens — HallDoor (Door)')
  })

  it('names up to two and counts the rest', () => {
    expect(listenerLine([row('A', 'One'), row('B', 'Two')])).toBe('2 scripts listen — A (One), B (Two)')
    expect(listenerLine([row('A', 'One'), row('B', 'Two'), row('C', 'Three')])).toBe(
      '3 scripts listen — A (One), B (Two) +1 more'
    )
  })
})

describe('zonePrompts', () => {
  it('names the zone in every prompt', () => {
    for (const prompt of zonePrompts(' Front Hall ')) expect(prompt).toContain('"Front Hall"')
  })
})
