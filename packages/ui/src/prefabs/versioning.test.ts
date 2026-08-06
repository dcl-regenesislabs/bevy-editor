import { describe, expect, it } from 'vitest'
import { getScriptParams, type ScriptLayout } from '../script/parser'
import { readPrefabFile } from './builtin-fixtures'
import {
  diffAgainstManifest,
  mergedLayoutJson,
  parseOriginHashes,
  scriptFilesOf
} from './versioning'

describe('parseOriginHashes', () => {
  it('keeps only string hashes', () => {
    expect(parseOriginHashes('{"a.ts":"aa","b.ts":7,"c.ts":"cc"}')).toEqual({
      'a.ts': 'aa',
      'c.ts': 'cc'
    })
  })

  it('returns null for junk', () => {
    expect(parseOriginHashes('not json')).toBeNull()
    expect(parseOriginHashes('[]')).toBeNull()
  })
})

describe('diffAgainstManifest', () => {
  const manifest = { 'scripts/a.ts': 'aa', 'scripts/b.ts': 'bb', 'thumbnail.png': 'tt' }

  it('reports edited and locally deleted files, sorted', () => {
    const current = { 'scripts/b.ts': 'CHANGED', 'thumbnail.png': 'tt' }
    expect(diffAgainstManifest(manifest, current)).toEqual(['scripts/a.ts', 'scripts/b.ts'])
  })

  it('ignores locally added files and reports nothing when pristine', () => {
    const current = { ...manifest, 'notes.txt': 'nn' }
    expect(diffAgainstManifest(manifest, current)).toEqual([])
  })
})

describe('scriptFilesOf', () => {
  it('keeps only script extensions', () => {
    expect(
      scriptFilesOf(['scripts/a.ts', 'scripts/ui.tsx', 'models/door.glb', 'data.json', 'x.mjs'])
    ).toEqual(['scripts/a.ts', 'scripts/ui.tsx', 'x.mjs'])
  })
})

describe('mergedLayoutJson', () => {
  const script = `
    import { Entity } from '@dcl/sdk/ecs'
    export class Clock {
      constructor(
        src: string,
        entity: Entity,
        public label: string = 'SERVER TIME',
        public utc: boolean = true,
        public display: '3D text' | '2D UI' = '3D text'
      ) {}
    }
  `
  const fresh = getScriptParams(script)

  it('keeps edited values by name and adopts new params with their defaults', () => {
    const existing: ScriptLayout = {
      params: {
        label: { type: 'string', value: 'MY CLOCK', optional: true },
        gone: { type: 'number', value: 5 }
      }
    }
    const merged = JSON.parse(mergedLayoutJson(fresh, JSON.stringify(existing))) as ScriptLayout
    expect(merged.params.label.value).toBe('MY CLOCK')
    expect(merged.params.utc.value).toBe(true)
    expect(merged.params.display).toMatchObject({
      type: 'enum',
      value: '3D text',
      options: ['3D text', '2D UI']
    })
    expect(merged.params.gone).toBeUndefined()
  })

  it('drops the edited value when the param changed type', () => {
    const existing: ScriptLayout = { params: { utc: { type: 'string', value: 'yes' } } }
    const merged = JSON.parse(mergedLayoutJson(fresh, JSON.stringify(existing))) as ScriptLayout
    expect(merged.params.utc).toMatchObject({ type: 'boolean', value: true })
  })

  it('adopts the fresh layout wholesale when there is none to merge', () => {
    for (const empty of [undefined, '', '{broken']) {
      const merged = JSON.parse(mergedLayoutJson(fresh, empty)) as ScriptLayout
      expect(Object.keys(merged.params)).toEqual(['label', 'utc', 'display'])
      expect(merged.params.label.value).toBe('SERVER TIME')
    }
  })
})

// The Spawner's own 10→6 param cut, replayed against the SHIPPED script: a
// scene placed before the cut holds a layout with insideZone / clickable /
// scatterRadius / showMarker, then updates. The runner reads the merged layout
// POSITIONALLY (Object.values in insertion order), so this pins the merged key
// order to the constructor's, not just the surviving values.
describe('mergedLayoutJson upgrades a pre-cut spawner layout', () => {
  const WHEN_OPTIONS = [
    'when clicked',
    'when a player enters',
    'every few seconds',
    'when a script asks'
  ]
  const fresh = getScriptParams(readPrefabFile('spawner/scripts/spawner.ts'))
  const placedLastWeek: ScriptLayout = {
    params: {
      spawn: { type: 'prefab', value: 'a1b2-zombie', optional: true },
      when: { type: 'enum', value: 'when a player enters', options: WHEN_OPTIONS, optional: true },
      insideZone: { type: 'string', value: 'Front Door', optional: true },
      clickable: { type: 'entity', value: 512, optional: true },
      everySeconds: { type: 'number', value: 3, optional: true },
      hoverLabel: { type: 'string', value: 'Open crate', optional: true },
      atMostAtOnce: { type: 'number', value: 5, optional: true },
      disappearsAfter: { type: 'number', value: 30, optional: true },
      scatterRadius: { type: 'number', value: 2, optional: true },
      showMarker: { type: 'boolean', value: true, optional: true }
    },
    actions: []
  }
  const mergedJson = mergedLayoutJson(fresh, JSON.stringify(placedLastWeek))
  const merged = JSON.parse(mergedJson) as ScriptLayout

  it('the shipped script still declares exactly the six params, in constructor order', () => {
    expect(Object.keys(fresh.params)).toEqual([
      'spawn',
      'when',
      'everySeconds',
      'hoverLabel',
      'atMostAtOnce',
      'disappearsAfter'
    ])
    expect(fresh.error).toBeUndefined()
  })

  it('kept params keep their edited values, in the constructor order the runner needs', () => {
    expect(Object.keys(merged.params)).toEqual(Object.keys(fresh.params))
    expect(merged.params.spawn.value).toBe('a1b2-zombie')
    expect(merged.params.when.value).toBe('when a player enters')
    expect(merged.params.everySeconds.value).toBe(3)
    expect(merged.params.hoverLabel.value).toBe('Open crate')
    expect(merged.params.atMostAtOnce.value).toBe(5)
    expect(merged.params.disappearsAfter.value).toBe(30)
  })

  it('the four stored "when" values all survive the update', () => {
    expect(merged.params.when.options).toEqual(WHEN_OPTIONS)
    for (const stored of WHEN_OPTIONS) {
      const layout: ScriptLayout = {
        params: { when: { type: 'enum', value: stored, options: WHEN_OPTIONS } }
      }
      const out = JSON.parse(mergedLayoutJson(fresh, JSON.stringify(layout))) as ScriptLayout
      expect(out.params.when.value).toBe(stored)
    }
  })

  it('cut params vanish without a trace', () => {
    expect(merged.params.insideZone).toBeUndefined()
    expect(merged.params.clickable).toBeUndefined()
    expect(merged.params.scatterRadius).toBeUndefined()
    expect(merged.params.showMarker).toBeUndefined()
  })

  it('the update is idempotent', () => {
    expect(mergedLayoutJson(fresh, mergedJson)).toBe(mergedJson)
  })
})
