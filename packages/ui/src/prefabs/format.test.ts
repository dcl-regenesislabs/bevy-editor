import { describe, it, expect } from 'vitest'
import {
  ASSET_PATH_TOKEN,
  EXCLUDED_COMPONENTS,
  INERT_COMPONENT,
  commonBasePath,
  compareVersions,
  entityMarker,
  isExcludedComponent,
  isLocalResourcePath,
  parseComponentRef,
  parseEntityMarker,
  parsePrefabComposite,
  parsePrefabData,
  parseSpawnable,
  prefabLayout,
  relativeResourcePath,
  remapLayoutToEngine,
  remapLayoutToLocal,
  slugify,
  substituteAssetPath,
  uniquePrefabFolder,
  type PrefabComposite,
  type PrefabData
} from './format'

describe('slug / folder naming', () => {
  it('slugifies like the Hub (lowercase, non-alphanumerics collapsed, trimmed)', () => {
    expect(slugify('My Door 2!')).toBe('my_door_2')
    expect(slugify('  --Fancy--  ')).toBe('fancy')
  })

  it('dedupes taken folders with _2, _3, …', () => {
    expect(uniquePrefabFolder('Door', [])).toBe('custom/door')
    expect(uniquePrefabFolder('Door', ['custom/door'])).toBe('custom/door_2')
    expect(uniquePrefabFolder('Door', ['custom/door', 'custom/door_2'])).toBe('custom/door_3')
  })

  it('falls back to a usable slug when the name has no alphanumerics', () => {
    expect(uniquePrefabFolder('***', [])).toBe('custom/prefab')
  })
})

describe('capture exclusion list', () => {
  it('excludes exactly the editor-only components (plus NetworkEntity)', () => {
    expect([...EXCLUDED_COMPONENTS].sort()).toEqual(
      [
        'core-schema::Network-Entity',
        'inspector::CustomAsset',
        'inspector::Ground',
        'inspector::Hide',
        'inspector::Inert',
        'inspector::InertBackup',
        'inspector::Lock',
        'inspector::Nodes',
        'inspector::Selection',
        'inspector::Tile',
        'inspector::TransformConfig'
      ].sort()
    )
  })

  it('keeps authored components', () => {
    expect(isExcludedComponent('inspector::Hide')).toBe(true)
    expect(isExcludedComponent('asset-packs::Script')).toBe(false)
    expect(isExcludedComponent('Transform')).toBe(false)
    // inspector::UIState is scene metadata, not per-entity editor state
    expect(isExcludedComponent('inspector::UIState')).toBe(false)
  })

  // Ghosting an anchor must not travel with the prefab, or Save-over-prefab would
  // bake "editing only" into the thing every clone is built from.
  it('excludes the Inert marker', () => {
    expect(INERT_COMPONENT).toBe('inspector::Inert')
    expect(isExcludedComponent(INERT_COMPONENT)).toBe(true)
  })
})

describe('resource paths', () => {
  it('computes the common directory of the bundled resources', () => {
    expect(commonBasePath(['assets/pack/sub/model.glb', 'assets/pack/sub/tex.png'])).toBe(
      'assets/pack/sub'
    )
    // divergent trees have no common folder — each file then bundles by filename
    expect(commonBasePath(['models/door.glb', 'src/scripts/door.ts'])).toBe('')
    expect(commonBasePath(['models/door.glb'])).toBe('models')
    expect(commonBasePath([])).toBe('')
  })

  it('expresses a resource relative to the base, falling back to its filename', () => {
    expect(relativeResourcePath('assets/pack/sub/model.glb', 'assets/pack')).toBe('sub/model.glb')
    expect(relativeResourcePath('models/door.glb', 'models')).toBe('door.glb')
    expect(relativeResourcePath('elsewhere/door.glb', 'models')).toBe('door.glb')
  })

  it('only treats scheme-less paths as bundleable', () => {
    expect(isLocalResourcePath('models/door.glb')).toBe(true)
    expect(isLocalResourcePath('https://cdn.example/door.glb')).toBe(false)
    expect(isLocalResourcePath('')).toBe(false)
  })
})

