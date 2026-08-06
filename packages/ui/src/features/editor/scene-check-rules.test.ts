import { describe, it, expect } from 'vitest'
import { defaultGameConfig, normalizeGameConfig, type GameConfigValue } from '../../gameconfig/normalize'
import type { PrefabSnapshot } from '../../prefabs/format'
import { CREATE_SPAWNABLE_GESTURE } from '../../prefabs/copy'
import { BUILTIN_SCENE_CHECKS, CHECK_IDS } from './scene-check-rules'
import type { SceneCheckPrefab } from './scene-checks'
import {
  ARENA_ID,
  RIG_ID,
  ZOMBIE_ID,
  arenaPrefab,
  check,
  composite,
  context,
  data,
  scriptComponent,
  scriptRow,
  transform,
  transformComponent,
  zombiePrefab
} from './scene-check-fixtures'
// --- 1. wave count vs pool max ---

describe('wave-count-vs-pool-max', () => {
  const run = check(CHECK_IDS.waveCount)
  const snapshot: PrefabSnapshot = {
    '512': {
      'asset-packs::Script': {
        value: [
          scriptRow('custom/wave_director/scripts/wave-director.ts', {
            zombie: { type: 'prefab', value: ZOMBIE_ID },
            wavesTable: { type: 'string', value: 'waves' }
          })
        ]
      }
    }
  }

  // The create flow writes no spawn settings, so a check that waited for them
  // would never fire on the creator's own prefab — the cap has a default.
  // The create flow writes no spawn settings, so a check that waited for them
  // would never fire on the creator's own prefab — every prefab has a cap, and
  // an absent one is the default.
  it('still checks a prefab that never had spawn settings, using the default cap', () => {
    const plain: SceneCheckPrefab = { ...zombiePrefab, data: data({ id: ZOMBIE_ID, name: 'Zombie Basic' }) }
    const found = run(context({ snapshot, prefabs: [plain] }))
    expect(found).toHaveLength(1)
    expect(found[0].detail).toContain('64')
  })

  it('names the worst wave, verbatim', () => {
    const found = run(context({ snapshot, prefabs: [zombiePrefab], gameConfig: defaultGameConfig() }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('blocker')
    expect(found[0].detail).toBe(
      'Wave 8 spawns 24 ZombieBasic, and Zombie Basic allows 8 alive at once. Lower the count in Game Config › waves.'
    )
    expect(found[0].folder).toBe('custom/zombie_basic')
  })

  it('passes when the pool is big enough', () => {
    const roomy: SceneCheckPrefab = { ...zombiePrefab, data: data({ id: ZOMBIE_ID, name: 'Zombie Basic', spawnable: { max: 64 } }) }
    expect(run(context({ snapshot, prefabs: [roomy], gameConfig: defaultGameConfig() }))).toEqual([])
  })

  it('warns rather than passing in silence when the table it reads does not exist', () => {
    const found = run(context({ snapshot, prefabs: [zombiePrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].detail).toContain('runs its own built-in curve')
    expect(found[0].detail).toContain('the 8 copies')
  })

})

// --- 2. config shadowing ---

describe('config-shadowing', () => {
  const run = check(CHECK_IDS.shadowing)

  it('quotes the accessor the value already has', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('src/scripts/zombie-brain.ts', { hp: { type: 'number', value: 40 } })]
        }
      }
    }
    const found = run(context({ snapshot, gameConfig: defaultGameConfig() }))
    expect(found).toHaveLength(1)
    expect(found[0].detail).toBe(
      '`hp` is also set in Game Config › zombie. Rename the Game Config › zombie row, or remove the `hp` param from zombie-brain.ts and read the value through `gameConfig.zombie.hp` — otherwise the two copies drift apart and the game uses whichever it reaches first.'
    )
    // the remedy needs a way to get there: a scene row focuses the entity
    expect(found[0].fix).toEqual({ label: 'Select entity', action: 'select-entity' })
  })

  it('leaves wiring params alone', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('src/scripts/x.ts', { hp: { type: 'entity', value: 512 } })]
        }
      }
    }
    expect(run(context({ snapshot, gameConfig: defaultGameConfig() }))).toEqual([])
  })

  it('lints an unplaced prefab folder too', () => {
    const prefab: SceneCheckPrefab = {
      folder: 'custom/zombie_basic',
      data: zombiePrefab.data,
      composite: composite([
        scriptComponent('0', [scriptRow('{assetPath}/scripts/zombie-brain.ts', { biteDamage: { type: 'number', value: 8 } })])
      ])
    }
    const found = run(context({ prefabs: [prefab], gameConfig: defaultGameConfig() }))
    expect(found).toHaveLength(1)
    expect(found[0].folder).toBe('custom/zombie_basic')
  })

  it('reports a top-level value without a table name', () => {
    const config: GameConfigValue = normalizeGameConfig({
      version: 1,
      tables: [],
      values: [{ name: 'WINNER_POINTS', kind: 'number', value: '100' }]
    })
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('src/scripts/x.ts', { WINNER_POINTS: { type: 'number', value: 10 } })]
        }
      }
    }
    const found = run(context({ snapshot, gameConfig: config }))
    expect(found[0].detail).toContain('is also set in Game Config. Rename the Game Config row, or remove the `WINNER_POINTS` param')
    expect(found[0].detail).toContain('read the value through `gameConfig.WINNER_POINTS`')
  })
})

