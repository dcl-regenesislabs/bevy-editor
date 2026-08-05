import { describe, it, expect } from 'vitest'
import {
  driftEntryCount,
  folderRelForResource,
  instanceDrift,
  realignCapturedResources,
  structuralEqual
} from './drift'
import type { PrefabComposite, PrefabSnapshot } from './format'

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const UNIT = { x: 1, y: 1, z: 1 }

function transform(parent: number, x = 0): Record<string, unknown> {
  return { position: { x, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT, parent }
}

function scriptValue(path: string, layout: string): Record<string, unknown> {
  return { value: [{ path, priority: 0, layout }] }
}

function composite(components: Array<[string, Record<string, unknown>]>): PrefabComposite {
  const byName = new Map<string, { name: string; data: Record<string, { json: unknown }> }>()
  for (const [name, data] of components) {
    const entry = byName.get(name) ?? { name, data: {} }
    for (const [localId, json] of Object.entries(data)) entry.data[localId] = { json }
    byName.set(name, entry)
  }
  return { version: 1, components: [...byName.values()] }
}

// A single-entity prefab whose only resource is its script, the shape every
// built-in in packages/desktop/prefabs/ has.
const FOLDER = 'custom/zone_authority'
const SCRIPT_PATH = `${FOLDER}/scripts/trigger-zone-server.ts`

const singleEntityFolder = composite([
  ['core-schema::Name', { '0': { value: 'Zone Authority' } }],
  [
    'asset-packs::Script',
    { '0': scriptValue('{assetPath}/scripts/trigger-zone-server.ts', '{"params":{},"actions":[]}') }
  ]
])

function placedInstance(overrides: Record<string, unknown> = {}): PrefabSnapshot {
  return {
    '600': {
      Transform: transform(0, 8),
      'core-schema::Name': { value: 'Zone Authority 2' },
      'inspector::CustomAsset': { assetId: 'abc' },
      'asset-packs::Script': scriptValue(
        SCRIPT_PATH,
        '{"params":{"radius":{"type":"number","value":4}},"actions":[]}'
      ),
      ...overrides
    }
  }
}

describe('instanceDrift — the placement round trip', () => {
  it('reads a freshly placed built-in prefab as clean', () => {
    const result = instanceDrift(placedInstance(), '600', singleEntityFolder, { folder: FOLDER })
    expect(result.status).toBe('clean')
    expect(driftEntryCount(result)).toBe(0)
  })

  // the negative control for the {assetPath} rebasing: capture expresses the one
  // file it sees relative to its own directory, so without the folder the script
  // path alone reads as drift
  it('needs the folder to re-express a rebased resource path', () => {
    const result = instanceDrift(placedInstance(), '600', singleEntityFolder)
    expect(result.status).toBe('drifted')
    expect(result.changed).toEqual([{ localId: '0', component: 'asset-packs::Script' }])
  })

  it('ignores the name placement uniquified', () => {
    const snapshot = placedInstance({ 'core-schema::Name': { value: 'Something Else Entirely' } })
    expect(instanceDrift(snapshot, '600', singleEntityFolder, { folder: FOLDER }).status).toBe(
      'clean'
    )
  })

  it('ignores the root transform, which is the drop position and not the prefab', () => {
    const snapshot = placedInstance({ Transform: transform(0, -212.5) })
    expect(instanceDrift(snapshot, '600', singleEntityFolder, { folder: FOLDER }).status).toBe(
      'clean'
    )
  })

  it('is unknown when the root is not in the snapshot', () => {
    expect(instanceDrift(placedInstance(), '999', singleEntityFolder).status).toBe('unknown')
  })

  it('is unknown for a multi-root folder, which is placed under a generated container', () => {
    const multiRoot = composite([
      ['core::Transform', { '512': transform(0), '513': transform(0) }]
    ])
    expect(instanceDrift(placedInstance(), '600', multiRoot).status).toBe('unknown')
  })
})

describe('instanceDrift — script rows', () => {
  it('accepts params instantiation filled in over an empty folder layout', () => {
    const snapshot = placedInstance({
      'asset-packs::Script': scriptValue(
        SCRIPT_PATH,
        '{"params":{"radius":{"type":"number","value":4},"tag":{"type":"string","value":"a"}},"actions":[]}'
      )
    })
    expect(instanceDrift(snapshot, '600', singleEntityFolder, { folder: FOLDER }).status).toBe(
      'clean'
    )
  })

  it('reports an edited param value when the folder declares params too', () => {
    const authoredFolder = composite([
      [
        'asset-packs::Script',
        {
          '0': scriptValue(
            '{assetPath}/scripts/trigger-zone-server.ts',
            '{"params":{"radius":{"type":"number","value":4}},"actions":[]}'
          )
        }
      ]
    ])
    const snapshot = placedInstance({
      'asset-packs::Script': scriptValue(
        SCRIPT_PATH,
        '{"params":{"radius":{"type":"number","value":9}},"actions":[]}'
      )
    })
    const result = instanceDrift(snapshot, '600', authoredFolder, { folder: FOLDER })
    expect(result.status).toBe('drifted')
    expect(result.changed).toEqual([{ localId: '0', component: 'asset-packs::Script' }])
  })

  it('reports a second script attached to the instance', () => {
    const snapshot = placedInstance({
      'asset-packs::Script': {
        value: [
          { path: SCRIPT_PATH, priority: 0, layout: '{"params":{},"actions":[]}' },
          { path: 'src/scripts/gun-hitscan.ts', priority: 0, layout: '{"params":{},"actions":[]}' }
        ]
      }
    })
    const result = instanceDrift(snapshot, '600', singleEntityFolder, { folder: FOLDER })
    expect(result.status).toBe('drifted')
    expect(result.changed).toEqual([{ localId: '0', component: 'asset-packs::Script' }])
  })
})

describe('instanceDrift — structure', () => {
  const parentFolder = composite([
    ['core-schema::Name', { '0': { value: 'Rig' }, '513': { value: 'HandAnchor' } }],
    ['core::Transform', { '513': { ...transform(0), position: { x: 0, y: 1, z: 0 } } }],
    ['core::GltfContainer', { '513': { src: '{assetPath}/models/hand.glb' } }]
  ])

  const placedParent = (): PrefabSnapshot => ({
    '600': { Transform: transform(0, 4), 'core-schema::Name': { value: 'Rig' } },
    '601': {
      Transform: { ...transform(600), position: { x: 0, y: 1, z: 0 } },
      'core-schema::Name': { value: 'HandAnchor' },
      GltfContainer: { src: `${FOLDER}/models/hand.glb` }
    }
  })

  it('matches a two-entity instance against its folder', () => {
    expect(instanceDrift(placedParent(), '600', parentFolder, { folder: FOLDER }).status).toBe(
      'clean'
    )
  })

  it('reports only the new entity when a child is inserted before the existing one', () => {
    const snapshot = placedParent()
    // a fresh entity always carries the highest engine id, so it sorts last among
    // its siblings — the sibling that was already there keeps its path
    snapshot['700'] = { Transform: transform(600), GltfContainer: { src: 'src/pistol.glb' } }
    const result = instanceDrift(snapshot, '600', parentFolder, { folder: FOLDER })
    expect(result.status).toBe('drifted')
    expect(result.removed).toEqual([])
    expect(result.changed).toEqual([])
    expect(result.added.map((entry) => entry.component)).toEqual([
      'core::GltfContainer',
      'core::Transform'
    ])
  })

  it('reports a deleted child as removed', () => {
    const snapshot = placedParent()
    delete snapshot['601']
    const result = instanceDrift(snapshot, '600', parentFolder, { folder: FOLDER })
    expect(result.status).toBe('drifted')
    expect(result.removed.map((entry) => entry.component)).toEqual([
      'core::GltfContainer',
      'core::Transform'
    ])
    expect(result.added).toEqual([])
  })

  it('reports a moved child as a transform change, not as an add plus a remove', () => {
    const snapshot = placedParent()
    snapshot['601'].Transform = { ...transform(600), position: { x: 0, y: 3.5, z: 0 } }
    const result = instanceDrift(snapshot, '600', parentFolder, { folder: FOLDER })
    expect(result.changed).toEqual([{ localId: '513', component: 'core::Transform' }])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
  })

  it('leaves f32 round-tripping alone', () => {
    const snapshot = placedParent()
    snapshot['601'].Transform = {
      ...transform(600),
      position: { x: 0, y: Math.fround(1) + 1e-9, z: 0 }
    }
    expect(instanceDrift(snapshot, '600', parentFolder, { folder: FOLDER }).status).toBe('clean')
  })
})

describe('realignCapturedResources', () => {
  it('keeps a file already in the folder exactly where it is', () => {
    const captured = composite([
      ['asset-packs::Script', { '0': scriptValue('{assetPath}/trigger-zone-server.ts', '{}') }]
    ])
    const { composite: out, resources } = realignCapturedResources(
      captured,
      [{ source: SCRIPT_PATH, rel: 'trigger-zone-server.ts' }],
      FOLDER
    )
    expect(resources).toEqual([{ source: SCRIPT_PATH, rel: 'scripts/trigger-zone-server.ts' }])
    const script = out.components[0].data['0'].json as { value: Array<{ path: string }> }
    expect(script.value[0].path).toBe('{assetPath}/scripts/trigger-zone-server.ts')
  })

  it('files a newly referenced script under scripts/ and a model under models/', () => {
    expect(
      folderRelForResource({ source: 'src/scripts/gun-hitscan.ts', rel: 'gun-hitscan.ts' }, FOLDER)
    ).toBe('scripts/gun-hitscan.ts')
    expect(folderRelForResource({ source: 'assets/pistol.glb', rel: 'pistol.glb' }, FOLDER)).toBe(
      'models/pistol.glb'
    )
  })

  it('rewrites a path nested inside a stringified jsonPayload', () => {
    const captured = composite([
      [
        'asset-packs::Actions',
        {
          '0': {
            value: [
              { type: 'play_sound', jsonPayload: JSON.stringify({ src: '{assetPath}/beep.mp3' }) }
            ]
          }
        }
      ]
    ])
    const { composite: out } = realignCapturedResources(
      captured,
      [{ source: `${FOLDER}/audio/beep.mp3`, rel: 'beep.mp3' }],
      FOLDER
    )
    const actions = out.components[0].data['0'].json as {
      value: Array<{ jsonPayload: string }>
    }
    expect(JSON.parse(actions.value[0].jsonPayload)).toEqual({ src: '{assetPath}/audio/beep.mp3' })
  })
})

describe('structuralEqual', () => {
  it('compares numbers modulo float32 rounding', () => {
    expect(structuralEqual(0.1, Math.fround(0.1))).toBe(true)
    expect(structuralEqual(0.1, 0.2)).toBe(false)
  })

  it('compares nested shapes by value', () => {
    expect(structuralEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
    expect(structuralEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })
})
