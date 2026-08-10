import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The impure half of the registry pass, over a fake data layer: what it refuses
// to write, and who a second caller is actually waiting for.

const disk = new Map<string, string>()
const realm = { value: 'realm-a' }
const holds = new Map<string, Promise<void>>()
const attached = vi.fn<(json: string) => void>()
// one listing per pass, so this counts passes
const passes = { count: 0 }

vi.mock('@scene/inspector', () => ({
  writeComponent: async (_id: string, _name: string, json: string) => {
    attached(json)
  },
  setOnSnapshotReady: () => {}
}))
const sceneState = vi.hoisted(() => ({ snapshot: {} as Record<string, Record<string, unknown>> }))
vi.mock('@scene/state', () => ({ state: sceneState }))
vi.mock('../engine/datalayer', () => ({
  dataLayerAvailable: () => true,
  dataLayerRealm: () => realm.value,
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
  dataLayerReadFileBytes: async (path: string) => {
    const text = disk.get(path)
    if (text === undefined) throw new Error(`no such file ${path}`)
    return new TextEncoder().encode(text)
  },
  dataLayerSaveFile: async (path: string, text: string) => {
    disk.set(path, text)
  }
}))

import { ensureScriptRuntime, maybeRefreshVendoredCopies, regenerateSpawnables, resetRuntimeRefreshForTests } from './generate'
import { SPAWNABLES_PATH, SPAWNER_COMPONENTS_CONTRACT, SPAWNER_MODULE_PATH } from './codegen'
import { transitiveModules } from './vendoring'

// A creator script that reaches for the game module, written out rather than
// scaffolded: vendoring is triggered by the import, and the default scaffold
// teaches the isServer() branch and imports nothing from runtime/.
const GAME_SCRIPT = `import { Entity } from '@dcl/sdk/ecs'
import { game } from './runtime/game'

export class ShrineScript {
  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
    game.onReady(() => {})
  }
}
`

const ZOMBIE = 'custom/zombie'
const GATED = 'custom/zzz/composite.json'

// The masters are bundled into this build (prefabs/runtime-masters.ts), so every
// test here reads the same bytes the app vendors. Reading them off disk is how
// the assertions name the expected content without restating it.
const MASTERS = new URL('../../../desktop/runtime-modules/', import.meta.url)

const readMaster = (rel: string): string | null => {
  const file = fileURLToPath(new URL(rel, MASTERS))
  return existsSync(file) ? readFileSync(file, 'utf8') : null
}

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

// `location` is read by the server-presence probe (features/play/server-presence)
// the vendoring pass asks before it puts the game module in; with no `project`
// search param the probe answers `unknown`, which is the state of every test here
// that is not about the module.
const host = globalThis as {
  window?: { editorShell?: unknown; location?: { search: string } }
}

function shell(editorShell?: unknown, search = ''): void {
  host.window = { location: { search }, ...(editorShell === undefined ? {} : { editorShell }) }
}

beforeEach(() => {
  disk.clear()
  holds.clear()
  passes.count = 0
  attached.mockReset()
  // no shell at all — the web build. The masters are bundled into this build, so
  // it vendors exactly what the desktop app does.
  shell()
  realm.value = 'realm-a'
  sceneState.snapshot = {}
  resetRuntimeRefreshForTests()
})

describe('the registry runtime', () => {
  // The first line of the generated file is `import … from './runtime/spawner'`,
  // so the registry can only be written where that module can be. It comes from
  // this build now, which is why there is no case left where it cannot.
  it('vendors the spawner and writes the registry with no shell at all', async () => {
    putPrefab(ZOMBIE, 'Zombie', false)

    const result = await regenerateSpawnables()

    expect(result.blocked).toBe(false)
    expect(result.written).toBe(true)
    expect(result.vendored).toContain(SPAWNER_MODULE_PATH)
    expect(disk.get(SPAWNER_MODULE_PATH)).toContain(SPAWNER_COMPONENTS_CONTRACT)
    expect(disk.get(SPAWNABLES_PATH)).toContain('Zombie')
    expect(attached).toHaveBeenCalledTimes(1)
  })

  it('leaves an up-to-date spawner alone', async () => {
    putPrefab(ZOMBIE, 'Zombie', false)
    disk.set(SPAWNER_MODULE_PATH, readMaster('spawner.ts') as string)

    const result = await regenerateSpawnables()
    expect(result.blocked).toBe(false)
    expect(result.written).toBe(true)
    expect(result.vendored).toEqual([])
    expect(disk.get(SPAWNABLES_PATH)).toContain('Zombie')
    expect(attached).toHaveBeenCalledTimes(1)
  })
})

