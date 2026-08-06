import { describe, expect, it } from 'vitest'
import type { PrefabSnapshot } from '../../prefabs/format'
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
  zombiePrefab
} from './scene-check-fixtures'

const SPAWNER_PATH = 'custom/spawner/scripts/spawner.ts'

it('registers all four rules with the shared registry', () => {
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
    expect(found[0].detail).toContain('Seeded from the server')
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
    const scripts = { [SPAWNER_PATH]: seeded, 'custom/spawner/scripts/runtime/spawnBus.ts': planned }
    expect(run(context({ prefabs: [zombiePrefab], scripts }))).toEqual([])
  })

  it('says nothing about a call whose prefab cannot be resolved', () => {
    const loose = ["import { pool } from './runtime/spawner'", "const p = pool(whatever, 'seeded')"].join('\n')
    expect(run(context({ prefabs: [zombiePrefab], scripts: { [SPAWNER_PATH]: seeded, 'src/a.ts': loose } }))).toEqual([])
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

  it('warns that the copies bring an inert Spawner with them', () => {
    const found = run(context({ snapshot, prefabs: [crateWithSpawner] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('Crate has a Spawner inside it')
    expect(found[0].detail).toContain('never starts')
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
