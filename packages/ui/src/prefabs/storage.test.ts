import { describe, it, expect, vi, beforeEach } from 'vitest'

// Two contracts of the folder writer that only bite outside the editor: the byte
// a creator's git history sees, and whether a captured script still resolves once
// it is sitting in the folder.

const files: string[] = []
const written = new Map<string, string>()
const bytes = new Map<string, Uint8Array>()

vi.mock('../engine/datalayer', () => ({
  dataLayerAvailable: () => true,
  dataLayerListFiles: async () => files,
  dataLayerReadFile: async (path: string) => {
    const text = written.get(path)
    if (text === undefined) throw new Error(`no such file ${path}`)
    return text
  },
  dataLayerReadFileBytes: async (path: string) => {
    const found = bytes.get(path)
    if (found === undefined) throw new Error(`no such file ${path}`)
    return found
  },
  dataLayerRemoveFiles: async () => [],
  dataLayerSaveFile: async (path: string, text: string) => {
    written.set(path, text)
  },
  dataLayerSaveFileBytes: async (path: string, data: Uint8Array) => {
    bytes.set(path, data)
  }
}))
vi.mock('@scene/state', () => ({
  state: { snapshot: {} },
  isRuntimeEntity: () => false,
  provenanceBaseline: () => ({}),
  topLevelSelected: () => []
}))
vi.mock('../gltf-refs', () => ({ gltfExternalUris: () => [] }))

import { pointAtProjectRuntime, writePrefabFolder, renamePrefabFolder } from './storage'
import type { PrefabComposite } from './format'

const COMPOSITE: PrefabComposite = { version: 1, components: [] }

function script(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

beforeEach(() => {
  files.length = 0
  written.clear()
  bytes.clear()
})

describe('prefab folder JSON', () => {
  // Toggling Spawnable writes data.json with a trailing newline; a rename used to
  // write it without one, so alternating the two flipped the last byte of the file
  // in the creator's diff on top of whatever they actually changed.
  it('ends every JSON it writes in a newline, whichever gesture wrote it', async () => {
    const { folder } = await writePrefabFolder({ name: 'Zombie', composite: COMPOSITE, resources: [] })
    expect(written.get(`${folder}/data.json`)?.endsWith('}\n')).toBe(true)
    expect(written.get(`${folder}/composite.json`)?.endsWith('}\n')).toBe(true)

    files.push(`${folder}/data.json`, `${folder}/composite.json`)
    written.set(`${folder}/composite.json`, JSON.stringify(COMPOSITE))
    await renamePrefabFolder(folder, 'Zombie Basic')
    expect(written.get(`${folder}/data.json`)?.endsWith('}\n')).toBe(true)
  })
})

describe('pointAtProjectRuntime', () => {
  it('re-points a runtime import at the project’s shared copy, from the folder’s own depth', () => {
    const text = "import { game } from './runtime/game'\n"
    expect(pointAtProjectRuntime(text, 'custom/zombie/scripts')).toBe(
      "import { game } from '../../../src/scripts/runtime/game'\n"
    )
    expect(pointAtProjectRuntime(text, 'custom/zombie/scripts/pure')).toBe(
      "import { game } from '../../../../src/scripts/runtime/game'\n"
    )
  })

  it('keeps a nested module’s path and the extension the author wrote', () => {
    expect(pointAtProjectRuntime("import { rng } from '../runtime/pure/rng'", 'custom/z/scripts')).toBe(
      "import { rng } from '../../../src/scripts/runtime/pure/rng'"
    )
    expect(pointAtProjectRuntime("import { rng } from './runtime/pure/rng.ts'", 'custom/z/scripts')).toBe(
      "import { rng } from '../../../src/scripts/runtime/pure/rng.ts'"
    )
  })

  it('leaves package and ordinary relative imports exactly as they were', () => {
    const text = "import { engine } from '@dcl/sdk/ecs'\nimport { cfg } from './game-config'\n"
    expect(pointAtProjectRuntime(text, 'custom/zombie/scripts')).toBe(text)
  })
})

// Capture used to copy a script byte-for-byte, so a `./runtime/game` written
// against src/scripts landed in the folder pointing at a directory that is not
// there — a build error in a file the creator never wrote.
describe('a captured script that imports the runtime', () => {
  it('comes out of capture pointing at the project’s shared copy', async () => {
    bytes.set(
      'src/scripts/zombie-brain.ts',
      script("import { game } from './runtime/game'\nexport const brain = game\n")
    )
    const { folder, warnings } = await writePrefabFolder({
      name: 'Zombie',
      composite: COMPOSITE,
      resources: [{ source: 'src/scripts/zombie-brain.ts', rel: 'scripts/zombie-brain.ts' }]
    })

    expect(written.get(`${folder}/scripts/zombie-brain.ts`)).toBe(
      "import { game } from '../../../src/scripts/runtime/game'\nexport const brain = game\n"
    )
    expect(warnings).toEqual([])
  })
})

describe('a captured script that will not resolve in the folder', () => {
  it('warns about a sibling and a generated accessor that stay behind', async () => {
    bytes.set(
      'src/scripts/zombie-brain.ts',
      script(
        [
          "import { engine } from '@dcl/sdk/ecs'",
          "import { gameConfig } from './game-config'",
          "import { outcomes } from '../../custom/wave_director/scripts/runtime/outcomes'"
        ].join('\n')
      )
    )
    const { warnings } = await writePrefabFolder({
      name: 'Zombie',
      composite: COMPOSITE,
      resources: [{ source: 'src/scripts/zombie-brain.ts', rel: 'scripts/zombie-brain.ts' }]
    })
    expect(warnings).toEqual([
      "scripts/zombie-brain.ts imports './game-config', which does not travel with it — a prefab folder has to be self-contained",
      "scripts/zombie-brain.ts imports '../../custom/wave_director/scripts/runtime/outcomes', which does not travel with it — a prefab folder has to be self-contained"
    ])
  })

  it('stays quiet for a script that only imports packages', async () => {
    bytes.set('src/scripts/plain.ts', script("import { engine } from '@dcl/sdk/ecs'"))
    const { warnings } = await writePrefabFolder({
      name: 'Plain',
      composite: COMPOSITE,
      resources: [{ source: 'src/scripts/plain.ts', rel: 'scripts/plain.ts' }]
    })
    expect(warnings).toEqual([])
  })
})
