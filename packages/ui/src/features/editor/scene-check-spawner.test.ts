import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isRecord, type PrefabSnapshot } from '../../prefabs/format'
import { PREFABS_ROOT, filesUnder, prefabFolders } from '../../prefabs/builtin-fixtures'
import { SPAWNER_CHECK_IDS, spawnerChecks } from './scene-check-spawner'
import { BUILTIN_SCENE_CHECKS } from './scene-check-rules'
import type { SceneCheckPrefab } from './scene-checks'
import {
  ARENA_ID,
  ZOMBIE_ID,
  check,
  composite,
  context,
  data,
  entityScripts,
  scriptComponent,
  scriptRow,
  transform,
  transformComponent,
  arenaPrefab,
  zombiePrefab
} from './scene-check-fixtures'

const SPAWNER_PATH = 'custom/spawner/scripts/spawner.ts'

// The two bodies of code the editor itself produces: the prefabs it ships and
// the walkthrough's own scene. A rule that fires on either fires on a project
// nobody wired wrong — which is how the rule this file's overrun check replaces
// came to be deleted.
const TOWER_ROOT = new URL('../../../../desktop/validate/fixtures/tower-of-madness/', import.meta.url)

function readAt(dir: URL, prefix: string, into: Record<string, string>): void {
  for (const rel of filesUnder(dir)) {
    if (!/\.tsx?$/.test(rel)) continue
    into[`${prefix}${rel}`] = readFileSync(new URL(rel, dir), 'utf8')
  }
}

function shippedScripts(): Record<string, string> {
  const scripts: Record<string, string> = {}
  for (const folder of prefabFolders()) {
    const dir = new URL(`${folder}/scripts/`, PREFABS_ROOT)
    if (existsSync(dir)) readAt(dir, `custom/${folder}/scripts/`, scripts)
  }
  readAt(new URL('scripts/', TOWER_ROOT), 'src/scripts/', scripts)
  return scripts
}

interface TowerChunk {
  id: string
  name: string
}

function towerChunks(): TowerChunk[] {
  const parsed: unknown = JSON.parse(readFileSync(new URL('prefabs.json', TOWER_ROOT), 'utf8'))
  const chunks = isRecord(parsed) && isRecord(parsed.chunks) ? parsed.chunks : {}
  const entries = [...(Array.isArray(chunks.middle) ? (chunks.middle as unknown[]) : []), chunks.end]
  const out: TowerChunk[] = []
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
    out.push({ id: entry.id, name: entry.name })
  }
  return out
}

it('registers all five rules with the shared registry', () => {
  const registered = BUILTIN_SCENE_CHECKS.filter(([, rule]) => spawnerChecks.includes(rule))
  expect(registered.map(([id]) => id)).toEqual(Object.values(SPAWNER_CHECK_IDS))
})

// --- mixed-pool-authority ---