// --- 3. stale anchor ---

describe('stale-anchor', () => {
  const run = check(CHECK_IDS.staleAnchor)
  // a single-entity prefab carries no root Transform: the drop position supplies
  // it, so the model is what a real drift shows up in
  const anchored: SceneCheckPrefab = {
    folder: 'custom/player_rig',
    data: data({ id: RIG_ID, name: 'Player Rig', spawnable: { max: 32, instancing: 'perPlayer' } }),
    composite: composite([
      { name: 'core::GltfContainer', data: { '0': { json: { src: '{assetPath}/models/rig.glb' } } } }
    ])
  }
  const instance = (model: string): PrefabSnapshot => ({
    '512': {
      'inspector::CustomAsset': { assetId: RIG_ID },
      Transform: transform(),
      GltfContainer: { src: `custom/player_rig/models/${model}` }
    }
  })

  it('is quiet while the anchor matches', () => {
    expect(run(context({ snapshot: instance('rig.glb'), prefabs: [anchored] }))).toEqual([])
  })

  it('blocks Play once the anchor drifts', () => {
    const found = run(context({ snapshot: instance('other.glb'), prefabs: [anchored] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('play-blocker')
    expect(found[0].detail).toBe(
      'The copies your game makes always come from the prefab, so this edit never reaches them. Compare the two, then save your changes into the prefab or take the prefab’s version back.'
    )
    expect(found[0].fix?.action).toBe('open-drift')
  })

})

// --- 4. server pool over a multi-entity prefab ---


describe('server-pool-multi-entity', () => {
  const run = check(CHECK_IDS.serverPool)
  const snapshot: PrefabSnapshot = {
    '512': {
      'asset-packs::Script': {
        value: [
          scriptRow('custom/level_slots/scripts/level-slots.ts', { arenas: { type: 'prefab', value: [ARENA_ID] } })
        ]
      }
    }
  }
  const scripts = {
    'custom/level_slots/scripts/level-slots.ts': [
      "import { pool as openPool } from './runtime/spawner'",
      "const p = openPool(this.arenas, 'server')"
    ].join('\n')
  }

  it('states the v1 limit verbatim', () => {
    const found = run(context({ snapshot, scripts, prefabs: [arenaPrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('blocker')
    expect(found[0].detail).toContain('the server can only own a prefab made of one entity')
  })

  it('allows a single-entity prefab', () => {
    const single: SceneCheckPrefab = { ...arenaPrefab, composite: composite([transformComponent({ '0': transform() })]) }
    expect(run(context({ snapshot, scripts, prefabs: [single] }))).toEqual([])
  })

  it('says nothing about a seeded pool', () => {
    const seeded = {
      'custom/level_slots/scripts/level-slots.ts': [
        "import { pool as openPool } from './runtime/spawner'",
        "const p = openPool(this.arenas, 'seeded')"
      ].join('\n')
    }
    expect(run(context({ snapshot, scripts: seeded, prefabs: [arenaPrefab] }))).toEqual([])
  })
})

// --- 5. bespoke script on an instance ---

describe('bespoke-script-on-kit-instance', () => {
  const run = check(CHECK_IDS.bespokeScript)

  it('warns about a script the folder does not carry', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'inspector::CustomAsset': { assetId: ZOMBIE_ID },
        Transform: transform(),
        'asset-packs::Script': { value: [scriptRow('src/scripts/gun-hitscan.ts')] }
      }
    }
    const found = run(context({ snapshot, prefabs: [zombiePrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].detail).toBe(
      'This script is not part of the prefab — Update from prefab will remove it. Attach it to a plain entity, or Save over prefab to adopt it.'
    )
    expect(found[0].entityId).toBe('512')
  })

  it('accepts the folder’s own script on the instance', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'inspector::CustomAsset': { assetId: ZOMBIE_ID },
        Transform: transform(),
        'asset-packs::Script': { value: [scriptRow('custom/zombie_basic/scripts/zombie-brain.ts')] }
      }
    }
    expect(run(context({ snapshot, prefabs: [zombiePrefab] }))).toEqual([])
  })

  // What keeps the right-click Spawner gesture clean is the instance MARK: the
  // Spawner root carries `inspector::CustomAsset`, which puts it in the parent's
  // stopAt set. It is emphatically not that the Spawner attaches no script — it
  // attaches one. Lose the mark and the parent gets blamed for it.
  it('leaves a marked Spawner under a kit instance alone, and blames it without the mark', () => {
    const spawnerPrefab: SceneCheckPrefab = {
      folder: 'custom/spawner',
      data: data({ id: RIG_ID, name: 'Spawner' }),
      composite: composite([
        transformComponent({ '0': transform() }),
        scriptComponent('0', [scriptRow('{assetPath}/scripts/spawner.ts')])
      ])
    }
    const spawnerRow = {
      Transform: { ...transform(), parent: 512 },
      'asset-packs::Script': { value: [scriptRow('custom/spawner/scripts/spawner.ts')] }
    }
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: ZOMBIE_ID }, Transform: transform() },
      '513': { 'inspector::CustomAsset': { assetId: RIG_ID }, ...spawnerRow }
    }
    expect(run(context({ snapshot, prefabs: [zombiePrefab, spawnerPrefab] }))).toEqual([])

    const unmarked: PrefabSnapshot = { ...snapshot, '513': spawnerRow }
    const found = run(context({ snapshot: unmarked, prefabs: [zombiePrefab, spawnerPrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].folder).toBe('custom/zombie_basic')
    expect(found[0].entityId).toBe('513')
  })

  it('blames the nested instance for its own script', () => {
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: ZOMBIE_ID }, Transform: transform() },
      '513': {
        'inspector::CustomAsset': { assetId: ARENA_ID },
        Transform: { ...transform(), parent: 512 },
        'asset-packs::Script': { value: [scriptRow('src/scripts/other.ts')] }
      }
    }
    const found = run(context({ snapshot, prefabs: [zombiePrefab, arenaPrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].folder).toBe('custom/arena_graveyard')
  })
})

// --- 6. editing only strips the server half ---

describe('spawnable-trigger-area', () => {
  const run = check(CHECK_IDS.triggerArea)

  it('warns that copies share the trigger, in the words the rest of the editor uses', () => {
    const zone: SceneCheckPrefab = {
      folder: 'custom/trigger_zone',
      data: data({ id: ARENA_ID, name: 'Trigger Zone', spawnable: { max: 4 } }),
      composite: composite([
        transformComponent({ '0': transform() }),
        { name: 'core::TriggerArea', data: { '0': { json: {} } } }
      ])
    }
    const found = run(context({ prefabs: [zone] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toContain('trigger area')
    expect(`${found[0].title} ${found[0].detail}`).not.toContain('clone')
  })

})
