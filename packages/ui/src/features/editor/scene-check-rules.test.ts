import { describe, it, expect } from 'vitest'
import { defaultGameConfig, normalizeGameConfig, type GameConfigValue } from '../../gameconfig/normalize'
import type { PrefabSnapshot } from '../../prefabs/format'
import { CHECK_IDS } from './scene-check-rules'
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

  it('names the worst wave, verbatim', () => {
    const found = run(context({ snapshot, prefabs: [zombiePrefab], gameConfig: defaultGameConfig() }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('blocker')
    expect(found[0].detail).toBe(
      'Wave 8 spawns 24 ZombieBasic, and Zombie Basic allows 8 alive at once. Raise Max alive on the prefab, or lower the count in Game Config › waves.'
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
    expect(found[0].detail).toContain('Max alive of 8')
  })

  it('says nothing when the referenced prefab is not spawnable at all', () => {
    const plain: SceneCheckPrefab = { ...zombiePrefab, data: data({ id: ZOMBIE_ID, name: 'Zombie Basic' }) }
    expect(run(context({ snapshot, prefabs: [plain] }))).toEqual([])
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
      'Clones always spawn from the prefab, so this edit never reaches them. Compare the two, then save your changes over the prefab or take the prefab’s version back.'
    )
    expect(found[0].fix?.action).toBe('open-drift')
  })

  it('ignores an instance of a prefab that is not spawnable', () => {
    const plain: SceneCheckPrefab = { ...anchored, data: data({ id: RIG_ID, name: 'Player Rig' }) }
    expect(run(context({ snapshot: instance('other.glb'), prefabs: [plain] }))).toEqual([])
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

// --- 6. empty prefab ref ---

describe('empty-prefab-ref', () => {
  const run = check(CHECK_IDS.emptyRef)

  it('nudges an unset PrefabRef param', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('custom/level_slots/scripts/level-slots.ts', { arenas: { type: 'prefab', value: [] } })]
        }
      }
    }
    const found = run(context({ snapshot }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('arenas has no prefab picked')
  })

  it('is quiet once something is picked', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('custom/level_slots/scripts/level-slots.ts', { arenas: { type: 'prefab', value: [ARENA_ID] } })]
        }
      }
    }
    expect(run(context({ snapshot }))).toEqual([])
  })

  it('never fires on a plain string param', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': { value: [scriptRow('src/scripts/x.ts', { board: { type: 'string', value: '' } })] }
      }
    }
    expect(run(context({ snapshot }))).toEqual([])
  })
})

// --- 7. editing only strips the server half ---

describe('editing-only-server-half', () => {
  const run = check(CHECK_IDS.editingOnly)
  const rig: SceneCheckPrefab = {
    folder: 'custom/player_rig',
    data: data({
      id: RIG_ID,
      name: 'Player Rig',
      requiresSdk: 'auth-server',
      spawnable: { max: 32, instancing: 'perPlayer' }
    }),
    composite: composite([transformComponent({ '0': transform() })])
  }

  it('blocks an inert anchor whose prefab has a server half', () => {
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: RIG_ID }, 'inspector::Inert': {}, Transform: transform() }
    }
    const found = run(context({ snapshot, prefabs: [rig] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('blocker')
    expect(found[0].detail).toContain('the half of its script that runs on the server never runs at all')
  })

  it('accepts the same anchor placed for Editor & Play', () => {
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: RIG_ID }, Transform: transform() }
    }
    expect(run(context({ snapshot, prefabs: [rig] }))).toEqual([])
  })

  it('leaves a client-only prefab ghosted in peace', () => {
    const clientOnly: SceneCheckPrefab = { ...rig, data: data({ id: RIG_ID, name: 'Player Rig', spawnable: { max: 4 } }) }
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: RIG_ID }, 'inspector::Inert': {}, Transform: transform() }
    }
    expect(run(context({ snapshot, prefabs: [clientOnly] }))).toEqual([])
  })

  it('finds the server half in the folder’s script text', () => {
    const clientLooking: SceneCheckPrefab = {
      folder: 'custom/player_rig',
      data: data({ id: RIG_ID, name: 'Player Rig', spawnable: { max: 4 } }),
      composite: composite([
        transformComponent({ '0': transform() }),
        scriptComponent('0', [scriptRow('{assetPath}/scripts/player-rig.ts')])
      ])
    }
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: RIG_ID }, 'inspector::Inert': {}, Transform: transform() }
    }
    const scripts = { 'custom/player_rig/scripts/player-rig.ts': 'if (isServer()) armValidators()' }
    expect(run(context({ snapshot, prefabs: [clientLooking], scripts }))).toHaveLength(1)
  })
})

// --- 8. single-owner components on a spawnable ---

describe('spawnable-trigger-area', () => {
  const run = check(CHECK_IDS.triggerArea)

  it('warns that clones share the trigger', () => {
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
    expect(found[0].title).toContain('TriggerArea')
  })

  it('says nothing about a prefab that is not spawnable', () => {
    const zone: SceneCheckPrefab = {
      folder: 'custom/trigger_zone',
      data: data({ id: ARENA_ID, name: 'Trigger Zone' }),
      composite: composite([{ name: 'core::TriggerArea', data: { '0': { json: {} } } }])
    }
    expect(run(context({ prefabs: [zone] }))).toEqual([])
  })
})

describe('unspawnable-prefab-ref', () => {
  const run = check(CHECK_IDS.unspawnableRef)
  const snapshot: PrefabSnapshot = {
    '512': {
      'asset-packs::Script': {
        value: [scriptRow('custom/wave_director/scripts/wave-director.ts', { zombie: { type: 'prefab', value: ZOMBIE_ID } })]
      }
    }
  }

  it('blocks a prefab param pointed at a prefab whose Spawnable is off', () => {
    const plain: SceneCheckPrefab = { ...zombiePrefab, data: data({ id: ZOMBIE_ID, name: 'Zombie Basic' }) }
    const found = run(context({ snapshot, prefabs: [plain] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('blocker')
    expect(found[0].title).toBe('Zombie Basic is not Spawnable')
    expect(found[0].folder).toBe('custom/zombie_basic')
  })

  it('names a ref the project no longer has', () => {
    const found = run(context({ snapshot, prefabs: [] }))
    expect(found).toHaveLength(1)
    expect(found[0].title).toContain('no longer has')
    expect(found[0].detail).toContain('not in this project')
  })

  it('is quiet once the prefab is Spawnable', () => {
    expect(run(context({ snapshot, prefabs: [zombiePrefab] }))).toEqual([])
  })

  it('never fires on an empty ref — that is empty-prefab-ref\u2019s job', () => {
    const empty: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('custom/level_slots/scripts/level-slots.ts', { arenas: { type: 'prefabList', value: [] } })]
        }
      }
    }
    expect(run(context({ snapshot: empty }))).toEqual([])
  })
})

describe('empty-prefab-ref over a list param', () => {
  const run = check(CHECK_IDS.emptyRef)

  it('speaks in the plural for a PrefabRef[] param', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': {
          value: [scriptRow('custom/level_slots/scripts/level-slots.ts', { arenas: { type: 'prefabList', value: [] } })]
        }
      }
    }
    const found = run(context({ snapshot }))
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe('arenas has no prefabs picked')
  })

  it('never shadow-lints a prefab list against a config column', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'asset-packs::Script': { value: [scriptRow('src/scripts/x.ts', { hp: { type: 'prefabList', value: [] } })] }
      }
    }
    expect(check(CHECK_IDS.shadowing)(context({ snapshot, gameConfig: defaultGameConfig() }))).toEqual([])
  })
})