describe('mixed-pool-authority', () => {
  const run = check(SPAWNER_CHECK_IDS.mixedPool)

  // the alias form the shipped Spawner script uses
  const seeded = [
    "import { pool as openPool, type Pool } from './runtime/spawner'",
    `const p = openPool('${ZOMBIE_ID}', 'seeded')`
  ].join('\n')
  const planned = [
    "import { plan } from './runtime/spawner'",
    'const p = plan(Spawnables.ZombieBasic, planFn, { outcomes: [`hit`] })'
  ].join('\n')

  it('blocks when a Spawner and a Wave Director claim the same enemy', () => {
    const found = run(
      context({
        prefabs: [zombiePrefab],
        scripts: { [SPAWNER_PATH]: seeded, 'custom/wave_director/scripts/wave-director.ts': planned }
      })
    )
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('blocker')
    expect(found[0].title).toBe('Zombie Basic is spawned two different ways')
    expect(found[0].detail).toContain('spawner.ts')
    expect(found[0].detail).toContain('wave-director.ts')
    expect(found[0].detail).toContain('Spawned per player')
    expect(found[0].detail).toContain('Planned spawns')
    expect(found[0].folder).toBe('custom/zombie_basic')
  })

  it('says nothing when two scripts agree', () => {
    const other = ["import { pool } from './runtime/spawner'", `const q = pool('${ZOMBIE_ID}', 'seeded')`].join('\n')
    expect(run(context({ prefabs: [zombiePrefab], scripts: { [SPAWNER_PATH]: seeded, 'src/scripts/x.ts': other } }))).toEqual([])
  })

  // A pool opened inside a carried module belongs to the machinery, not to a
  // prefab the creator picked — crediting it would light this on every scene.
  it('ignores the carried runtime modules', () => {
    const scripts = { [SPAWNER_PATH]: seeded, 'custom/spawner/scripts/runtime/spawnPoints.ts': planned }
    expect(run(context({ prefabs: [zombiePrefab], scripts }))).toEqual([])
  })

  it('says nothing about a call whose prefab cannot be resolved', () => {
    const loose = ["import { pool } from './runtime/spawner'", "const p = pool(whatever, 'seeded')"].join('\n')
    expect(run(context({ prefabs: [zombiePrefab], scripts: { [SPAWNER_PATH]: seeded, 'src/a.ts': loose } }))).toEqual([])
  })

  // `game.layout` opens a pool through the game module, which the spawner-module
  // scan never sees — the pool it opens is as much an authority as any other.
  describe('a prefab a round lays out', () => {
    const layout = [
      "import { game } from '~runtime/game'",
      `game.layout('${ZOMBIE_ID}', (_rng, round) => [{ x: 8, y: 0, z: 8 }])`
    ].join('\n')

    it('blocks when a script plans what a round lays out, naming both authorities', () => {
      const found = run(
        context({ prefabs: [zombiePrefab], scripts: { 'src/scripts/tower.ts': layout, 'src/scripts/waves.ts': planned } })
      )
      expect(found).toHaveLength(1)
      expect(found[0].level).toBe('blocker')
      expect(found[0].detail).toContain('Same for every player')
      expect(found[0].detail).toContain('Planned spawns')
      expect(found[0].detail).toContain('whichever starts second stops with an error')
    })

    // Both open a SEEDED pool, so nothing throws — they get one set of copies
    // between them, and the round's rebuild empties it.
    it('blocks when a Spawner and a round share one prefab, and says what that costs', () => {
      const found = run(
        context({ prefabs: [zombiePrefab], scripts: { [SPAWNER_PATH]: seeded, 'src/scripts/tower.ts': layout } })
      )
      expect(found).toHaveLength(1)
      expect(found[0].detail).toBe(
        'tower.ts lays ZombieBasic out for the round and spawner.ts spawns it as “Spawned per player”. They share one set of copies, so every new round clears the ones it made. Give each one its own prefab.'
      )
    })

    it('says nothing about a round that lays out a prefab nothing else touches', () => {
      expect(run(context({ prefabs: [zombiePrefab], scripts: { 'src/scripts/tower.ts': layout } }))).toEqual([])
    })

    // Three claims, only one of which disagrees: layout and the Spawner share a
    // pool, the planner is the odd one out. Naming the first two by position
    // would report the pair that does NOT throw and say it does.
    it('names the two that disagree, not the two that happen to come first', () => {
      const found = run(
        context({
          prefabs: [zombiePrefab],
          scripts: {
            'src/scripts/tower.ts': layout,
            [SPAWNER_PATH]: seeded,
            'src/scripts/waves.ts': planned
          }
        })
      )
      expect(found).toHaveLength(1)
      expect(found[0].detail).toContain('waves.ts')
      expect(found[0].detail).toContain('Planned spawns')
      expect(found[0].detail).toContain('whichever starts second stops with an error')
    })

    // A blocker must not be an inference: guarantees.ts credits a ref it cannot
    // follow to its script's own prefab params for a chip, and that guess is
    // exactly what must not stop Play.
    it('says nothing about a layout whose prefab the scan cannot follow', () => {
      const loop = [
        "import { game } from '~runtime/game'",
        'for (const chunk of this.chunks) game.layout(chunk, plan)'
      ].join('\n')
      const scripts = { [SPAWNER_PATH]: seeded, 'src/scripts/tower.ts': loop }
      expect(run(context({ prefabs: [zombiePrefab], scripts }))).toEqual([])
    })
  })
})