describe('{assetPath} substitution', () => {
  it('rewrites every string, at any depth, to the prefab folder', () => {
    const value = {
      src: `${ASSET_PATH_TOKEN}/models/door.glb`,
      material: { pbr: { texture: { tex: { texture: { src: `${ASSET_PATH_TOKEN}/tex.png` } } } } },
      list: [`${ASSET_PATH_TOKEN}/scripts/door.ts`]
    }
    substituteAssetPath(value, 'custom/door')
    expect(value.src).toBe('custom/door/models/door.glb')
    expect(value.material.pbr.texture.tex.texture.src).toBe('custom/door/tex.png')
    expect(value.list[0]).toBe('custom/door/scripts/door.ts')
  })

  it('recurses into stringified jsonPayload carriers', () => {
    const value = { jsonPayload: JSON.stringify({ src: `${ASSET_PATH_TOKEN}/sounds/hit.mp3` }) }
    substituteAssetPath(value, 'custom/door')
    expect(JSON.parse(value.jsonPayload)).toEqual({ src: 'custom/door/sounds/hit.mp3' })
  })

  it('refuses to let a path escape the prefab folder', () => {
    const value = { src: `${ASSET_PATH_TOKEN}/../../secrets.json` }
    substituteAssetPath(value, 'custom/door')
    expect(value.src).toBe('custom/door')
  })

  it('is idempotent once substituted', () => {
    const value = { src: `${ASSET_PATH_TOKEN}/a.glb` }
    substituteAssetPath(value, 'custom/door')
    substituteAssetPath(value, 'custom/door')
    expect(value.src).toBe('custom/door/a.glb')
  })
})

describe('component references', () => {
  it('parses {self:Component} and {localId:Component}', () => {
    expect(parseComponentRef('{self:asset-packs::Actions}')).toEqual({
      componentName: 'asset-packs::Actions'
    })
    expect(parseComponentRef('{513:asset-packs::States}')).toEqual({
      componentName: 'asset-packs::States',
      localId: 513
    })
  })

  it('rejects anything that is not a placeholder', () => {
    expect(parseComponentRef(7)).toBeNull()
    expect(parseComponentRef('{self}')).toBeNull()
    expect(parseComponentRef(null)).toBeNull()
  })
})

describe('script layout entity params', () => {
  const layout = (params: Record<string, unknown>): string => JSON.stringify({ params })

  it('rewrites in-prefab entity params to markers and back', () => {
    const captured = remapLayoutToLocal(layout({ target: { type: 'entity', value: 517 } }), (id) =>
      id === 517 ? 513 : undefined
    )
    expect(captured.warnings).toEqual([])
    expect(JSON.parse(captured.layout).params.target.value).toBe(entityMarker(513))

    const placed = remapLayoutToEngine(captured.layout, (local) => (local === 513 ? 900 : undefined))
    expect(placed.warnings).toEqual([])
    expect(JSON.parse(placed.layout).params.target.value).toBe(900)
  })

  it('warns and clears a reference outside the captured subtree', () => {
    const result = remapLayoutToLocal(layout({ target: { type: 'entity', value: 999 } }), () => undefined)
    expect(result.warnings).toHaveLength(1)
    expect(JSON.parse(result.layout).params.target.value).toBe(0)
  })

  it('warns and clears a marker that has no entity at instantiation', () => {
    const result = remapLayoutToEngine(
      layout({ target: { type: 'entity', value: entityMarker(777) } }),
      () => undefined
    )
    expect(result.warnings).toHaveLength(1)
    expect(JSON.parse(result.layout).params.target.value).toBe(0)
  })

  it('leaves the scene root (0) and non-entity params alone', () => {
    const result = remapLayoutToLocal(
      layout({ root: { type: 'entity', value: 0 }, speed: { type: 'number', value: 3 } }),
      () => 513
    )
    const params = JSON.parse(result.layout).params
    expect(params.root.value).toBe(0)
    expect(params.speed.value).toBe(3)
  })

  it('remaps the entity inside an action param', () => {
    const result = remapLayoutToLocal(
      layout({ onOpen: { type: 'action', value: { entity: 517, action: 'open' } } }),
      () => 513
    )
    expect(JSON.parse(result.layout).params.onOpen.value).toEqual({
      entity: entityMarker(513),
      action: 'open'
    })
  })

  it('passes an unparseable layout through untouched', () => {
    const result = remapLayoutToLocal('not json', () => 1)
    expect(result.layout).toBe('not json')
    expect(result.warnings).toEqual([])
  })

  it('reads back only well-formed markers', () => {
    expect(parseEntityMarker(entityMarker(0))).toBe(0)
    expect(parseEntityMarker('{entity:x}')).toBeNull()
    expect(parseEntityMarker(512)).toBeNull()
  })
})

