import { describe, it, expect } from 'vitest'
import { assignLocalIds, authoredOnly, captureSelectionAsPrefab } from './capture'
import { entityMarker, type PrefabComposite, type PrefabSnapshot } from './format'

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const UNIT = { x: 1, y: 1, z: 1 }

function transform(parent: number, x = 0): Record<string, unknown> {
  return { position: { x, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT, parent }
}

function dataOf(composite: PrefabComposite, name: string): Record<string, { json: unknown }> {
  return composite.components.find((c) => c.name === name)?.data ?? {}
}

describe('assignLocalIds', () => {
  it('numbers a single-entity prefab as "0"', () => {
    const snapshot: PrefabSnapshot = { '512': { Transform: transform(0) } }
    const ids = assignLocalIds(snapshot, ['512'])
    expect(ids.entities).toEqual([{ entityId: '512', localId: 0, isRoot: true }])
  })

  it('keeps the single root at 0 and numbers its subtree from 512+rootCount', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0) },
      '601': { Transform: transform(600) },
      '602': { Transform: transform(601) }
    }
    const ids = assignLocalIds(snapshot, ['600'])
    expect([...ids.byEntity]).toEqual([
      ['600', 0],
      ['601', 513],
      ['602', 514]
    ])
  })

  it('numbers multiple roots at 512+index and the rest after them', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0) },
      '601': { Transform: transform(600) },
      '700': { Transform: transform(0) }
    }
    const ids = assignLocalIds(snapshot, ['600', '700'])
    expect([...ids.byEntity]).toEqual([
      ['600', 512],
      ['601', 514],
      ['700', 513]
    ])
  })

  it('ignores roots that are not in the snapshot', () => {
    const ids = assignLocalIds({ '600': { Transform: transform(0) } }, ['600', '999'])
    expect(ids.roots).toEqual(['600'])
  })
})

describe('video texture refs', () => {
  const material = (videoPlayerEntity: number): Record<string, unknown> => ({
    material: {
      pbr: { texture: { tex: { videoTexture: { videoPlayerEntity, wrapMode: 0 } } } }
    }
  })

  it('turns a self-reference into {self} and an in-subtree ref into a local id', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0), Material: material(600) },
      '601': { Transform: transform(600), Material: material(600) }
    }
    const { composite } = captureSelectionAsPrefab(snapshot, ['600'])
    const data = dataOf(composite, 'core::Material')
    const refOf = (localId: string): unknown => {
      const value = data[localId]?.json as Record<string, unknown>
      const tex = (((value.material as Record<string, unknown>).pbr as Record<string, unknown>)
        .texture as Record<string, unknown>).tex as Record<string, unknown>
      return (tex.videoTexture as Record<string, unknown>).videoPlayerEntity
    }
    expect(refOf('0')).toBe('{self}')
    expect(refOf('513')).toBe(entityMarker(0))
  })

  it('warns and clears a ref pointing outside the prefab', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0), Material: material(900) },
      '900': { Transform: transform(0) }
    }
    const { composite, warnings } = captureSelectionAsPrefab(snapshot, ['600'])
    const value = dataOf(composite, 'core::Material')['0']?.json as Record<string, unknown>
    const tex = (((value.material as Record<string, unknown>).pbr as Record<string, unknown>)
      .texture as Record<string, unknown>).tex as Record<string, unknown>
    expect((tex.videoTexture as Record<string, unknown>).videoPlayerEntity).toBe(0)
    expect(warnings.some((w) => w.includes('video texture'))).toBe(true)
  })
})

