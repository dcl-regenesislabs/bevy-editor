import { describe, it, expect, vi, beforeEach } from 'vitest'

// The impure half of the registry pass, over a fake data layer: what it refuses
// to write, and who a second caller is actually waiting for.

const disk = new Map<string, string>()
const holds = new Map<string, Promise<void>>()
const attached = vi.fn<(json: string) => void>()
// one listing per pass, so this counts passes
const passes = { count: 0 }

vi.mock('@scene/inspector', () => ({
  writeComponent: async (_id: string, _name: string, json: string) => {
    attached(json)
  }
}))
vi.mock('@scene/state', () => ({ state: { snapshot: {} } }))
vi.mock('../engine/datalayer', () => ({
  dataLayerAvailable: () => true,
  dataLayerListFiles: async () => {
    passes.count++
    return [...disk.keys()].sort()
  },
  dataLayerReadFile: async (path: string) => {
    const hold = holds.get(path)
    if (hold !== undefined) await hold
    const text = disk.get(path)
    if (text === undefined) throw new Error(`no such file ${path}`)
    return text
  },
  dataLayerSaveFile: async (path: string, text: string) => {
    disk.set(path, text)
  }
}))

import { regenerateSpawnables } from './generate'
import { SPAWNABLES_PATH, SPAWNER_COMPONENTS_CONTRACT, SPAWNER_MODULE_PATH } from './codegen'

const ZOMBIE = 'custom/zombie'
const GATED = 'custom/zzz/composite.json'

const composite = (name: string): string =>
  JSON.stringify({
    version: 1,
    components: [
      { name: 'core::Transform', data: { '0': { json: { position: { x: 0, y: 0, z: 0 }, parent: 0 } } } },
      { name: 'core-schema::Name', data: { '0': { json: { value: name } } } }
    ]
  })

function putPrefab(folder: string, name: string, spawnable: boolean): void {
  disk.set(
    `${folder}/data.json`,
    JSON.stringify({
      id: `${name}-uuid`,
      name,
      category: 'custom',
      tags: [],
      ...(spawnable ? { spawnable: { max: 8 } } : {})
    })
  )
  disk.set(`${folder}/composite.json`, composite(name))
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {}
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const host = globalThis as { window?: { editorShell?: unknown } }

beforeEach(() => {
  disk.clear()
  holds.clear()
  passes.count = 0
  attached.mockReset()
  // a shell with no runtimeModuleRead — the web build, and the case where the
  // packaged app's runtime-modules resource did not ship
  host.window = {}
})

describe('a registry that could not be given a runtime', () => {
  // The first line of the generated file is `import … from './runtime/spawner'`.
  // Writing it with nothing to vendor there swaps a working registry for one that
  // fails `sdk-commands build` in code the creator never wrote.
  it('writes nothing and says why when the spawner module cannot be vendored', async () => {
    putPrefab(ZOMBIE, 'Zombie', true)
    const result = await regenerateSpawnables()

    expect(result.blocked).toBe(true)
    expect(result.written).toBe(false)
    expect(result.problems.join(' ')).toContain('spawner runtime module is not in this project')
    expect(disk.has(SPAWNABLES_PATH)).toBe(false)
    expect(attached).not.toHaveBeenCalled()
  })

  it('writes the registry once the module is there', async () => {
    putPrefab(ZOMBIE, 'Zombie', true)
    disk.set(SPAWNER_MODULE_PATH, `export function registerSpawnables(${SPAWNER_COMPONENTS_CONTRACT}): void {}`)

    const result = await regenerateSpawnables()
    expect(result.blocked).toBe(false)
    expect(result.written).toBe(true)
    expect(disk.get(SPAWNABLES_PATH)).toContain('Zombie')
    expect(attached).toHaveBeenCalledTimes(1)
  })
})

describe('coalescing', () => {
  // A pass reads the whole project up front. Handing its result to a caller that
  // wrote AFTER those reads reports success for a registry compiled without the
  // caller's change, with nothing scheduled to correct it.
  it('gives a caller that wrote mid-run a pass that starts after it', async () => {
    disk.set(SPAWNER_MODULE_PATH, `export function registerSpawnables(${SPAWNER_COMPONENTS_CONTRACT}): void {}`)
    putPrefab(ZOMBIE, 'Zombie', false)
    putPrefab('custom/zzz', 'Zzz', false)

    const gate = deferred()
    holds.set(GATED, gate.promise)
    const autosavePass = regenerateSpawnables()
    await Promise.resolve()

    // the Spawnable toggle, while that pass is still reading folders
    putPrefab(ZOMBIE, 'Zombie', true)
    const togglePass = regenerateSpawnables()

    holds.delete(GATED)
    gate.resolve()

    // the run already going never saw the flag, and honestly reports nothing
    expect((await autosavePass).written).toBe(false)
    // the toggle's own call waited for a pass that could
    const toggled = await togglePass
    expect(toggled.written).toBe(true)
    expect(disk.get(SPAWNABLES_PATH)).toContain('Zombie')
  })

  // One trailing pass is enough however many callers pile up: each re-reads the
  // whole project, so the last one to start has seen every write before it.
  it('schedules at most one trailing pass, shared by everyone who asked', async () => {
    disk.set(SPAWNER_MODULE_PATH, `export function registerSpawnables(${SPAWNER_COMPONENTS_CONTRACT}): void {}`)
    putPrefab(ZOMBIE, 'Zombie', true)

    const first = regenerateSpawnables()
    const second = regenerateSpawnables()
    const third = regenerateSpawnables()
    await Promise.all([first, second, third])

    expect(second).toBe(third)
    expect(passes.count).toBe(2)
  })
})
