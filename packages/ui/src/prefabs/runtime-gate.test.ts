import { describe, it, expect } from 'vitest'
import {
  buildRuntimeVersion,
  closureRefusal,
  needsNewerStudio,
  prefabSources,
  runtimeRefusal
} from './runtime-gate'
import { RUNTIME_VERSION } from '../../../desktop/runtime-modules/version'
import type { PrefabData } from './format'

const prefab = (over: Partial<PrefabData> = {}): PrefabData => ({
  id: 'p1',
  name: 'Leaderboard',
  category: 'custom',
  tags: [],
  ...over
})

describe('runtimeRefusal', () => {
  it('refuses a prefab whose minor is ahead of the build', () => {
    expect(runtimeRefusal(prefab({ minRuntime: '0.4.0' }), '0.3.0')).toBe(
      'Leaderboard needs a newer Decentraland Studio than this one — run Check for updates in Home › Account, then drag it in again.'
    )
    expect(runtimeRefusal(prefab({ minRuntime: '1.0.0' }), '0.9.9')).not.toBeNull()
  })

  // the whole reason the compare is [major, minor]: minRuntime records what a
  // prefab was BUILT against, so a patch bump would refuse prefabs that work
  it('allows a patch-only difference in either direction', () => {
    expect(runtimeRefusal(prefab({ minRuntime: '0.3.7' }), '0.3.0')).toBeNull()
    expect(runtimeRefusal(prefab({ minRuntime: '0.3.0' }), '0.3.7')).toBeNull()
    expect(runtimeRefusal(prefab({ minRuntime: '0.3' }), '0.3.0')).toBeNull()
  })

  it('allows an older prefab, and one that declares nothing at all', () => {
    expect(runtimeRefusal(prefab({ minRuntime: '0.2.0' }), '0.3.0')).toBeNull()
    // absent means no requirement — never '0.0.0'-and-compare, which would
    // refuse every prefab authored before the field existed
    expect(runtimeRefusal(prefab(), '0.3.0')).toBeNull()
    expect(runtimeRefusal(prefab(), '99.0.0')).toBeNull()
  })

  it('allows a built-in whatever it declares — it ships inside this build', () => {
    const builtin = prefab({ minRuntime: '9.9.9', origin: { source: 'builtin' } })
    expect(runtimeRefusal(builtin, '0.3.0')).toBeNull()
    for (const source of ['user', 'import', 'github'] as const) {
      expect(runtimeRefusal(prefab({ minRuntime: '9.9.9', origin: { source } }), '0.3.0')).not.toBeNull()
    }
  })
})

describe('closureRefusal', () => {
  // the closure walk throws `no master for runtime module '<rel>'` with no
  // metadata a creator could act on; this is the guard for a prefab too old to
  // carry minRuntime at all
  it('routes a module this build does not ship to the same message', () => {
    expect(closureRefusal(prefab(), "import { x } from './runtime/notAThing'")).toBe(
      needsNewerStudio('Leaderboard')
    )
  })

  it('allows a script that imports modules this build ships, or none', () => {
    expect(closureRefusal(prefab(), "import { game } from './runtime/game'")).toBeNull()
    expect(closureRefusal(prefab(), "import { engine } from '@dcl/sdk/ecs'")).toBeNull()
  })

  // "needs a module this build does not have" and "carries a module of its own"
  // both read as an unresolvable runtime import to the closure walk. Only the
  // first is the build's business — refusing the second turns every folder built
  // against the carry-your-own shape into a prefab nobody can place.
  it('allows a module the folder carries itself, and still refuses one nobody has', () => {
    const carried = (rel: string): string | null => (rel === 'gunplay.ts' ? 'export const shots = 1\n' : null)
    expect(closureRefusal(prefab(), "import { shots } from './runtime/gunplay'", carried)).toBeNull()
    expect(closureRefusal(prefab(), "import { x } from './runtime/notAThing'", carried)).toBe(
      needsNewerStudio('Leaderboard')
    )
  })

  // a carried module's own dependency is walked too: half a set is still a
  // prefab that cannot build
  it('follows a carried module into a dependency nothing has', () => {
    const carried = (rel: string): string | null =>
      rel === 'gunplay.ts' ? "import { aim } from './ballistics'\n" : null
    expect(closureRefusal(prefab(), "import { shots } from './runtime/gunplay'", carried)).toBe(
      needsNewerStudio('Leaderboard')
    )
  })
})

// The composite's Script rows are not the closure: health-respawn's health.ts is
// imported BY a row rather than being one, so a row walk reads none of the
// imports that decide what the prefab actually needs.
describe('prefabSources', () => {
  const files = [
    'custom/health_respawn/data.json',
    'custom/health_respawn/composite.json',
    'custom/health_respawn/scripts/health-respawn.ts',
    'custom/health_respawn/scripts/health.ts',
    'custom/health_respawn/scripts/runtime/game.ts',
    'custom/health_respawn/scripts/runtime/pure/rng.ts',
    'custom/health_respawn/thumbnail.png',
    'custom/other/scripts/other.ts',
    'src/scripts/mine.ts'
  ]

  it('walks every script the folder holds, not the ones a Script row names', () => {
    expect(prefabSources('custom/health_respawn', files).scripts).toEqual([
      'custom/health_respawn/scripts/health-respawn.ts',
      'custom/health_respawn/scripts/health.ts'
    ])
  })

  it('keeps the folder to itself and holds its carried modules apart', () => {
    const { scripts, carried } = prefabSources('custom/health_respawn', files)
    expect(scripts.some((path) => path.startsWith('custom/other/'))).toBe(false)
    expect(scripts.some((path) => path.startsWith('src/'))).toBe(false)
    expect(carried).toEqual([
      'custom/health_respawn/scripts/runtime/game.ts',
      'custom/health_respawn/scripts/runtime/pure/rng.ts'
    ])
  })
})

describe('the message', () => {
  // house rule: a string is a rule plus the exact next gesture, and the gesture
  // has to exist — this one is the button in features/update/UpdateCard.tsx
  it('names a gesture that exists', () => {
    expect(needsNewerStudio('Leaderboard')).toContain('Check for updates')
    expect(needsNewerStudio('Leaderboard')).toContain('Home › Account')
    expect(needsNewerStudio('Leaderboard')).toContain('Leaderboard')
  })
})

describe('buildRuntimeVersion', () => {
  it('reads the master the scenes are written from', () => {
    expect(buildRuntimeVersion()).toBe(RUNTIME_VERSION)
  })

  // the built-in kit is stamped with the version it was built against, so a
  // stamp ahead of the build would refuse a prefab that ships inside it
  it('is not behind what the built-in kit declares', () => {
    expect(runtimeRefusal(prefab({ minRuntime: RUNTIME_VERSION }), buildRuntimeVersion() ?? '')).toBeNull()
  })
})