// Autosave calls back in after every composite write, and the entity-0 attach
// itself dirties the composite — write-if-changed is the only thing standing
// between one placement and an infinite regenerate → attach → autosave loop.
describe('a pass over an unchanged project', () => {
  it('writes nothing the second time — no write amplification', async () => {
    putPrefab(ZOMBIE, 'Zombie', true)

    const first = await regenerateSpawnables()
    expect(first.written).toBe(true)
    expect(first.attached).toBe(true)

    // the engine echoes the entity-0 Script row back into the snapshot
    sceneState.snapshot['0'] = {
      'asset-packs::Script': JSON.parse(attached.mock.calls[0][0]) as Record<string, unknown>
    }
    attached.mockClear()
    const registryBytes = disk.get(SPAWNABLES_PATH)

    const second = await regenerateSpawnables()
    expect(second.written).toBe(false)
    expect(second.attached).toBe(false)
    expect(attached).not.toHaveBeenCalled()
    expect(disk.get(SPAWNABLES_PATH)).toBe(registryBytes)
  })
})

describe('coalescing', () => {
  // A pass reads the whole project up front. Handing its result to a caller that
  // wrote AFTER those reads reports success for a registry compiled without the
  // caller's change, with nothing scheduled to correct it.
  it('gives a caller that wrote mid-run a pass that starts after it', async () => {
    putPrefab(ZOMBIE, 'Zombie', false)
    putPrefab('custom/zzz', 'Zzz', false)
    // seed the registry so the gated pass has nothing new to say
    await regenerateSpawnables()
    const before = disk.get(SPAWNABLES_PATH)
    expect(before).toContain('Zombie')

    const gate = deferred()
    holds.set(GATED, gate.promise)
    const autosavePass = regenerateSpawnables()
    await Promise.resolve()

    // a new prefab lands mid-run — the pass listed the project before it existed
    putPrefab('custom/crate', 'Crate', false)
    const cratePass = regenerateSpawnables()

    holds.delete(GATED)
    gate.resolve()

    // the run already going never saw the new folder, and honestly reports nothing
    expect((await autosavePass).written).toBe(false)
    // the creating caller waited for a pass that could
    const crated = await cratePass
    expect(crated.written).toBe(true)
    expect(disk.get(SPAWNABLES_PATH)).toContain('Crate')
  })

  // One trailing pass is enough however many callers pile up: each re-reads the
  // whole project, so the last one to start has seen every write before it.
  it('schedules at most one trailing pass, shared by everyone who asked', async () => {
    putPrefab(ZOMBIE, 'Zombie', false)

    const first = regenerateSpawnables()
    const second = regenerateSpawnables()
    const third = regenerateSpawnables()
    await Promise.all([first, second, third])

    expect(second).toBe(third)
    expect(passes.count).toBe(2)
  })
})