describe('prefabLayout', () => {
  const composite: PrefabComposite = {
    version: 1,
    components: [
      {
        name: 'core::Transform',
        data: {
          '513': { json: { parent: 512, position: { x: 1, y: 0, z: 0 } } },
          '512': { json: { parent: 0, position: { x: 0, y: 0, z: 0 } } }
        }
      },
      { name: 'core-schema::Name', data: { '512': { json: { value: 'Door' } } } }
    ]
  }

  it('walks roots first, breadth-first, with names and transforms attached', () => {
    const layout = prefabLayout(composite)
    expect(layout.roots).toEqual(['512'])
    expect(layout.entities.map((e) => e.localId)).toEqual(['512', '513'])
    expect(layout.entities[0].name).toBe('Door')
    expect(layout.entities[1].parent).toBe('512')
    expect(layout.entities[1].transform?.position).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('treats an entity with no Transform at all as a root (single-entity prefabs)', () => {
    const layout = prefabLayout({
      version: 1,
      components: [{ name: 'core::GltfContainer', data: { '0': { json: { src: 'a.glb' } } } }]
    })
    expect(layout.roots).toEqual(['0'])
    expect(layout.entities).toHaveLength(1)
  })
})

describe('parsePrefabData', () => {
  it('reads a folder written by this editor', () => {
    const raw = JSON.stringify({
      id: 'abc',
      name: 'Door',
      category: 'custom',
      tags: ['prop'],
      origin: { source: 'github', url: 'https://github.com/a/b', commit: 'deadbeef' },
      requiredPermissions: ['USE_WEB3_API']
    })
    expect(parsePrefabData(raw, 'data.json', 'fallback')).toEqual({
      id: 'abc',
      name: 'Door',
      category: 'custom',
      tags: ['prop'],
      origin: { source: 'github', url: 'https://github.com/a/b', commit: 'deadbeef', author: undefined, importedAt: undefined },
      requiredPermissions: ['USE_WEB3_API']
    })
  })

  it('falls back on a missing id and drops junk tags, permissions and origins', () => {
    const raw = JSON.stringify({
      name: 'Door',
      tags: ['ok', 7],
      requiredPermissions: ['a', null],
      origin: { source: 'somewhere-else' }
    })
    const data = parsePrefabData(raw, 'data.json', 'fallback')
    expect(data.id).toBe('fallback')
    expect(data.tags).toEqual(['ok'])
    expect(data.requiredPermissions).toEqual(['a'])
    expect(data.origin).toBeUndefined()
  })

  it('rejects a file that is not a prefab', () => {
    expect(() => parsePrefabData('[]', 'data.json', 'x')).toThrow()
    expect(() => parsePrefabData('{"id":"a"}', 'data.json', 'x')).toThrow()
  })

  it('reads version and changelog, dropping malformed entries', () => {
    const raw = JSON.stringify({
      id: 'abc',
      name: 'Door',
      version: '1.2.0',
      changelog: [
        { version: '1.2.0', notes: 'Second' },
        { version: '1.0.0', notes: 'Initial release' },
        { version: 3 },
        'junk',
        { notes: 'no version' }
      ]
    })
    const data = parsePrefabData(raw, 'data.json', 'fallback')
    expect(data.version).toBe('1.2.0')
    expect(data.changelog).toEqual([
      { version: '1.2.0', notes: 'Second' },
      { version: '1.0.0', notes: 'Initial release' }
    ])
  })

  it('leaves version and changelog undefined when absent or malformed', () => {
    const data = parsePrefabData(
      JSON.stringify({ id: 'abc', name: 'Door', version: 7, changelog: 'later' }),
      'data.json',
      'fallback'
    )
    expect(data.version).toBeUndefined()
    expect(data.changelog).toBeUndefined()
  })
})

describe('compareVersions', () => {
  it('compares numerically per segment', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.4.0', '0.3.0')).toBeGreaterThan(0)
  })

  it('treats a missing version as 0.0.0', () => {
    expect(compareVersions(undefined, '0.0.0')).toBe(0)
    expect(compareVersions('0.0.1', undefined)).toBeGreaterThan(0)
    expect(compareVersions(undefined, '1.0.0')).toBeLessThan(0)
  })

  it('tolerates short and junk segments', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
  })
})

