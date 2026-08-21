import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrefabData } from './format'

// Updating a copied built-in overwrites the whole folder from the master. data.json
// has two owners though — the master's version/name/changelog and the editor's
// `spawnable` — so a plain overwrite un-spawnables the copy and the next
// regeneration drops its alias out of the generated registry.

const FOLDER = 'custom/player_rig'
const ID = 'rig-uuid'

const h = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  written: new Map<string, unknown>(),
  hashed: [] as string[],
  regenerated: 0,
  state: { snapshot: {} as Record<string, Record<string, unknown>>, frozen: true },
  componentWrites: [] as Array<{ id: string; name: string; json: string }>
}))

const master = (): PrefabData => ({
  id: ID,
  name: 'Player Rig',
  category: 'custom',
  tags: [],
  version: '0.2.0'
})

vi.mock('@scene/inspector', () => ({
  writeComponent: async (id: string, name: string, json: string) => {
    h.componentWrites.push({ id, name, json })
  }
}))
vi.mock('@scene/state', () => ({ state: h.state }))
vi.mock('../engine/datalayer', () => ({ dataLayerReadFile: async () => '' }))
vi.mock('../script/parser', () => ({
  getScriptParams: () => ({ params: [], actions: [] }),
  parseLayout: () => undefined,
  mergeLayout: (fresh: unknown) => fresh
}))
vi.mock('./generate', () => ({
  regenerateSpawnables: async () => {
    h.regenerated++
    return {}
  }
}))
vi.mock('./hashes', () => ({
  hashPrefabFolder: async () => ({ 'data.json': 'now' }),
  readOriginHashes: async () => ({ 'data.json': 'then' }),
  writeOriginHashes: async (folder: string) => {
    h.hashed.push(`${folder}:${JSON.stringify(h.data)}`)
  }
}))
vi.mock('./library', () => ({
  listLibrary: async () => [{ scope: 'builtin', ref: 'builtin:player-rig', data: master() }],
  projectDir: () => '/tmp/project'
}))
vi.mock('./storage', () => ({
  listPrefabFolders: async () => [FOLDER],
  readPrefabFolder: async (folder: string) => ({
    folder,
    data: { ...h.data },
    composite: { version: 1, components: [] }
  }),
  writeJsonFile: async (path: string, value: unknown) => {
    h.written.set(path, value)
    if (path === `${FOLDER}/data.json`) h.data = { ...(value as Record<string, unknown>) }
  }
}))

import { updatePrefabCopy } from './update'

const host = globalThis as {
  window?: { editorShell?: { prefabLibraryUpdateCopy?: (ref: string, dir: string) => Promise<string> } }
}

beforeEach(() => {
  h.written.clear()
  h.hashed = []
  h.regenerated = 0
  h.state.snapshot = {}
  h.state.frozen = true
  h.componentWrites = []
  h.data = { ...master(), version: '0.1.0', spawnable: { max: 4, instancing: 'perPlayer' } }
  host.window = {
    editorShell: {
      // main's fs.cpSync: the master's data.json lands whole, editor field and all
      prefabLibraryUpdateCopy: async () => {
        h.data = { ...master() }
        return FOLDER
      }
    }
  }
})

describe('updating a project copy of a built-in', () => {
  it('keeps the Spawnable setting the creator turned on', async () => {
    const result = await updatePrefabCopy(ID, { force: true })

    expect(result.updated).toBe(true)
    expect(h.written.get(`${FOLDER}/data.json`)).toEqual({
      ...master(),
      spawnable: { max: 4, instancing: 'perPlayer' }
    })
    // and the master's own half really did arrive
    expect(h.data.version).toBe('0.2.0')
  })

  // Hashed after the restore on purpose: `spawnable` never conflicts with the
  // master, so a copy carrying it should still read as pristine next time.
  it('stamps the manifest over the restored file, not the bare master', async () => {
    await updatePrefabCopy(ID, { force: true })
    expect(h.hashed).toHaveLength(1)
    expect(h.hashed[0]).toContain('spawnable')
  })

  it('regenerates the registry the folder feeds', async () => {
    await updatePrefabCopy(ID, { force: true })
    expect(h.regenerated).toBe(1)
  })

  it('leaves a plain copy alone and regenerates nothing', async () => {
    h.data = { ...master(), version: '0.1.0' }
    await updatePrefabCopy(ID, { force: true })
    expect(h.written.has(`${FOLDER}/data.json`)).toBe(false)
    expect(h.regenerated).toBe(0)
  })
})

// The re-merge has to reach every entity of a placed instance, not just its
// root: player-rig ships gun-hitscan.ts on a CHILD entity, so a re-merge that
// only reads the marker holder means an updated child script never shows its
// new params on any instance already placed.
describe('re-merging the Script layouts of placed instances', () => {
  const SCRIPT = 'asset-packs::Script'
  const row = (path: string): Record<string, unknown> => ({
    value: [{ path, priority: 0, layout: '' }]
  })

  it('reaches child entities of the instance, and stops at nested instance roots', async () => {
    h.state.snapshot = {
      '512': {
        'inspector::CustomAsset': { assetId: ID },
        [SCRIPT]: row(`${FOLDER}/scripts/player-rig.ts`)
      },
      '514': {
        Transform: { parent: 512 },
        [SCRIPT]: row(`${FOLDER}/scripts/gun-hitscan.ts`)
      },
      '515': { Transform: { parent: 514 }, [SCRIPT]: row(`${FOLDER}/scripts/aim.ts`) },
      '900': {
        Transform: { parent: 512 },
        'inspector::CustomAsset': { assetId: 'someone-else' },
        [SCRIPT]: row('custom/other/scripts/other.ts')
      },
      '901': { Transform: { parent: 0 }, [SCRIPT]: row('src/scripts/free.ts') }
    }

    await updatePrefabCopy(ID, { force: true })

    const merged = h.componentWrites.filter((w) => w.name === SCRIPT).map((w) => w.id)
    expect(merged.sort()).toEqual(['512', '514', '515'])
  })

  it('survives a Transform.parent cycle in a hand-edited scene', async () => {
    h.state.snapshot = {
      '512': { 'inspector::CustomAsset': { assetId: ID }, Transform: { parent: 513 } },
      '513': { Transform: { parent: 512 }, [SCRIPT]: row(`${FOLDER}/scripts/loop.ts`) }
    }
    await updatePrefabCopy(ID, { force: true })
    expect(h.componentWrites.filter((w) => w.name === SCRIPT).map((w) => w.id)).toEqual(['513'])
  })
})