// The one switch that makes `game` reachable: a script the creator wrote imports
// './runtime/game', and the module — with everything it imports — is on disk
// beside it. Read against the REAL masters, because the closure is the claim: a
// master that grows an import must reach scenes in the same pass, or the creator
// gets a build error inside generated code they never wrote.
describe('the modules a project script imports', () => {
  /** a scene whose installed SDK carries the Multiplayer Server */
  function shellWithServer(): void {
    shell(
      { sdkCapability: async () => ({ authServer: true, installed: true }) },
      '?project=/scenes/arena'
    )
  }

  const vendored = (): string[] =>
    [...disk.keys()].filter((p) => p.startsWith('src/scripts/runtime/')).sort()

  it('vendors game.ts and its whole dependency closure into the scene', async () => {
    disk.set('src/scripts/shrine.ts', GAME_SCRIPT)

    const result = await regenerateSpawnables()

    const closure = transitiveModules("import { game } from './runtime/game'", readMaster)
    expect(closure).toContain('game.ts')
    expect(closure).toContain('pure/gameCore.ts')
    expect(vendored()).toEqual(closure.map((rel) => `src/scripts/runtime/${rel}`))
    expect(result.vendored.sort()).toEqual(vendored())
    // byte-identical to the master, which is what makes an editor-side fix reach
    // the scene through the refresh pass
    for (const rel of closure) expect(disk.get(`src/scripts/runtime/${rel}`)).toBe(readMaster(rel))
  })

  // Nothing in the editor ever types `game.request` for a creator, so a module
  // that arrives only after the import does is a module nobody can autocomplete
  // their way to. On a scene with a Multiplayer Server it goes in unasked.
  it('vendors the game module on a server scene whose scripts never import it', async () => {
    shellWithServer()
    disk.set('src/scripts/spin.ts', "import { engine } from '@dcl/sdk/ecs'\nexport class Spin {}\n")

    const result = await regenerateSpawnables()

    expect(result.vendored).toContain('src/scripts/runtime/game.ts')
    expect(disk.get('src/scripts/runtime/game.ts')).toBe(readMaster('game.ts'))
    // the whole closure, not just the entry — half a module set is a build error
    expect(vendored()).toEqual(
      transitiveModules("import { game } from './runtime/game'", readMaster).map(
        (rel) => `src/scripts/runtime/${rel}`
      )
    )
  })

  it('leaves a scene with no Multiplayer Server alone', async () => {
    shell({ sdkCapability: async () => ({ authServer: false, installed: true }) }, '?project=/scenes/arena')
    disk.set('src/scripts/spin.ts', "import { engine } from '@dcl/sdk/ecs'\nexport class Spin {}\n")

    expect((await regenerateSpawnables()).vendored).toEqual([])
    expect(vendored()).toEqual([])
  })

  it('leaves a scene whose scripts import nothing from runtime/ untouched', async () => {
    disk.set('src/scripts/spin.ts', "import { engine } from '@dcl/sdk/ecs'\nexport class Spin {}\n")

    const result = await regenerateSpawnables()

    expect(result.vendored).toEqual([])
    expect(vendored()).toEqual([])
  })

  it('writes each module once — a second pass has nothing to say', async () => {
    disk.set('src/scripts/shrine.ts', GAME_SCRIPT)

    const first = await regenerateSpawnables()
    expect(first.vendored.length).toBeGreaterThan(1)

    const second = await regenerateSpawnables()
    expect(second.vendored).toEqual([])
  })

  // A placed prefab's scripts live under custom/, climb out to the one shared
  // copy, and are the only consumer in a scene the creator has written no script
  // for. Scanning only src/scripts/ leaves that import pointing at nothing.
  it('vendors the closure a placed prefab script needs, with no creator script at all', async () => {
    putPrefab('custom/leaderboard', 'Leaderboard', false)
    disk.set(
      'custom/leaderboard/scripts/leaderboard.ts',
      "import { game } from '../../../src/scripts/runtime/game'\nexport class Leaderboard {}\n"
    )

    const result = await regenerateSpawnables()

    const closure = transitiveModules("import { game } from './runtime/game'", readMaster)
    expect(closure).toContain('game.ts')
    for (const rel of closure) expect(disk.get(`src/scripts/runtime/${rel}`)).toBe(readMaster(rel))
    expect(result.vendored).toContain('src/scripts/runtime/game.ts')
  })

  // blockedBySdk lets a Multiplayer Server item place into a project whose
  // node_modules are not installed, where the presence probe answers `unknown`.
  // The prefab's own import is what vendors here — nothing may wait on the probe.
  it('vendors for a placed prefab even when the server presence is unknown', async () => {
    shell({ sdkCapability: async () => ({ authServer: false, installed: false }) }, '?project=/scenes/arena')
    putPrefab('custom/server_clock', 'Server Clock', false)
    disk.set(
      'custom/server_clock/scripts/server-clock.ts',
      "import { getServerTime } from '../../../src/scripts/runtime/timeSync'\nexport class Clock {}\n"
    )

    await regenerateSpawnables()

    expect(disk.get('src/scripts/runtime/timeSync.ts')).toBe(readMaster('timeSync.ts'))
    expect(disk.get('src/scripts/runtime/pure/time-math.ts')).toBe(readMaster('pure/time-math.ts'))
  })

  // health-respawn's health.ts is imported BY a Script row rather than being one,
  // so a scan driven by the composite's rows would never read it.
  it('reads a prefab script that no Script row points at', async () => {
    putPrefab('custom/health_respawn', 'Health', false)
    disk.set('custom/health_respawn/scripts/health-respawn.ts', "import { health } from './health'\nexport class HR {}\n")
    disk.set(
      'custom/health_respawn/scripts/health.ts',
      "import { game } from '../../../src/scripts/runtime/game'\nexport const health = game\n"
    )

    await regenerateSpawnables()

    expect(disk.get('src/scripts/runtime/game.ts')).toBe(readMaster('game.ts'))
  })

  // A few rich prefabs placed and the creator's own scripts beside them pass any
  // file count the scan could refuse at. Answering "no modules" there writes no
  // zoneBus.ts under the scaffold that imports it: the scene stops building on a
  // file the editor wrote.
  it('vendors for a project far past any script count a threshold would allow', async () => {
    for (let i = 0; i < 240; i++) disk.set(`custom/filler_${i}/scripts/f.ts`, 'export class F {}\n')
    disk.set('src/scripts/zone-reaction.ts', "import { onZoneEnter } from './runtime/zoneBus'\nexport class Zone {}\n")
    const result = await ensureScriptRuntime()
    expect(result.vendored).toContain('src/scripts/runtime/zoneBus.ts')
    expect(disk.get('src/scripts/runtime/zoneBus.ts')).toBe(readMaster('zoneBus.ts'))
  })

  // Scaffolding a script is not a composite edit and not an open, so nothing
  // else in the app runs a pass — without this the file a creator just made
  // opens with a red `./runtime/game`.
  it('vendors for a script just written, with no pass to ride on', async () => {
    disk.set('src/scripts/my-script.ts', GAME_SCRIPT)

    const written = await ensureScriptRuntime()

    expect(written.vendored).toContain('src/scripts/runtime/game.ts')
    expect(disk.get('src/scripts/runtime/game.ts')).toBe(readMaster('game.ts'))
  })
})

