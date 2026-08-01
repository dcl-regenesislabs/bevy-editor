import { describe, expect, it } from 'vitest'
import { getScriptParams, type ScriptLayout } from '../script/parser'
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