// --- the shipped kit and the walkthrough, as a false-positive floor ---

describe('the code the editor itself produces', () => {
  const chunks = towerChunks()
  const prefabs: SceneCheckPrefab[] = chunks.map((chunk, i) => ({
    folder: `custom/chunk_${i}`,
    data: data({ id: chunk.id, name: chunk.name, spawnable: { max: 8 } }),
    composite: composite([transformComponent({ '0': transform() })])
  }))

  // The walkthrough's scene: the Tower runs tower-builder.ts with its ten middle
  // chunks and its cap picked, and a Spawner sits beside it aimed at the crate.
  const snapshot: PrefabSnapshot = {
    '600': entityScripts([
      scriptRow('src/scripts/tower-builder.ts', {
        chunks: { type: 'prefabList', value: chunks.slice(0, -1).map((chunk) => chunk.id) },
        endChunk: { type: 'prefab', value: chunks[chunks.length - 1].id }
      })
    ]),
    '601': {
      'core-schema::Name': { value: 'Crate Spawner' },
      ...entityScripts([
        scriptRow(SPAWNER_PATH, {
          spawn: { type: 'prefab', value: ZOMBIE_ID },
          atMostAtOnce: { type: 'number', value: 4 }
        })
      ])
    }
  }

  const ctx = context({ snapshot, prefabs: [...prefabs, zombiePrefab], scripts: shippedScripts() })

  it('reads every script the kit ships and the walkthrough writes', () => {
    expect(Object.keys(ctx.scripts)).toContain(`custom/spawner/scripts/spawner.ts`)
    expect(Object.keys(ctx.scripts)).toContain('src/scripts/tower-builder.ts')
    expect(chunks).toHaveLength(11)
  })

  it('says nothing about a prefab a round lays out and nothing else claims', () => {
    expect(check(SPAWNER_CHECK_IDS.mixedPool)(ctx)).toEqual([])
  })

  it('says nothing about the Spawner the walkthrough places', () => {
    expect(check(SPAWNER_CHECK_IDS.poolOverrun)(ctx)).toEqual([])
  })

  // Silence is only worth something if the scan can see the calls at all: the
  // walkthrough's own `game.layout(this.endChunk, …)` is a claim, and a second
  // authority over that chunk has to raise the blocker.
  it('does see the walkthrough’s own game.layout call', () => {
    const cap = chunks[chunks.length - 1]
    const rival = ["import { plan } from '~runtime/spawner'", `plan('${cap.id}', planFn, { outcomes: [] })`].join('\n')
    const found = check(SPAWNER_CHECK_IDS.mixedPool)(
      context({ ...ctx, scripts: { ...ctx.scripts, 'src/scripts/waves.ts': rival } })
    )
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe(`${cap.name} is spawned two different ways`)
    expect(found[0].detail).toContain('Same for every player')
  })
})

// --- spawner-click-no-collider ---