// The shipped tree has generic names — rng.ts, schedule.ts, outcomes.ts,
// pure/normalize.ts. A creator who writes one of those in src/scripts/runtime/
// and imports it must not have it swapped for ours the next time they save.
describe('a creator file standing where a runtime module goes', () => {
  const CREATOR_OWNED = "export const roll = (sides: number): number => 1 + (sides % 6)\n"
  const DICE = "import { roll } from './runtime/rng'\nexport class Dice {}\n"
  const OWNED_PATH = 'src/scripts/runtime/rng.ts'

  it('leaves it exactly as it was instead of overwriting it with the master', async () => {
    disk.set('src/scripts/dice.ts', DICE)
    disk.set(OWNED_PATH, CREATOR_OWNED)

    const result = await ensureScriptRuntime()

    expect(disk.get(OWNED_PATH)).toBe(CREATOR_OWNED)
    expect(result.vendored).not.toContain(OWNED_PATH)
    expect(result.shadowed).toEqual([OWNED_PATH])
  })

  // Every pass but the first runs on entity moves and autosave, so the destruction
  // had no gesture behind it — it happened while the creator dragged something.
  // outcomes.ts is in the SPAWNER's closure, which the registry pass carries and
  // never asked about; both passes reach it here, and a creator who has to move
  // one file reads that sentence once.
  it('stays untouched across a regeneration pass, and says so in problems once', async () => {
    const OWNED = 'src/scripts/runtime/outcomes.ts'
    const MINE = 'export const outcomes = { mine: true }\n'
    putPrefab(ZOMBIE, 'Zombie', true)
    disk.set(OWNED, MINE)
    disk.set('src/scripts/tally.ts', "import { outcomes } from './runtime/outcomes'\nexport class Tally {}\n")

    const result = await regenerateSpawnables()

    expect(disk.get(OWNED)).toBe(MINE)
    expect(result.vendored).not.toContain(OWNED)
    expect(result.problems.filter((p) => p.includes(OWNED))).toEqual([
      `Everything in src/scripts/runtime/ is written by the editor, so your own ${OWNED} blocks the runtime module of that name — move your file into src/scripts and update the imports that point at it.`
    ])
    // the registry is still written: one import the creator can move is not a
    // reason to take every spawnable in the scene down
    expect(result.blocked).toBe(false)
    expect(disk.get(SPAWNABLES_PATH)).toContain('Zombie')
    expect(disk.get(SPAWNER_MODULE_PATH)).toContain(SPAWNER_COMPONENTS_CONTRACT)
  })

  it('still vendors a master over the editor own copy carrying the marker', async () => {
    disk.set('src/scripts/dice.ts', DICE)
    disk.set(OWNED_PATH, '// Generated by Decentraland Studio. Do not edit.\nexport const roll = (): number => 3\n')

    const result = await ensureScriptRuntime()

    expect(disk.get(OWNED_PATH)).toBe(readMaster('rng.ts'))
    expect(result.vendored).toContain(OWNED_PATH)
    expect(result.shadowed).toEqual([])
  })
})

