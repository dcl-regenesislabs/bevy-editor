// Placement invariants, through the REAL instantiatePrefab:
//
//   - a freshly placed instance compares CLEAN against the folder it came from
//     (the create → place → drift chain must agree with itself, or every fresh
//     placement opens the drift dialog over nothing);
//   - two placements of one prefab never fight over names — the second copy's
//     entities are suffixed, and a name a script still references counts as
//     taken even when no entity carries it (a freed zone name silently re-binds
//     the reactions that kept the string);
//   - the root is stamped as an instance of the prefab (`inspector::CustomAsset`),
//     which is what every later gesture keys on.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: {
    snapshot: {} as Record<string, Record<string, unknown>>,
    frozen: true,
    activeEntity: null as string | null
  },
  nextId: 600,
  files: new Map<string, string>()
}))

vi.mock('@scene/state', () => ({
  state: h.state,
  setSelected: () => {}
}))
vi.mock('@scene/inspector', () => ({
  allocateNamedEntities: async (names: Array<{ value: string }>) => {
    const ids: number[] = []
    for (const name of names) {
      const id = h.nextId++
      h.state.snapshot[String(id)] = { 'core-schema::Name': { value: name.value } }
      ids.push(id)
    }
    return ids
  },
  writeComponent: async (id: string, name: string, json: string) => {
    h.state.snapshot[id] = { ...h.state.snapshot[id], [name]: JSON.parse(json) as unknown }
  },
  reloadSnapshot: async () => {}
}))
vi.mock('../panels/reveal', () => ({ revealInTree: () => {} }))
vi.mock('../assets', () => ({ ensureContentMapped: async () => {} }))
vi.mock('../engine/datalayer', () => ({
  dataLayerReadFile: async (path: string) => {
    const text = h.files.get(path)
    if (text === undefined) throw new Error(`no such file ${path}`)
    return text
  }
}))
vi.mock('./storage', () => ({
  mergeRequiredPermissions: async () => [],
  readPrefabFolder: async (folder: string) => ({
    folder,
    data: { id: 'board-uuid', name: 'Board', category: 'custom', tags: [] },
    composite: parsePrefabComposite(FOLDER_COMPOSITE_JSON, folder)
  })
}))

import { instantiatePrefab } from './instantiate'
import { instanceDrift } from './drift'
import { parsePrefabComposite } from './format'

const FOLDER = 'custom/board_kit'

// A two-entity, single-root prefab: script on the root, model on the child —
// the same shape the built-in kits ship (player-rig keeps scripts on children).
const FOLDER_COMPOSITE_JSON = JSON.stringify({
  version: 1,
  components: [
    {
      name: 'core::Transform',
      data: {
        '512': {
          json: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            parent: 0
          }
        },
        '513': {
          json: {
            position: { x: 0, y: 1.5, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            scale: { x: 1, y: 1, z: 1 },
            parent: 512
          }
        }
      }
    },
    {
      name: 'core::GltfContainer',
      data: {
        '513': {
          json: {
            src: '{assetPath}/models/board.glb',
            visibleMeshesCollisionMask: 3,
            invisibleMeshesCollisionMask: 3
          }
        }
      }
    },
    {
      name: 'asset-packs::Script',
      data: {
        '512': {
          json: { value: [{ path: '{assetPath}/scripts/board.ts', priority: 0, layout: '' }] }
        }
      }
    },
    {
      name: 'core-schema::Name',
      data: { '512': { json: { value: 'Board' } }, '513': { json: { value: 'Panel' } } }
    }
  ]
})

const BOARD_SCRIPT = `
import { Entity } from '@dcl/sdk/ecs'
export class Board {
  constructor(src: string, entity: Entity, public speed: number = 2, public label: string = 'HI') {}
}
`

function namesInScene(): string[] {
  return Object.values(h.state.snapshot)
    .map((c) => (c['core-schema::Name'] as { value?: string } | undefined)?.value)
    .filter((v): v is string => typeof v === 'string')
    .sort()
}

function folderComposite(): ReturnType<typeof parsePrefabComposite> {
  return parsePrefabComposite(FOLDER_COMPOSITE_JSON, FOLDER)
}

beforeEach(() => {
  h.state.snapshot = { '0': {} }
  h.state.frozen = true
  h.nextId = 600
  h.files.clear()
  h.files.set(`${FOLDER}/scripts/board.ts`, BOARD_SCRIPT)
})

describe('a fresh placement', () => {
  it('compares clean against the folder it came from', async () => {
    const placed = await instantiatePrefab(FOLDER, { x: 8, y: 0, z: 8 })
    expect(placed.rootId).not.toBeNull()
    expect(placed.warnings).toEqual([])

    const result = instanceDrift(h.state.snapshot, placed.rootId as string, folderComposite(), {
      folder: FOLDER,
      isRuntime: () => false
    })
    expect(result.changed).toEqual([])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.status).toBe('clean')
  })

  it('stamps the root as an instance and fills the empty Script layout from the file', async () => {
    const placed = await instantiatePrefab(FOLDER, { x: 8, y: 0, z: 8 })
    const root = h.state.snapshot[placed.rootId as string]
    expect(root['inspector::CustomAsset']).toEqual({ assetId: 'board-uuid' })

    const script = root['asset-packs::Script'] as { value: Array<{ path: string; layout: string }> }
    expect(script.value[0].path).toBe(`${FOLDER}/scripts/board.ts`)
    const layout = JSON.parse(script.value[0].layout) as { params: Record<string, { value: unknown }> }
    expect(layout.params.speed.value).toBe(2)
    expect(layout.params.label.value).toBe('HI')
  })
})

describe('two placements of one prefab', () => {
  it('never fight over names, and both stay clean', async () => {
    const first = await instantiatePrefab(FOLDER, { x: 4, y: 0, z: 4 })
    const second = await instantiatePrefab(FOLDER, { x: 12, y: 0, z: 12 })
    expect(first.rootId).not.toBe(second.rootId)
    expect(namesInScene()).toEqual(['Board', 'Board 2', 'Panel', 'Panel 2'])

    for (const rootId of [first.rootId as string, second.rootId as string]) {
      const result = instanceDrift(h.state.snapshot, rootId, folderComposite(), {
        folder: FOLDER,
        isRuntime: () => false
      })
      expect(result.status).toBe('clean')
    }
  })

  it('treats a name a script still references as taken, even with no entity carrying it', async () => {
    // a reaction that kept the string 'Board' after its target was deleted
    h.state.snapshot['100'] = {
      'asset-packs::Script': {
        value: [
          {
            path: 'src/scripts/reaction.ts',
            priority: 0,
            layout: JSON.stringify({ params: { zone: { type: 'string', value: 'Board' } } })
          }
        ]
      }
    }
    await instantiatePrefab(FOLDER, { x: 4, y: 0, z: 4 })
    expect(namesInScene()).toContain('Board 2')
    expect(namesInScene()).not.toContain('Board')
  })
})