describe('authoredOnly', () => {
  it('drops runtime entities and, through the parent chain, their subtrees', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0), 'core-schema::Name': { value: 'LeaderBoard' } },
      '601': { Transform: transform(600), 'core-schema::Name': { value: 'Frame' } },
      '632': { Transform: transform(600) },
      '633': { Transform: transform(632) }
    }
    const runtime = new Set(['632', '633'])
    const authored = authoredOnly(snapshot, (id) => runtime.has(id))

    expect(Object.keys(authored)).toEqual(['600', '601'])

    const ids = assignLocalIds(authored, ['600'])
    expect([...ids.byEntity.keys()]).toEqual(['600', '601'])
  })

  it('keeps everything when nothing is runtime', () => {
    const snapshot: PrefabSnapshot = { '600': { Transform: transform(0) } }
    expect(authoredOnly(snapshot, () => false)).toEqual(snapshot)
  })

  it('captures none of a runtime subtree even when its root is selected', () => {
    const snapshot: PrefabSnapshot = {
      '700': { Transform: transform(0) },
      '701': { Transform: transform(700) }
    }
    const authored = authoredOnly(snapshot, () => true)
    const captured = captureSelectionAsPrefab(authored, ['700'])
    expect(captured.ids.entities).toEqual([])
    expect(captured.composite.components).toEqual([])
  })
})

