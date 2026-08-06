import { describe, it, expect } from 'vitest'
import {
  aliasFor,
  compileSnapshot,
  hasSpawnOverrides,
  readSpawnable,
  snapshotScriptPaths,
  withSpawnable,
  EMPTY_LAYOUT
} from './spawnable'
import type { PrefabComposite, PrefabData } from './format'

const data: PrefabData = {
  id: 'zombie-uuid',
  name: 'Zombie Basic',
  category: 'custom',
  tags: [],
  spawnable: { max: 64 }
}

const LAYOUT = '{"params":{"speed":{"type":"number","value":2.5}},"actions":[]}'

const composite = (): PrefabComposite => ({
  version: 1,
  components: [
    {
      name: 'core::Transform',
      data: {
        '512': { json: { position: { x: 0, y: 0, z: 0 }, parent: 0 } },
        '513': { json: { position: { x: 0, y: 1, z: 0 }, parent: 512 } }
      }
    },
    { name: 'core-schema::Name', data: { '512': { json: { value: 'Zombie' } } } },
    {
      name: 'core::GltfContainer',
      data: { '512': { json: { src: '{assetPath}/models/zombie.glb' } } }
    },
    {
      name: 'asset-packs::Script',
      data: {
        '512': {
          json: {
            value: [
              { path: '{assetPath}/scripts/zombie-brain.ts', priority: 0, layout: LAYOUT }
            ]
          }
        }
      }
    }
  ]
})

const compile = (
  overrides: Partial<{ data: PrefabData; composite: PrefabComposite; scripts: Record<string, string> }> = {}
) =>
  compileSnapshot({
    folder: 'custom/zombie_basic',
    data: overrides.data ?? data,
    composite: overrides.composite ?? composite(),
    ...(overrides.scripts === undefined ? {} : { scripts: overrides.scripts })
  })

describe('the spawnable field', () => {
  it('reads what the prefab declares', () => {
    expect(readSpawnable(data)).toEqual({ max: 64 })
    expect(hasSpawnOverrides(data)).toBe(true)
    expect(readSpawnable({ ...data, spawnable: undefined })).toBeNull()
  })

  it('adds and removes without touching the caller copy', () => {
    const off = withSpawnable(data, null)
    expect('spawnable' in off).toBe(false)
    expect(data.spawnable).toEqual({ max: 64 })

    const on = withSpawnable(off, { max: 8, instancing: 'perPlayer' })
    expect(on.spawnable).toEqual({ max: 8, instancing: 'perPlayer' })
    expect('spawnable' in off).toBe(false)
  })
})

describe('aliases', () => {
  it('PascalCases the prefab name', () => {
    expect(aliasFor('Zombie Basic')).toBe('ZombieBasic')
    expect(aliasFor('arena-graveyard')).toBe('ArenaGraveyard')
    expect(aliasFor('wave director v2')).toBe('WaveDirectorV2')
  })

  it('always produces something writable as an identifier', () => {
    expect(aliasFor('2Fast')).toBe('Prefab2Fast')
    expect(aliasFor('***')).toBe('Prefab')
  })

  it('dedupes against the aliases already taken', () => {
    expect(aliasFor('Zombie', ['ZombieBasic'])).toBe('Zombie')
    expect(aliasFor('Zombie', ['Zombie'])).toBe('Zombie2')
    expect(aliasFor('Zombie', ['Zombie', 'Zombie2'])).toBe('Zombie3')
  })
})

describe('compileSnapshot', () => {
  it('compiles with the default cap when no settings were ever touched', () => {
    const snapshot = compile({ data: { ...data, spawnable: undefined } })
    expect(snapshot?.max).toBe(64)
  })

  it('carries identity, cap and the entity tree', () => {
    const snapshot = compile()
    expect(snapshot?.prefab).toBe('zombie-uuid')
    expect(snapshot?.alias).toBe('ZombieBasic')
    expect(snapshot?.max).toBe(64)
    expect(snapshot?.entities.map((e) => [e.localId, e.parent])).toEqual([
      [512, null],
      [513, 512]
    ])
  })

  // The registry opens the per-player pool, so the snapshot has to carry what
  // data.json declares — a prefab that says nothing is spawned on demand.
  it('carries the declared instancing, defaulting to on demand', () => {
    expect(compile()?.instancing).toBe('onDemand')
    expect(compile({ data: { ...data, spawnable: { max: 32, instancing: 'perPlayer' } } })?.instancing).toBe(
      'perPlayer'
    )
  })

  // A clone carrying the authored Name re-binds every name-keyed lookup in the
  // scene to itself — trigger zones match names, and instantiation dedupes them
  // precisely because of this. A runtime clone has no such pass.
  it('strips core-schema::Name from every entity', () => {
    const snapshot = compile()
    const names = snapshot?.entities.flatMap((e) => e.components.map((c) => c.name)) ?? []
    expect(names).not.toContain('core-schema::Name')
    expect(names).toEqual(['core::Transform', 'core::GltfContainer', 'core::Transform'])
  })

  it('lifts Script rows out of the components into scripts', () => {
    const snapshot = compile()
    expect(snapshot?.scripts).toEqual([
      {
        localId: 512,
        path: 'custom/zombie_basic/scripts/zombie-brain.ts',
        priority: 0,
        layout: LAYOUT
      }
    ])
    expect(snapshotScriptPaths(snapshot!)).toEqual(['custom/zombie_basic/scripts/zombie-brain.ts'])
  })

  it('resolves {assetPath} to the prefab folder', () => {
    const gltf = compile()?.entities[0].components.find((c) => c.name === 'core::GltfContainer')
    expect(gltf?.json).toEqual({ src: 'custom/zombie_basic/models/zombie.glb' })
  })

  // Placed instances get an empty layout filled at instantiation by re-parsing the
  // file. Clones have no such moment, so a missed fill means every clone is
  // constructed with zero arguments while the placed copy gets all of them.
  it('fills an empty layout from the script source, like instantiation does', () => {
    const bare = composite()
    bare.components[3].data['512'] = {
      json: { value: [{ path: '{assetPath}/scripts/zombie-brain.ts', priority: 0 }] }
    }
    const source = [
      "import { type Entity } from '@dcl/sdk/ecs'",
      'export class ZombieBrain {',
      '  constructor(public src: string, public entity: Entity, public speed: number = 2.5) {}',
      '}'
    ].join('\n')
    const snapshot = compile({
      composite: bare,
      scripts: { 'custom/zombie_basic/scripts/zombie-brain.ts': source }
    })
    expect(JSON.parse(snapshot?.scripts[0].layout ?? '{}').params.speed).toEqual({
      type: 'number',
      optional: true,
      value: 2.5
    })
  })

  it('falls back to an empty layout when the source is unavailable', () => {
    const bare = composite()
    bare.components[3].data['512'] = {
      json: { value: [{ path: '{assetPath}/scripts/zombie-brain.ts', priority: 0 }] }
    }
    expect(compile({ composite: bare })?.scripts[0].layout).toBe(EMPTY_LAYOUT)
  })

  it('never mutates the composite it was handed', () => {
    const input = composite()
    const before = JSON.stringify(input)
    compile({ composite: input })
    expect(JSON.stringify(input)).toBe(before)
  })
})
