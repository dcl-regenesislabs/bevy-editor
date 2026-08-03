import { describe, expect, it } from 'vitest'
import { ZONE_ASKS, listenerWhere, zoneListeners, zonePrompt } from './zone-listeners'
import type { Snapshot } from '../../../../scene/src/state'

const NAME = 'core-schema::Name'
const SCRIPT = 'asset-packs::Script'
const DETECTOR = 'custom/trigger_zone/scripts/trigger-zone.ts'

function layout(params: Record<string, { type: string; value: unknown; options?: string[] }>): string {
  return JSON.stringify({ params, actions: [] })
}

function scripted(name: string, entries: Array<[string, string]>): Record<string, unknown> {
  return {
    [NAME]: { value: name },
    [SCRIPT]: { value: entries.map(([path, l]) => ({ path, priority: 0, layout: l })) }
  }
}

// A placed zone: named, carrying its detector.
function scene(): Snapshot {
  return {
    '512': scripted('Front Hall', [
      [DETECTOR, layout({ who: { type: 'enum', value: 'this player', options: ['this player', 'any player'] } })]
    ])
  }
}

describe('zoneListeners', () => {
  it('finds a script elsewhere whose string param names the zone', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: 'Front Hall' } })]])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall', DETECTOR)).toEqual([
      { entityId: '513', entity: 'Door', script: 'HallDoor', here: false }
    ])
  })

  it('matches trimmed and case-folded, the way zoneBus does', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: '  FRONT hall ' } })]])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall', DETECTOR)).toHaveLength(1)
  })

  // The point of hosting a reaction on the zone: it needs no zone name at all,
  // because zoneOf() resolves it at runtime. Being attached here IS the link.
  it('counts a reaction on the zone itself even with a blank zone param', () => {
    const snapshot: Snapshot = {
      '512': scripted('Front Hall', [
        [DETECTOR, layout({ who: { type: 'enum', value: 'this player', options: [] } })],
        ['src/scripts/on-player-enters.ts', layout({ zone: { type: 'string', value: '' } })]
      ])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall', DETECTOR)).toEqual([
      { entityId: '512', entity: 'Front Hall', script: 'on-player-enters', here: true }
    ])
  })

  it('never counts the detector as a reaction to its own zone', () => {
    expect(zoneListeners(scene(), '512', 'Front Hall', DETECTOR)).toEqual([])
  })

  it('ignores non-string params elsewhere that happen to hold the name', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [
        ['src/scripts/HallDoor.ts', layout({ mode: { type: 'enum', value: 'Front Hall', options: ['Front Hall'] } })]
      ])
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall', DETECTOR)).toEqual([])
  })

  it('ignores a different zone, a missing layout and unparseable JSON', () => {
    const snapshot: Snapshot = {
      ...scene(),
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: 'Back Room' } })]]),
      '514': { [NAME]: { value: 'Lamp' }, [SCRIPT]: { value: [{ path: 'src/scripts/Lamp.ts', priority: 0 }] } },
      '515': { [NAME]: { value: 'Sign' }, [SCRIPT]: { value: [{ path: 'src/scripts/Sign.ts', priority: 0, layout: '{oops' }] } },
      '516': { [NAME]: { value: 'Bare' } }
    }
    expect(zoneListeners(snapshot, '512', 'Front Hall', DETECTOR)).toEqual([])
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
    expect(zoneListeners(snapshot, '512', 'Front Hall', DETECTOR).map((l) => `${l.script}/${l.entity}`)).toEqual([
      'HallDoor/Door',
      'Chime/Door',
      'Light/#514'
    ])
  })

  it('returns nothing for a blank zone name', () => {
    const snapshot: Snapshot = {
      '513': scripted('Door', [['src/scripts/HallDoor.ts', layout({ zone: { type: 'string', value: '' } })]])
    }
    expect(zoneListeners(snapshot, '512', '   ', DETECTOR)).toEqual([])
  })
})

describe('listenerWhere', () => {
  it('says here for a reaction on the zone and names the host otherwise', () => {
    expect(listenerWhere({ entityId: '512', entity: 'Front Hall', script: 'X', here: true })).toBe('here')
    expect(listenerWhere({ entityId: '513', entity: 'Door', script: 'X', here: false })).toBe('on Door')
  })
})

describe('zone asks', () => {
  // The chip is read inside the zone's own inspector, so the label stays a bare
  // verb; the zone name only appears in the sentence that reaches the composer.
  it('keeps the chip labels short and free of the zone name', () => {
    for (const ask of ZONE_ASKS) {
      expect(ask.label).not.toContain('"')
      expect(ask.label.length).toBeLessThanOrEqual(20)
    }
  })

  it('binds the zone by name in the sentence it sends', () => {
    expect(zonePrompt(ZONE_ASKS[0], ' Front Hall ')).toBe('Play a sound when a player enters "Front Hall"')
  })

  // A zone that only ever advertises entering teaches creators it can't do the rest.
  it('offers leaving and while-inside, not just entering', () => {
    const sentences = ZONE_ASKS.map((a) => a.sentence).join(' ')
    expect(sentences).toMatch(/leaves|leave/)
    expect(sentences).toMatch(/while/)
  })
})