describe('captureSelectionAsPrefab', () => {
  it('drops the root Transform of a single-root prefab and rebases nothing', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0, 8), 'core-schema::Name': { value: 'Door' } },
      '601': { Transform: transform(600, 1) }
    }
    const { composite } = captureSelectionAsPrefab(snapshot, ['600'])
    const transforms = dataOf(composite, 'core::Transform')
    expect(Object.keys(transforms)).toEqual(['513'])
    expect(transforms['513'].json).toMatchObject({ parent: 0 })
    expect(dataOf(composite, 'core-schema::Name')['0'].json).toEqual({ value: 'Door' })
  })

  it('rebases multiple roots around their centroid and keeps their Transforms', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0, 10) },
      '700': { Transform: transform(0, 20) }
    }
    const { composite } = captureSelectionAsPrefab(snapshot, ['600', '700'])
    const transforms = dataOf(composite, 'core::Transform')
    expect(transforms['512'].json).toMatchObject({ position: { x: -5, y: 0, z: 0 }, parent: 0 })
    expect(transforms['513'].json).toMatchObject({ position: { x: 5, y: 0, z: 0 }, parent: 0 })
  })

  it('remaps in-subtree Transform.parent to local ids', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0) },
      '601': { Transform: transform(600) },
      '700': { Transform: transform(0) }
    }
    const { composite } = captureSelectionAsPrefab(snapshot, ['600', '700'])
    expect(dataOf(composite, 'core::Transform')['514'].json).toMatchObject({ parent: 512 })
  })

  it('never captures editor-only components', () => {
    const snapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(0),
        'inspector::Selection': { gizmo: 0 },
        'inspector::Nodes': { value: [] },
        'inspector::CustomAsset': { assetId: 'x' },
        'core-schema::Network-Entity': { entityId: 1, networkId: 0 }
      }
    }
    const { composite } = captureSelectionAsPrefab(snapshot, ['600'])
    expect(composite.components.map((c) => c.name)).toEqual([])
  })

  it('rewrites resource paths to {assetPath} and lists what to bundle', () => {
    const snapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(0),
        GltfContainer: { src: 'models/sub/door.glb', visibleMeshesCollisionMask: 3 },
        AudioSource: { audioClipUrl: 'models/hit.mp3' }
      }
    }
    const { composite, resources } = captureSelectionAsPrefab(snapshot, ['600'])
    expect(dataOf(composite, 'core::GltfContainer')['0'].json).toMatchObject({
      src: '{assetPath}/sub/door.glb'
    })
    expect(dataOf(composite, 'core::AudioSource')['0'].json).toMatchObject({
      audioClipUrl: '{assetPath}/hit.mp3'
    })
    expect(resources).toEqual([
      { source: 'models/sub/door.glb', rel: 'sub/door.glb' },
      { source: 'models/hit.mp3', rel: 'hit.mp3' }
    ])
  })

  it('leaves remote urls alone', () => {
    const snapshot: PrefabSnapshot = {
      '600': { Transform: transform(0), VideoPlayer: { src: 'https://cdn.example/clip.mp4' } }
    }
    const { composite, resources } = captureSelectionAsPrefab(snapshot, ['600'])
    expect(dataOf(composite, 'core::VideoPlayer')['0'].json).toMatchObject({
      src: 'https://cdn.example/clip.mp4'
    })
    expect(resources).toEqual([])
  })

  it('templates the script path and localizes its entity params', () => {
    const layout = JSON.stringify({ params: { target: { type: 'entity', value: 601 } } })
    const snapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(0),
        'asset-packs::Script': { value: [{ path: 'src/scripts/door.ts', priority: 0, layout }] }
      },
      '601': { Transform: transform(600) }
    }
    const { composite, resources, warnings } = captureSelectionAsPrefab(snapshot, ['600'])
    const script = dataOf(composite, 'asset-packs::Script')['0'].json as {
      value: Array<{ path: string; layout: string }>
    }
    expect(script.value[0].path).toBe('{assetPath}/door.ts')
    expect(JSON.parse(script.value[0].layout).params.target.value).toBe(entityMarker(513))
    expect(resources).toEqual([{ source: 'src/scripts/door.ts', rel: 'door.ts' }])
    expect(warnings).toEqual([])
  })

  it('turns id-bearing components into {self} and trigger refs into placeholders', () => {
    const snapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(0),
        'asset-packs::Actions': { id: 7, value: [{ name: 'open', type: 'play_sound', jsonPayload: '{}' }] },
        'asset-packs::Triggers': {
          value: [{ type: 'on_click', actions: [{ id: 7, name: 'open' }], conditions: [] }]
        }
      },
      '601': {
        Transform: transform(600),
        'asset-packs::Triggers': {
          value: [{ type: 'on_click', actions: [{ id: 7, name: 'open' }] }]
        }
      }
    }
    const { composite, warnings } = captureSelectionAsPrefab(snapshot, ['600'])
    expect(dataOf(composite, 'asset-packs::Actions')['0'].json).toMatchObject({ id: '{self}' })
    const own = dataOf(composite, 'asset-packs::Triggers')['0'].json as {
      value: Array<{ actions: Array<{ id: unknown }> }>
    }
    const other = dataOf(composite, 'asset-packs::Triggers')['513'].json as {
      value: Array<{ actions: Array<{ id: unknown }> }>
    }
    expect(own.value[0].actions[0].id).toBe('{self:asset-packs::Actions}')
    expect(other.value[0].actions[0].id).toBe('{0:asset-packs::Actions}')
    expect(warnings).toEqual([])
  })

  it('warns and nulls a trigger ref pointing outside the prefab instead of throwing', () => {
    const snapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(0),
        'asset-packs::Triggers': { value: [{ type: 'on_click', actions: [{ id: 42 }] }] }
      },
      '900': { Transform: transform(0), 'asset-packs::Actions': { id: 42, value: [] } }
    }
    const { composite, warnings } = captureSelectionAsPrefab(snapshot, ['600'])
    const triggers = dataOf(composite, 'asset-packs::Triggers')['0'].json as {
      value: Array<{ actions: Array<{ id: unknown }> }>
    }
    expect(triggers.value[0].actions[0].id).toBeNull()
    expect(warnings).toHaveLength(1)
  })

  it('rewrites a resource path inside an action payload', () => {
    const snapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(0),
        'asset-packs::Actions': {
          id: 1,
          value: [
            { name: 'play', type: 'play_sound', jsonPayload: JSON.stringify({ src: 'sounds/hit.mp3' }) }
          ]
        }
      }
    }
    const { composite, resources } = captureSelectionAsPrefab(snapshot, ['600'])
    const actions = dataOf(composite, 'asset-packs::Actions')['0'].json as {
      value: Array<{ jsonPayload: string }>
    }
    expect(JSON.parse(actions.value[0].jsonPayload)).toEqual({ src: '{assetPath}/hit.mp3' })
    expect(resources).toEqual([{ source: 'sounds/hit.mp3', rel: 'hit.mp3' }])
  })
})
