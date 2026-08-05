// The checks that read a script's prefab parameters — "you picked nothing" and
// "you picked something that cannot be spawned" — plus the fix button they share.
// Split out of scene-check-rules.test.ts, which was over the file-length ceiling;
// both halves run against the same fixtures.
import { describe, it, expect } from 'vitest'
import { defaultGameConfig } from '../../gameconfig/normalize'
import type { PrefabSnapshot } from '../../prefabs/format'
import { CREATE_SPAWNABLE_GESTURE } from '../../prefabs/copy'
import { BUILTIN_SCENE_CHECKS, CHECK_IDS } from './scene-check-rules'
import type { SceneCheckPrefab } from './scene-checks'
import {
  ARENA_ID,
  RIG_ID,
  ZOMBIE_ID,
  check,
  composite,
  context,
  data,
  scriptRow,
  transform,
  transformComponent,
  zombiePrefab
} from './scene-check-fixtures'

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
    expect(found[0].detail).toContain(CREATE_SPAWNABLE_GESTURE)
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

describe('unspawnable-prefab-ref', () => {
  const run = check(CHECK_IDS.unspawnableRef)
  const snapshot: PrefabSnapshot = {
    '512': {
      'asset-packs::Script': {
        value: [scriptRow('custom/wave_director/scripts/wave-director.ts', { zombie: { type: 'prefab', value: ZOMBIE_ID } })]
      }
    }
  }

  it('accepts a prefab param pointed at any prefab the project has — every prefab is spawnable', () => {
    const plain: SceneCheckPrefab = { ...zombiePrefab, data: data({ id: ZOMBIE_ID, name: 'Zombie Basic' }) }
    const found = run(context({ snapshot, prefabs: [plain] }))
    expect(found).toHaveLength(0)
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

  it('never fires on an empty ref — that is empty-prefab-ref’s job', () => {
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

// --- the fix that opens a property sheet ---

// PrefabsPanel resolves a sheet request against the project's own prefabs only,
// so a rule that offers "Open Placement & spawning" over a library or built-in
// folder would hand the creator a button that does nothing.
describe('open-spawning fixes', () => {
  const plainZombie: SceneCheckPrefab = { ...zombiePrefab, data: data({ id: ZOMBIE_ID, name: 'Zombie Basic' }) }
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
  const snapshot: PrefabSnapshot = {
    '512': {
      'asset-packs::Script': {
        value: [scriptRow('custom/wave_director/scripts/wave-director.ts', { zombie: { type: 'prefab', value: ZOMBIE_ID } })]
      }
    },
    '600': { 'inspector::CustomAsset': { assetId: RIG_ID }, 'inspector::Inert': {}, Transform: transform() }
  }

  it('always names a prefab this project owns', () => {
    const ctx = context({ snapshot, prefabs: [plainZombie, rig] })
    const folders = new Set(ctx.prefabs.map((prefab) => prefab.folder))
    const found = BUILTIN_SCENE_CHECKS.flatMap(([, run]) => run(ctx)).filter(
      (finding) => finding.fix?.action === 'open-spawning'
    )
    expect(found.length).toBeGreaterThanOrEqual(1)
    for (const finding of found) expect(folders.has(finding.folder ?? '')).toBe(true)
  })
})