describe('spawner-click-no-collider', () => {
  const run = check(SPAWNER_CHECK_IDS.clickTarget)

  function scene(parent: Record<string, unknown> | null, when = 'when clicked'): PrefabSnapshot {
    const snapshot: PrefabSnapshot = {
      '600': {
        'core-schema::Name': { value: 'Crate Spawner' },
        Transform: parent === null ? {} : { parent: 700 },
        ...entityScripts([scriptRow(SPAWNER_PATH, { when: { type: 'enum', value: when } })])
      }
    }
    if (parent !== null) snapshot['700'] = { 'core-schema::Name': { value: 'Lever' }, Transform: {}, ...parent }
    return snapshot
  }

  it('warns when the thing the spawner sits on has nothing for a click to land on', () => {
    const found = run(context({ snapshot: scene({ MeshRenderer: {} }) }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('Lever cannot be clicked')
    expect(found[0].detail).toContain('clicks pass straight through')
    expect(found[0].detail).toContain('collider')
    expect(found[0].entityId).toBe('600')
  })

  it('accepts a mesh collider, and a model with collision on', () => {
    expect(run(context({ snapshot: scene({ MeshCollider: {} }) }))).toEqual([])
    expect(run(context({ snapshot: scene({ GltfContainer: { src: 'assets/lever.glb' } }) }))).toEqual([])
  })

  it('still warns about a model whose collision is turned all the way off', () => {
    const gltf = { GltfContainer: { src: 'assets/lever.glb', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 } }
    expect(run(context({ snapshot: scene(gltf) }))).toHaveLength(1)
  })

  it('leaves a spawner standing alone to be its own button', () => {
    expect(run(context({ snapshot: scene(null) }))).toEqual([])
  })

  it('leaves the other triggers alone', () => {
    expect(run(context({ snapshot: scene({ MeshRenderer: {} }, 'every few seconds') }))).toEqual([])
  })
})

describe('spawner-nothing-picked', () => {
  const run = check(SPAWNER_CHECK_IDS.nothingPicked)

  function scene(spawn: string): PrefabSnapshot {
    return {
      '600': {
        'core-schema::Name': { value: 'Crate Spawner' },
        ...entityScripts([
          scriptRow(SPAWNER_PATH, { spawn: { type: 'prefab', value: spawn }, when: { type: 'enum', value: 'when clicked' } })
        ])
      }
    }
  }

  it('warns when nothing is picked to spawn', () => {
    const found = run(context({ snapshot: scene('') }))
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe('Crate Spawner has nothing to spawn')
    expect(found[0].detail).toContain('Pick a prefab')
  })

  it('is quiet once a prefab is picked', () => {
    expect(run(context({ snapshot: scene('bed-1') }))).toEqual([])
  })
})

// --- spawner-pool-overrun ---

describe('spawner-pool-overrun', () => {
  const run = check(SPAWNER_CHECK_IDS.poolOverrun)

  function spawner(name: string, prefabId: string, atMostAtOnce?: number): PrefabSnapshot[string] {
    const params: Record<string, { type: string; value: unknown }> = {
      spawn: { type: 'prefab', value: prefabId },
      when: { type: 'enum', value: 'when clicked' }
    }
    if (atMostAtOnce !== undefined) params.atMostAtOnce = { type: 'number', value: atMostAtOnce }
    return { 'core-schema::Name': { value: name }, ...entityScripts([scriptRow(SPAWNER_PATH, params)]) }
  }

  it('names the two numbers and the setting that closes the gap', () => {
    const snapshot: PrefabSnapshot = { '600': spawner('Crate Spawner', ZOMBIE_ID, 30) }
    const found = run(context({ snapshot, prefabs: [zombiePrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('Zombie Basic is asked for more copies than can be alive')
    expect(found[0].detail).toBe(
      'Crate Spawner asks for 30 copies of Zombie Basic, and only 8 can be alive at once — the 22 past that never appear. Lower “At Most At Once” to 8 in the Script card.'
    )
    expect(found[0].entityId).toBe('600')
    expect(found[0].fix).toEqual({ label: 'Select entity', action: 'select-entity' })
  })

  // Every Spawner aimed at a prefab draws from the same pool, so what has to fit
  // is the sum — the spawner guide states the requirement that way.
  it('adds up the spawners aimed at one prefab, since they share its pool', () => {
    const snapshot: PrefabSnapshot = { '600': spawner('Crate A', ARENA_ID, 2), '601': spawner('Crate B', ARENA_ID, 3) }
    const found = run(context({ snapshot, prefabs: [zombiePrefab, arenaPrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].detail).toBe(
      'Crate A and Crate B ask for 5 copies of Arena Graveyard between them, and only 2 can be alive at once — the 3 past that never appear. Lower “At Most At Once” in the Script card until the spawners add up to 2.'
    )
    expect(found[0].entityId).toBeUndefined()
    expect(found[0].fix).toEqual({ label: 'Show prefab', action: 'reveal-prefab' })
  })

  it('is quiet at the ceiling, and quiet at the Spawner’s own default', () => {
    expect(run(context({ snapshot: { '600': spawner('A', ZOMBIE_ID, 8) }, prefabs: [zombiePrefab] }))).toEqual([])
    expect(run(context({ snapshot: { '600': spawner('A', ZOMBIE_ID) }, prefabs: [zombiePrefab] }))).toEqual([])
  })

  it('says nothing about a prefab this project no longer has', () => {
    const snapshot: PrefabSnapshot = { '600': spawner('A', 'gone-1', 99) }
    expect(run(context({ snapshot, prefabs: [zombiePrefab] }))).toEqual([])
  })

  // The rule this replaces matched any param whose name ended in "table", which
  // is how it came to block Play on scripts that had never heard of a wave.
  it('reads only the Spawner’s own row, never a number on somebody else’s script', () => {
    const snapshot: PrefabSnapshot = {
      '600': entityScripts([
        scriptRow('src/scripts/waves.ts', {
          spawn: { type: 'prefab', value: ZOMBIE_ID },
          atMostAtOnce: { type: 'number', value: 30 },
          wavesTable: { type: 'string', value: 'waves' }
        })
      ])
    }
    expect(run(context({ snapshot, prefabs: [zombiePrefab] }))).toEqual([])
  })
})

// --- spawner-nested-spawn ---

describe('spawner-nested-spawn', () => {
  const run = check(SPAWNER_CHECK_IDS.nestedSpawn)

  const crateWithSpawner: SceneCheckPrefab = {
    folder: 'custom/crate',
    data: data({ id: ARENA_ID, name: 'Crate' }),
    composite: composite([
      transformComponent({ '0': transform() }),
      scriptComponent('0', [scriptRow('{assetPath}/scripts/spawner.ts')])
    ])
  }

  const snapshot: PrefabSnapshot = {
    '600': {
      'core-schema::Name': { value: 'Crate Spawner' },
      ...entityScripts([scriptRow(SPAWNER_PATH, { spawn: { type: 'prefab', value: ARENA_ID } })])
    }
  }

  it('warns that every copy brings its own Spawner along', () => {
    const found = run(context({ snapshot, prefabs: [crateWithSpawner] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('Crate has a Spawner inside it')
    expect(found[0].detail).toContain('copies making more copies')
    expect(found[0].folder).toBe('custom/crate')
  })

  it('says nothing about a prefab that carries no Spawner', () => {
    const plain: SceneCheckPrefab = { ...crateWithSpawner, composite: composite([transformComponent({ '0': transform() })]) }
    expect(run(context({ snapshot, prefabs: [plain] }))).toEqual([])
  })

  it('says nothing when the setting points at nothing', () => {
    const empty: PrefabSnapshot = {
      '600': { ...entityScripts([scriptRow(SPAWNER_PATH, { spawn: { type: 'prefab', value: '' } })]) }
    }
    expect(run(context({ snapshot: empty, prefabs: [crateWithSpawner] }))).toEqual([])
  })

  it('reports one finding per Spawner, not one per pass', () => {
    const twice: PrefabSnapshot = {
      ...snapshot,
      '601': {
        'core-schema::Name': { value: 'Crate Spawner 2' },
        ...entityScripts([scriptRow(SPAWNER_PATH, { spawn: { type: 'prefab', value: ARENA_ID } })])
      }
    }
    expect(run(context({ snapshot: twice, prefabs: [crateWithSpawner] }))).toHaveLength(2)
  })
})
