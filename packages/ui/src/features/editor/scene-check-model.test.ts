import { describe, it, expect } from 'vitest'
import { folderScriptRows, sceneScriptRows, spawnerCalls } from './scene-check-model'
import { scriptComponent, scriptRow, zombiePrefab } from './scene-check-fixtures'
import type { PrefabSnapshot } from '../../prefabs/format'

describe('script rows', () => {
  it('reads a scene entity’s params', () => {
    const snapshot: PrefabSnapshot = {
      '512': { 'asset-packs::Script': { value: [scriptRow('src/scripts/x.ts', { speed: { type: 'number', value: 2 } })] } }
    }
    expect(sceneScriptRows(snapshot)).toEqual([
      { entityId: '512', path: 'src/scripts/x.ts', priority: 0, params: [{ name: 'speed', type: 'number', value: 2 }] }
    ])
  })

  it('survives a layout that is not JSON', () => {
    const snapshot: PrefabSnapshot = {
      '512': { 'asset-packs::Script': { value: [{ path: 'src/scripts/x.ts', priority: 0, layout: 'nonsense' }] } }
    }
    expect(sceneScriptRows(snapshot)[0].params).toEqual([])
  })

  it('resolves {assetPath} the way placement does', () => {
    expect(folderScriptRows(zombiePrefab)[0].path).toBe('custom/zombie_basic/scripts/zombie-brain.ts')
  })

  it('ignores an entity with no script component', () => {
    expect(sceneScriptRows({ '512': { Transform: {} } })).toEqual([])
    expect(scriptComponent('0', []).data['0']).toEqual({ json: { value: [] } })
  })
})

describe('spawnerCalls', () => {
  it('follows the alias a named import bound', () => {
    const text = [
      "import { pool as openPool, poolFor as existingPool } from './runtime/spawner'",
      "const p = openPool(this.arena, 'server')"
    ].join('\n')
    expect(spawnerCalls(text)).toEqual([{ fn: 'pool', arg: 'this.arena', mode: 'server' }])
  })

  it('reads a namespace import', () => {
    const text = ["import * as spawner from './runtime/spawner'", 'spawner.perPlayer(this.rig)'].join('\n')
    expect(spawnerCalls(text)).toEqual([{ fn: 'perPlayer', arg: 'this.rig', mode: null }])
  })

  it('reads a planned pool with a callback second argument', () => {
    const text = [
      "import { plan as openPlannedPool } from './runtime/spawner'",
      'this.pool = openPlannedPool(this.zombie, (tuple) => build(tuple), { outcomes: [] })'
    ].join('\n')
    expect(spawnerCalls(text)).toEqual([{ fn: 'plan', arg: 'this.zombie', mode: null }])
  })

  it('ignores same-named functions from another module', () => {
    expect(spawnerCalls("import { pool } from './pure/water'\npool(this.x, 'server')")).toEqual([])
  })
})