// A creator cannot fix a bug in a vendored runtime module — only the editor can.
describe('refreshing vendored runtime copies from this build', () => {
  const MARK = '// Generated by Decentraland Studio. Do not edit.\n'
  const STALE = `${MARK}export function broken(): void {}\n`
  const MASTER = readMaster('timeSync.ts') as string

  it('rewrites a stale copy in the project’s shared runtime', async () => {
    disk.set('src/scripts/runtime/timeSync.ts', STALE)

    const refreshed = await maybeRefreshVendoredCopies([...disk.keys()])

    expect(refreshed).toEqual(['src/scripts/runtime/timeSync.ts'])
    expect(disk.get('src/scripts/runtime/timeSync.ts')).toBe(MASTER)
  })

  it('leaves identical copies alone and never touches non-runtime files', async () => {
    disk.set('src/scripts/runtime/timeSync.ts', MASTER)
    disk.set('custom/game-flow/scripts/game-flow.ts', STALE)

    const refreshed = await maybeRefreshVendoredCopies([...disk.keys()])

    expect(refreshed).toEqual([])
    expect(disk.get('custom/game-flow/scripts/game-flow.ts')).toBe(STALE)
  })

  it('checks once per realm, again after a project switch', async () => {
    disk.set('src/scripts/runtime/timeSync.ts', STALE)

    await maybeRefreshVendoredCopies([...disk.keys()])
    disk.set('src/scripts/runtime/timeSync.ts', STALE)
    await maybeRefreshVendoredCopies([...disk.keys()])
    expect(disk.get('src/scripts/runtime/timeSync.ts')).toBe(STALE)

    realm.value = 'realm-b'
    await maybeRefreshVendoredCopies([...disk.keys()])
    expect(disk.get('src/scripts/runtime/timeSync.ts')).toBe(MASTER)
  })

  it('never touches a file without the marker, even under a master name', async () => {
    const CREATOR_OWNED = 'export function myOwnRng(): number { return 4 }\n'
    disk.set('src/scripts/runtime/rng.ts', CREATOR_OWNED)

    const refreshed = await maybeRefreshVendoredCopies([...disk.keys()])

    expect(refreshed).toEqual([])
    expect(disk.get('src/scripts/runtime/rng.ts')).toBe(CREATOR_OWNED)
  })

  it('says nothing about a copy this build ships no master for', async () => {
    disk.set('src/scripts/runtime/legacyThing.ts', STALE)
    const refreshed = await maybeRefreshVendoredCopies([...disk.keys()])
    expect(refreshed).toEqual([])
    expect(disk.get('src/scripts/runtime/legacyThing.ts')).toBe(STALE)
  })
})
