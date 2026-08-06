import { describe, expect, it } from 'vitest'
import type { Snapshot } from '@scene/state'
import { unusedBuiltinCopies } from './unused'
import { scriptLayouts, spawnModesFor } from './guarantees'
import { usedPrefabIds } from '../panels/root-split'
import { CUSTOM_ASSET_COMPONENT, SCRIPT_COMPONENT } from './format'
import type { PrefabData, PrefabOriginSource } from './format'
import type { PrefabEntry } from '../panels/prefab-store'

function entry(folder: string, id: string, source: PrefabOriginSource): PrefabEntry {
  const data: PrefabData = {
    id,
    name: folder,
    category: 'custom',
    tags: [],
    origin: { source }
  }
  return { folder, data, hasGuide: false }
}

/** A scene holding `count` instances of `assetId`, plus one plain entity. */
function scene(assetId: string, count: number): Record<string, Record<string, unknown>> {
  const snapshot: Record<string, Record<string, unknown>> = { plain: {} }
  for (let i = 0; i < count; i++) {
    snapshot[`e${i}`] = { [CUSTOM_ASSET_COMPONENT]: { assetId } }
  }
  return snapshot
}

describe('unusedBuiltinCopies', () => {
  it('offers a built-in copy whose last instance is gone', () => {
    const items = [entry('custom/server_clock', 'clock', 'builtin')]
    expect(unusedBuiltinCopies(items, scene('clock', 0)).map((i) => i.folder)).toEqual([
      'custom/server_clock'
    ])
  })

  it('keeps a built-in copy while the scene still instances it', () => {
    const items = [entry('custom/trigger_zone', 'zone', 'builtin')]
    expect(unusedBuiltinCopies(items, scene('zone', 2))).toEqual([])
  })

  it('never offers a prefab the editor cannot ship back', () => {
    const items = [
      entry('custom/mine', 'mine', 'user'),
      entry('custom/imported', 'imported', 'import'),
      entry('custom/from_gh', 'gh', 'github')
    ]
    expect(unusedBuiltinCopies(items, scene('nothing', 0))).toEqual([])
  })

  it('counts instances per prefab, not in total', () => {
    const items = [entry('custom/a', 'a', 'builtin'), entry('custom/b', 'b', 'builtin')]
    const snapshot = { ...scene('a', 1) }
    expect(unusedBuiltinCopies(items, snapshot).map((i) => i.folder)).toEqual(['custom/b'])
  })
})

// Two surfaces say “Not used yet” about the same prefab, from two different
// readings, and a creator who clears one and not the other is being told
// contradictory things about their own scene. The hierarchy hint reads
// prefab-typed Script params; the Prefabs card reads which pool a script opens.
// They only agree about the Spawner because the SPAWNER'S OWN script opens the
// pool — a pool opened inside a carried runtime module is excluded from the scan
// and no Script row would run it, so there would be no params to resolve against.
describe('“Not used yet” across the two surfaces', () => {
  const ZOMBIE = '9f1c3a5e-0000-4000-8000-0000000000aa'
  const SPAWNER_SCRIPT = 'custom/spawner/scripts/spawner.ts'

  // The shape the shipped script actually has — it opens the pool through an
  // alias, which is the whole reason spawnCallsIn resolves imports rather than
  // matching `pool(` in the text.
  const spawnerSource = [
    "import { spawnSpot } from './runtime/spawnBus'",
    "import { pool as openPool, type Pool } from './runtime/spawner'",
    'export class Spawner {',
    '  start() {',
    "    const p = openPool(this.spawn, 'seeded')",
    "    spawnSpot(this.name, { pool: p, spot: this.entity, atMostAtOnce: 1, lifetimeS: 0 })",
    '  }',
    '}'
  ].join('\n')

  const zombie: PrefabData = { id: ZOMBIE, name: 'Zombie Basic', category: 'custom', tags: [] }

  function placedSpawner(spawn: string): Snapshot {
    return {
      '600': {
        [SCRIPT_COMPONENT]: {
          value: [
            {
              path: SPAWNER_SCRIPT,
              priority: 0,
              layout: JSON.stringify({ params: { spawn: { type: 'prefab', value: spawn } }, actions: [] })
            }
          ]
        }
      }
    } as Snapshot
  }

  const modes = (snapshot: Snapshot): string[] =>
    spawnModesFor({ data: zombie, scripts: { [SPAWNER_SCRIPT]: spawnerSource }, layouts: scriptLayouts(snapshot) })

  it('both stop saying it once a Spawner points at the prefab', () => {
    const snapshot = placedSpawner(ZOMBIE)
    expect(usedPrefabIds(snapshot, [{ data: zombie }]).has(ZOMBIE)).toBe(true)
    expect(modes(snapshot)).toEqual(['seeded'])
  })

  it('both keep saying it while the Spawner has nothing picked', () => {
    const snapshot = placedSpawner('')
    expect(usedPrefabIds(snapshot, [{ data: zombie }]).has(ZOMBIE)).toBe(false)
    expect(modes(snapshot)).toEqual([])
  })
})