describe('parsePrefabComposite', () => {
  it('keeps only well-formed component entries', () => {
    const raw = JSON.stringify({
      version: 2,
      components: [
        { name: 'core::Transform', data: { '0': { json: { parent: 0 } }, '1': { nope: 1 } } },
        { data: {} },
        { name: 'core::GltfContainer' }
      ]
    })
    const composite = parsePrefabComposite(raw, 'composite.json')
    expect(composite.version).toBe(2)
    expect(composite.components).toEqual([
      { name: 'core::Transform', data: { '0': { json: { parent: 0 } } } },
      { name: 'core::GltfContainer', data: {} }
    ])
  })

  it('rejects a file without components', () => {
    expect(() => parsePrefabComposite('{"version":1}', 'composite.json')).toThrow()
  })
})

// parsePrefabData is a whitelist: a field added to PrefabData but not read there
// is dropped silently, and whatever depends on it fails with no error anywhere.
// requiresSdk shipped that way once — the Server chip never rendered and the SDK
// gate never fired.
describe('requiresSdk survives the parser', () => {
  it('is kept when the prefab declares it', () => {
    const data = parsePrefabData(JSON.stringify({ name: 'Server Clock', requiresSdk: 'auth-server' }), 'x', 'id')
    expect(data.requiresSdk).toBe('auth-server')
  })

  it('is absent when unset, and ignores a value it does not know', () => {
    expect(parsePrefabData(JSON.stringify({ name: 'a' }), 'x', 'id').requiresSdk).toBeUndefined()
    expect(
      parsePrefabData(JSON.stringify({ name: 'a', requiresSdk: 'nonsense' }), 'x', 'id').requiresSdk
    ).toBeUndefined()
  })
})

// Same trap, second occupant: the whole Spawnable feature is one field in
// data.json, so the parse branch and the type have to land together.
describe('spawnable survives the parser', () => {
  const parse = (spawnable: unknown): PrefabData =>
    parsePrefabData(JSON.stringify({ id: 'p1', name: 'Zombie', spawnable }), 'data.json', 'fallback')

  it('round-trips through parse → serialise → parse', () => {
    const first = parse({ max: 64, instancing: 'perPlayer' })
    expect(first.spawnable).toEqual({ max: 64, instancing: 'perPlayer' })
    const second = parsePrefabData(JSON.stringify(first), 'data.json', 'fallback')
    expect(second).toEqual(first)
  })

  it('defaults instancing by omitting it', () => {
    expect(parse({ max: 8 }).spawnable).toEqual({ max: 8 })
    expect(parse({ max: 8, instancing: 'onDemand' }).spawnable).toEqual({
      max: 8,
      instancing: 'onDemand'
    })
  })

  it('is absent when the prefab does not declare it', () => {
    expect(parsePrefabData(JSON.stringify({ name: 'a' }), 'x', 'id').spawnable).toBeUndefined()
  })

  // A clamp here would be a lie: the cap is what the pool enforces, so a value
  // the editor cannot honour has to read as "not spawnable at all".
  it('rejects a malformed or out-of-range max rather than clamping it', () => {
    expect(parse({ max: 0 }).spawnable).toBeUndefined()
    expect(parse({ max: 1025 }).spawnable).toBeUndefined()
    expect(parse({ max: 2.5 }).spawnable).toBeUndefined()
    expect(parse({ max: '64' }).spawnable).toBeUndefined()
    expect(parse({}).spawnable).toBeUndefined()
    expect(parse('yes').spawnable).toBeUndefined()
    expect(parse({ max: 1 }).spawnable).toEqual({ max: 1 })
    expect(parse({ max: 1024 }).spawnable).toEqual({ max: 1024 })
  })

  it('drops an instancing mode it does not know, keeping the cap', () => {
    expect(parse({ max: 4, instancing: 'perTeam' }).spawnable).toEqual({ max: 4 })
  })

  it('exposes the same branch standalone', () => {
    expect(parseSpawnable({ max: 3 })).toEqual({ max: 3 })
    expect(parseSpawnable(null)).toBeUndefined()
  })
})
