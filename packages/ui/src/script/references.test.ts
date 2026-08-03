import { describe, expect, it } from 'vitest'
import { referencedNames } from './references'
import type { Snapshot } from '../../../scene/src/state'

const NAME = 'core-schema::Name'
const SCRIPT = 'asset-packs::Script'

function layout(params: Record<string, { type: string; value: unknown }>): string {
  return JSON.stringify({ params, actions: [] })
}

describe('referencedNames', () => {
  // The reported bug: delete every zone, place a new one, and it arrives already
  // wired to a reaction the creator never put on it — because the freed name got
  // handed back out while a script still held the string.
  it('reports a name a script still points at after the entity is gone', () => {
    const snapshot: Snapshot = {
      '513': {
        [NAME]: { value: 'Button Panel' },
        [SCRIPT]: {
          value: [
            {
              path: 'src/scripts/EmoteOnZoneEnter.ts',
              priority: 0,
              layout: layout({ zone: { type: 'string', value: 'Trigger Zone' } })
            }
          ]
        }
      }
    }
    expect(referencedNames(snapshot).has('Trigger Zone')).toBe(true)
  })

  it('trims, and ignores blanks and non-string params', () => {
    const snapshot: Snapshot = {
      '513': {
        [SCRIPT]: {
          value: [
            {
              path: 'src/scripts/A.ts',
              priority: 0,
              layout: layout({
                zone: { type: 'string', value: '  Front Hall  ' },
                blank: { type: 'string', value: '   ' },
                count: { type: 'number', value: 3 },
                mode: { type: 'enum', value: 'Back Room' }
              })
            }
          ]
        }
      }
    }
    const names = referencedNames(snapshot)
    expect(names.has('Front Hall')).toBe(true)
    expect(names.has('Back Room')).toBe(false)
    expect([...names]).toHaveLength(1)
  })

  it('survives a missing layout, unparseable JSON and a bare entity', () => {
    const snapshot: Snapshot = {
      '513': { [SCRIPT]: { value: [{ path: 'src/scripts/A.ts', priority: 0 }] } },
      '514': { [SCRIPT]: { value: [{ path: 'src/scripts/B.ts', priority: 0, layout: '{oops' }] } },
      '515': { [NAME]: { value: 'Bare' } }
    }
    expect(referencedNames(snapshot).size).toBe(0)
  })
})
