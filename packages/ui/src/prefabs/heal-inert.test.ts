import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, writes, deletes, folderWrites } = vi.hoisted(() => ({
  state: { snapshot: {} as Record<string, Record<string, unknown>> },
  writes: [] as Array<{ id: string; name: string; json: string }>,
  deletes: [] as Array<{ id: string; name: string }>,
  folderWrites: [] as Array<{ path: string; value: unknown }>
}))

vi.mock('@scene/state', () => ({ state }))
vi.mock('./storage', () => ({
  writeJsonFile: async (path: string, value: unknown) => {
    folderWrites.push({ path, value })
  }
}))
vi.mock('@scene/inspector', () => ({
  writeComponent: async (id: string, name: string, json: string) => {
    writes.push({ id, name, json })
  },
  deleteComponent: (id: string, name: string) => {
    deletes.push({ id, name })
  }
}))

import { healInertArtifacts } from './heal-inert'
import { parsePrefabComposite } from './format'

const FOLDER_COMPOSITE = JSON.stringify({
  version: 1,
  components: [
    {
      name: 'core::GltfContainer',
      data: {
        '0': { json: { src: '{assetPath}/CoolBed.glb', visibleMeshesCollisionMask: 3, invisibleMeshesCollisionMask: 3 } }
      }
    }
  ]
})

const prefab = {
  folder: 'custom/coolbed_glb_2',
  data: { id: 'bed-1' },
  composite: parsePrefabComposite(FOLDER_COMPOSITE, 'custom/coolbed_glb_2')
}

beforeEach(() => {
  state.snapshot = {}
  writes.length = 0
  deletes.length = 0
  folderWrites.length = 0
})

// The real corruption found in towerofmadness: the backup restored a folder
// token as the scene src, and an echoed visible:false as the authored value.
describe('healInertArtifacts', () => {
  it('resolves a leaked {assetPath} token from the folder and drops the echoed hide', async () => {
    state.snapshot = {
      '512': {
        'inspector::Inert': {},
        'inspector::CustomAsset': { assetId: 'bed-1' },
        GltfContainer: { src: '{assetPath}/CoolBed.glb', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 },
        VisibilityComponent: { visible: false }
      }
    }
    const healed = await healInertArtifacts([prefab])
    expect(healed).toHaveLength(2)
    const gltf = JSON.parse(writes[0].json) as { src: string }
    expect(gltf.src).toBe('custom/coolbed_glb_2/CoolBed.glb')
    expect(deletes).toEqual([{ id: '512', name: 'VisibilityComponent' }])
  })

  it('heals a blank src the same way', async () => {
    state.snapshot = {
      '512': {
        'inspector::Inert': {},
        'inspector::CustomAsset': { assetId: 'bed-1' },
        GltfContainer: { src: '' }
      }
    }
    await healInertArtifacts([prefab])
    expect((JSON.parse(writes[0].json) as { src: string }).src).toBe('custom/coolbed_glb_2/CoolBed.glb')
  })

  it('repairs a folder whose model source was saved over blank, from the model file beside it', async () => {
    const poisoned = {
      folder: 'custom/coolbed_glb_2',
      data: { id: 'bed-1' },
      composite: parsePrefabComposite(
        JSON.stringify({
          version: 1,
          components: [
            {
              name: 'core::GltfContainer',
              data: { '0': { json: { src: '', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 } } }
            }
          ]
        }),
        'custom/coolbed_glb_2'
      )
    }
    const healed = await healInertArtifacts(
      [poisoned],
      ['custom/coolbed_glb_2/composite.json', 'custom/coolbed_glb_2/CoolBed.glb']
    )
    expect(healed).toContain('folder:custom/coolbed_glb_2')
    const written = folderWrites[0].value as { components: Array<{ name: string; data: Record<string, { json: unknown }> }> }
    expect(written.components[0].data['0'].json).toEqual({ src: '{assetPath}/CoolBed.glb' })
  })

  it('leaves a folder with two models alone — there is no honest guess', async () => {
    const poisoned = {
      folder: 'custom/x',
      data: { id: 'x-1' },
      composite: parsePrefabComposite(
        JSON.stringify({
          version: 1,
          components: [{ name: 'core::GltfContainer', data: { '0': { json: { src: '' } } } }]
        }),
        'custom/x'
      )
    }
    const healed = await healInertArtifacts([poisoned], ['custom/x/a.glb', 'custom/x/b.glb'])
    expect(healed).toEqual([])
    expect(folderWrites).toEqual([])
  })

  it('restores a collider and click behavior the damaged era ate from a spawn-only copy', async () => {
    const folder = parsePrefabComposite(
      JSON.stringify({
        version: 1,
        components: [
          { name: 'core::GltfContainer', data: { '0': { json: { src: '{assetPath}/CoolBed.glb' } } } },
          { name: 'core::MeshCollider', data: { '0': { json: { collisionMask: 1, mesh: { box: {} } } } } },
          { name: 'core::PointerEvents', data: { '0': { json: { pointerEvents: [] } } } }
        ]
      }),
      'custom/coolbed_glb_2'
    )
    state.snapshot = {
      '512': {
        'inspector::Inert': {},
        'inspector::CustomAsset': { assetId: 'bed-1' },
        GltfContainer: { src: 'custom/coolbed_glb_2/CoolBed.glb' }
      }
    }
    const healed = await healInertArtifacts([{ folder: 'custom/coolbed_glb_2', data: { id: 'bed-1' }, composite: folder }])
    expect(healed).toEqual(['512:MeshCollider', '512:PointerEvents'])
    expect(writes.map((w) => w.name)).toEqual(['MeshCollider', 'PointerEvents'])
  })

  it('never touches an entity that is not spawn-only, or values that are authored', async () => {
    state.snapshot = {
      '600': { 'inspector::CustomAsset': { assetId: 'bed-1' }, GltfContainer: { src: '' } },
      '601': {
        'inspector::Inert': {},
        'inspector::CustomAsset': { assetId: 'bed-1' },
        GltfContainer: { src: 'assets/models/real.glb' },
        VisibilityComponent: { visible: true }
      }
    }
    const healed = await healInertArtifacts([prefab])
    expect(healed).toEqual([])
  })
})
