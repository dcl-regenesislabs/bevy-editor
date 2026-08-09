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

// --- 1. config shadowing ---

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

// There is deliberately no stale-anchor rule: a copy differing from its prefab
// is never surfaced automatically. The right-click drift verbs are the surface.

// --- 2. server pool over a multi-entity prefab ---

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

// --- 3. bespoke script on an instance ---

describe('bespoke-script-on-kit-instance', () => {
  const run = check(CHECK_IDS.bespokeScript)

  it('warns about a script the folder does not carry on a CHILD — root extras survive the update', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'inspector::CustomAsset': { assetId: ZOMBIE_ID },
        Transform: transform()
      },
      '513': {
        Transform: { ...transform(), parent: 512 },
        'asset-packs::Script': { value: [scriptRow('src/scripts/gun-hitscan.ts')] }
      }
    }
    const found = run(context({ snapshot, prefabs: [zombiePrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].detail).toBe(
      'This script is not part of the prefab — Update from prefab will remove it. Attach it to a plain entity, or Save over prefab to adopt it.'
    )
    // the finding anchors at the child carrying the script — that is what
    // "Select entity" must land on
    expect(found[0].entityId).toBe('513')
  })

  it('leaves an extra script on the instance ROOT alone — the zone card puts reactions there', () => {
    const snapshot: PrefabSnapshot = {
      '512': {
        'inspector::CustomAsset': { assetId: ZOMBIE_ID },
        Transform: transform(),
        'asset-packs::Script': { value: [scriptRow('src/scripts/trigger-zone-reaction.ts')] }
      }
    }
    expect(run(context({ snapshot, prefabs: [zombiePrefab] }))).toEqual([])
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

  it('blames the nested instance for a script inside it — never the parent', () => {
    const snapshot: PrefabSnapshot = {
      '512': { 'inspector::CustomAsset': { assetId: ZOMBIE_ID }, Transform: transform() },
      '513': { 'inspector::CustomAsset': { assetId: ARENA_ID }, Transform: { ...transform(), parent: 512 } },
      '514': {
        Transform: { ...transform(), parent: 513 },
        'asset-packs::Script': { value: [scriptRow('src/scripts/other.ts')] }
      }
    }
    const found = run(context({ snapshot, prefabs: [zombiePrefab, arenaPrefab] }))
    expect(found).toHaveLength(1)
    expect(found[0].folder).toBe('custom/arena_graveyard')
    expect(found[0].entityId).toBe('514')
  })
})

// --- 4. editing only strips the server half ---

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
    const spawnerSnapshot: PrefabSnapshot = {
      '600': {
        Transform: transform(),
        'asset-packs::Script': {
          value: [
            {
              path: 'custom/spawner/scripts/spawner.ts',
              priority: 0,
              layout: JSON.stringify({ params: { spawn: { type: 'prefab', value: ARENA_ID } }, actions: [] })
            }
          ]
        }
      }
    }
    const found = run(context({ snapshot: spawnerSnapshot, prefabs: [zone] }))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toContain('trigger area')
    expect(`${found[0].title} ${found[0].detail}`).not.toContain('clone')
  })

  it('says nothing about a zone nothing spawns — placed copies are not the hazard', () => {
    const zone: SceneCheckPrefab = {
      folder: 'custom/trigger_zone',
      data: data({ id: ARENA_ID, name: 'Trigger Zone' }),
      composite: composite([
        transformComponent({ '0': transform() }),
        { name: 'core::TriggerArea', data: { '0': { json: {} } } }
      ])
    }
    expect(run(context({ prefabs: [zone] }))).toEqual([])
  })

})

// --- 7. prefab-runtime-import ---

// A creator's zone reaction used to import the bus out of the Trigger Area's own
// folder. That folder carries no runtime modules any more, so accepting its
// update deletes the file the import points at — and nothing else in the editor
// would say a word about it.
describe('prefab-runtime-import', () => {
  const run = check(CHECK_IDS.prefabRuntimeImport)
  const REACTION = "import { isInZone, onZone, zoneOf } from '../../custom/trigger_zone/scripts/runtime/zoneBus'\nexport class Door {}\n"

  it('names the exact edit, in the specifier the script has to end up with', () => {
    const found = run(context({ scripts: { 'src/scripts/door.ts': REACTION } }))
    expect(found).toHaveLength(1)
    // the same import still resolves until the prefab update lands; refusing Play
    // on a scene that runs would cost more than the warning is worth
    expect(found[0].level).toBe('warning')
    expect(found[0].detail).toBe(
      'A prefab folder holds no runtime modules — the scene keeps one copy of them, so change ' +
        '`../../custom/trigger_zone/scripts/runtime/zoneBus` in door.ts to `./runtime/zoneBus`.'
    )
  })

  // the same module, named from wherever the script sits
  it('spells the replacement against the importing script\'s own directory', () => {
    const found = run(context({ scripts: { 'src/lib/deep/door.ts': REACTION } }))
    expect(found[0].detail).toContain('`../../scripts/runtime/zoneBus`')
  })

  it('says nothing about a script already on the shared copy', () => {
    const fixed = "import { onZone } from './runtime/zoneBus'\nexport class Door {}\n"
    expect(run(context({ scripts: { 'src/scripts/door.ts': fixed } }))).toEqual([])
  })

  // a doc header showing the old import is prose, not a dependency
  it('ignores a specifier that only appears in a comment', () => {
    const documented = "// was: import { onZone } from '../../custom/trigger_zone/scripts/runtime/zoneBus'\nexport class Door {}\n"
    expect(run(context({ scripts: { 'src/scripts/door.ts': documented } }))).toEqual([])
  })

  // the folder's own scripts are re-pointed by the update itself; nagging about
  // machine-owned files a creator cannot edit teaches them nothing
  it('leaves a prefab folder to its own update', () => {
    const inside = { 'custom/trigger_zone/scripts/trigger-zone.ts': REACTION }
    expect(run(context({ scripts: inside }))).toEqual([])
  })
})
