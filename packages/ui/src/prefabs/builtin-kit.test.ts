// Guards the five Multiplayer Server kit prefabs (Round Loop, Level Slots, Wave
// Director, Player Rig, Leaderboard). Same job as builtin.test.ts — which still
// runs every generic sweep over these folders — but the kit's per-prefab facts
// are couplings between prefabs, not just folder hygiene: the tuple key one
// publishes and another reads, the ledger key a gun reports into, the anchor
// points a rig finds its parts by. Those live here so builtin.test.ts stays
// under the size ceiling and so a kit change has one obvious test to update.
import { describe, expect, it } from 'vitest'
import { getScriptParams } from '../script/parser'
import { PREFABS_ROOT, filesUnder, readPrefabFile as read } from './builtin-fixtures'
import {
  ASSET_PATH_TOKEN,
  SCRIPT_COMPONENT,
  isRecord,
  parsePrefabComposite,
  parsePrefabData,
  prefabLayout,
  type PrefabComposite,
  type PrefabData
} from './format'
import {
  beats,
  boardStoreKey,
  boardTableKey,
  defaultPlayerRow,
  isoWeekKey,
  mergeEntry,
  parseEntries,
  periodKey,
  rankOf,
  renderPanel,
  repairPlayerRow,
  safeScore,
  sanitizeName,
  topRows,
  type BoardEntry
} from '../../../desktop/prefabs/leaderboard/scripts/pure/board'

function data(folder: string): PrefabData {
  return parsePrefabData(read(`${folder}/data.json`), folder, 'fallback')
}

function composite(folder: string): PrefabComposite {
  return parsePrefabComposite(read(`${folder}/composite.json`), folder)
}

function scriptPath(folder: string, localId: string): unknown {
  const script = composite(folder).components.find((component) => component.name === SCRIPT_COMPONENT)
  const json = script?.data[localId]?.json
  const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
  return isRecord(value[0]) ? value[0].path : undefined
}

function carried(folder: string): string[] {
  return filesUnder(new URL(`${folder}/scripts/runtime/`, PREFABS_ROOT)).sort()
}

// Every kit prefab answers the same four questions the same way; asserting them
// once keeps the per-prefab blocks about what makes each one different.
describe('the Multiplayer Server kit', () => {
  const KIT = ['round-loop', 'level-slots', 'wave-director', 'player-rig', 'leaderboard']

  it('ships as auth-server prefabs in one group, with stable ids and no permissions', () => {
    const ids = KIT.map((folder) => data(folder).id)
    expect(new Set(ids).size).toBe(KIT.length)
    for (const folder of KIT) {
      const value = data(folder)
      expect(value.origin?.source, folder).toBe('builtin')
      expect(value.requiresSdk, folder).toBe('auth-server')
      expect(value.group, folder).toBe('Multiplayer Server')
      expect(value.category, folder).toBe('custom')
      expect(value.requiredPermissions ?? [], folder).toEqual([])
    }
  })

  it('installs its entry script at priority 0 on its own root', () => {
    for (const folder of KIT) {
      const script = composite(folder).components.find((component) => component.name === SCRIPT_COMPONENT)
      const root = prefabLayout(composite(folder)).roots[0]
      const json = script?.data[root]?.json
      const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
      const entry = isRecord(value[0]) ? value[0] : {}
      expect(entry.priority, folder).toBe(0)
      expect(String(entry.path).startsWith(`${ASSET_PATH_TOKEN}/scripts/`), folder).toBe(true)
    }
  })
})

describe('the round loop', () => {
  const FOLDER = 'round-loop'

  it('is a single entity with no authored Transform — the drop point places it', () => {
    const layout = prefabLayout(composite(FOLDER))
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(layout.entities[0].transform).toBeUndefined()
  })

  it('points at the phase script with a layout stub placement fills in', () => {
    const script = composite(FOLDER).components.find((component) => component.name === SCRIPT_COMPONENT)
    const json = script?.data['0']?.json
    const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
    const entry = isRecord(value[0]) ? value[0] : {}
    expect(entry.path).toBe(`${ASSET_PATH_TOKEN}/scripts/round-loop.ts`)
    expect(entry.layout).toBe('{"params":{},"actions":[]}')
  })

  it('exposes the five phase settings and nothing else', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/round-loop.ts`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual([
      'lobbySeconds',
      'waveSeconds',
      'intermissionSeconds',
      'minPlayers',
      'soloMode'
    ])
    expect(params.minPlayers.value).toBe(2)
    expect(params.soloMode).toMatchObject({ type: 'boolean', value: true })
  })

  it('shows a placeholder countdown before the first sync', () => {
    const text = composite(FOLDER).components.find((component) => component.name === 'core::TextShape')
    const json = text?.data['0']?.json
    expect(isRecord(json) && typeof json.text === 'string' && json.text.includes('--:--')).toBe(true)
  })

  // The Wave Director rebuilds its plan from the bare tuple and never imports
  // this folder, so the key is the wire contract between the two prefabs.
  it('mirrors the bare phase tuple where the other kit prefabs look for it', () => {
    const source = read(`${FOLDER}/scripts/round-loop.ts`)
    expect(source).toContain('__dclRoundTuple_v1')
    expect(read(`${FOLDER}/ai.md`)).toContain('__dclRoundTuple_v1')
    expect(read('wave-director/scripts/wave-director.ts')).toContain('__dclRoundTuple_v1')
  })

  // A phase that pins version 0 forever means live-tuned config never lands.
  it('pins the generated Game Config version into each phase', () => {
    expect(read(`${FOLDER}/scripts/round-loop.ts`)).toContain('__dclGameConfig_v1')
  })

  // If this list changes the cause is a runtime-module edit upstream, not this
  // prefab — re-run node scripts/sync-runtime-modules.mjs, then update it.
  it('carries the server-phase module graph and nothing it does not import', () => {
    expect(carried(FOLDER)).toEqual([
      'protectedSync.ts',
      'pure/countdown.ts',
      'pure/liveness.ts',
      'pure/pending.ts',
      'pure/phase.ts',
      'pure/protectedFields.ts',
      'pure/serverStore.ts',
      'pure/time-math.ts',
      'rpc.ts',
      'schedule.ts',
      'serverLife.ts',
      'serverState.ts',
      'timeSync.ts'
    ])
  })
})

describe('the level slots', () => {
  const FOLDER = 'level-slots'

  it('ships one controller and one slot anchor parented to it', () => {
    const { entities, roots } = prefabLayout(composite(FOLDER))
    expect(roots).toEqual(['512'])
    expect(entities.map((entity) => entity.name)).toEqual(['Level Slots', 'Slot_1'])
    expect(entities[1].parent).toBe('512')
  })

  it('exposes the slot count and the arena list', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/level-slots.ts`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['slotCount', 'arenas'])
  })

  // The arena PICK is the only thing that may cross the wire: a whole arena is
  // many entities, and a 'server' pool is single-entity in v1.
  it('keeps the arena pick server-owned and the geometry client-seeded', () => {
    const controller = read(`${FOLDER}/scripts/level-slots.ts`)
    expect(controller).toContain("openPool(ref, 'seeded')")
    expect(controller).not.toMatch(/openPool\([^)]*'server'/)
    expect(controller).toContain('protectedSync')
  })
})

describe('the wave director', () => {
  const FOLDER = 'wave-director'

  it('installs one script on its single entity', () => {
    const script = composite(FOLDER).components.find((component) => component.name === SCRIPT_COMPONENT)
    expect(script && Object.keys(script.data)).toEqual(['0'])
  })

  // The guide, the scene-health wave-count check and the plan all key off these
  // two names — a rename that only lands in the script is a silent break.
  it('exposes the two params the guide documents', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/wave-director.ts`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['zombie', 'wavesTable'])
    expect(params.wavesTable.value).toBe('waves')
  })

  // The gun reports hits into the ledger this prefab arms the validator on. The
  // two keys are one string; a mismatch silently costs every shot.
  it('arms the ledger the player rig gun reports into', () => {
    expect(read(`${FOLDER}/scripts/wave-director.ts`)).toContain("const LEDGER = 'wave'")
    expect(read('player-rig/scripts/gun-hitscan.ts')).toContain("public ledger: string = 'wave'")
  })
})

describe('the player rig', () => {
  const FOLDER = 'player-rig'

  it('is a per-player spawnable capped at 32 clones', () => {
    expect(data(FOLDER).name).toBe('Player Rig')
    expect(data(FOLDER).spawnable).toEqual({ max: 32, instancing: 'perPlayer' })
  })

  // A clone's snapshot carries no Name, so the rig finds its parts by anchor
  // point. Losing either anchor silently leaves every player without a bar.
  it('anchors the head at the name tag and the hand at the right hand', () => {
    const attach = composite(FOLDER).components.find((component) => component.name === 'core::AvatarAttach')
    const points = Object.values(attach?.data ?? {}).map((entry) =>
      isRecord(entry.json) ? entry.json.anchorPointId : undefined
    )
    expect(points.sort()).toEqual([1, 3])
  })

  it('is a single-root prefab whose parts hang off the root', () => {
    const layout = prefabLayout(composite(FOLDER))
    expect(layout.roots).toEqual(['512'])
    expect(layout.entities.length).toBe(6)
  })

  it('wires the rig script on the root and the gun on the hand anchor', () => {
    expect(scriptPath(FOLDER, '512')).toBe(`${ASSET_PATH_TOKEN}/scripts/player-rig.ts`)
    expect(scriptPath(FOLDER, '514')).toBe(`${ASSET_PATH_TOKEN}/scripts/gun-hitscan.ts`)
  })
})

const leaderboardEntries: BoardEntry[] = [
  { address: '0xaaa', name: 'ana', score: 10, at: 100 },
  { address: '0xbbb', name: 'bo', score: 30, at: 200 },
  { address: '0xccc', name: '', score: 20, at: 50 }
]

describe('the leaderboard', () => {
  it('namespaces its storage by board name, case- and space-insensitively', () => {
    expect(boardStoreKey('Best Time')).toBe('leaderboard:best_time')
    expect(boardStoreKey('best   time')).toBe(boardStoreKey('BEST TIME'))
    expect(boardStoreKey('Points')).not.toBe(boardStoreKey('Best Time'))
    expect(boardTableKey('Points', 'all')).toBe('leaderboard:points:all')
  })

  it('ranks the highest first on a desc board and the lowest first on an asc board', () => {
    expect(topRows(leaderboardEntries, 'desc', 3).map((row) => row.score)).toEqual([30, 20, 10])
    expect(topRows(leaderboardEntries, 'asc', 3).map((row) => row.score)).toEqual([10, 20, 30])
    expect(beats('desc', 5, 4)).toBe(true)
    expect(beats('asc', 5, 4)).toBe(false)
    expect(rankOf(leaderboardEntries, 'desc', '0xAAA')).toBe(3)
    expect(rankOf(leaderboardEntries, 'desc', '0xzzz')).toBe(0)
  })

  it('keeps one row per player, the better score winning', () => {
    const better = mergeEntry(leaderboardEntries, { address: '0xAAA', name: 'ana', score: 99, at: 300 }, 'desc')
    expect(better.filter((entry) => entry.address === '0xaaa')).toHaveLength(1)
    expect(better[0].score).toBe(99)
    const worse = mergeEntry(better, { address: '0xaaa', name: 'ana', score: 1, at: 400 }, 'desc')
    expect(worse.find((entry) => entry.address === '0xaaa')?.score).toBe(99)
  })

  it('breaks ties by who got there first', () => {
    const tied = mergeEntry(
      [{ address: '0xaaa', name: 'ana', score: 5, at: 200 }],
      { address: '0xbbb', name: 'bo', score: 5, at: 100 },
      'desc'
    )
    expect(tied.map((entry) => entry.address)).toEqual(['0xbbb', '0xaaa'])
  })

  it('gives a weekly board one key per ISO week and an all-time board one key forever', () => {
    expect(periodKey('none', Date.UTC(2026, 0, 1))).toBe('all')
    expect(isoWeekKey(Date.UTC(2026, 0, 1))).toBe('2026-w01')
    expect(isoWeekKey(Date.UTC(2026, 0, 4))).toBe('2026-w01')
    expect(isoWeekKey(Date.UTC(2026, 0, 5))).toBe('2026-w02')
    // the last days of 2024 belong to the ISO week that owns their Thursday
    expect(isoWeekKey(Date.UTC(2024, 11, 30))).toBe('2025-w01')
  })

  it('treats every persisted or submitted value as untrusted', () => {
    expect(safeScore('12')).toBeNull()
    expect(safeScore(Number.NaN)).toBeNull()
    expect(safeScore(1e12)).toBeNull()
    expect(safeScore(12.5)).toBe(12.5)
    expect(sanitizeName('  a\nvery very very long display name ')).toBe('a very very very lon')
    expect(sanitizeName(42)).toBe('')
    expect(parseEntries('nope', 'desc')).toEqual([])
    expect(parseEntries([{ address: '0xAAA', score: 3 }, { score: 1 }, null], 'desc')).toEqual([
      { address: '0xaaa', name: '', score: 3, at: 0 }
    ])
    expect(repairPlayerRow({ best: Number.NaN, period: '' }, defaultPlayerRow())).toEqual(defaultPlayerRow())
  })

  it('paints a board even when it is empty', () => {
    expect(renderPanel({ title: 'Points', rows: [], you: null, placeholder: 'no scores yet' })).toBe(
      'POINTS\n\nno scores yet'
    )
    const text = renderPanel({
      title: 'Points',
      rows: topRows(leaderboardEntries, 'desc', 2, '0xbbb'),
      you: { rank: 3, score: 10 },
      placeholder: 'no scores yet'
    })
    expect(text).toContain('>1. bo   30')
    expect(text).toContain('0xccc')
    expect(text).not.toContain('you  3.')
  })

  it('shows the viewer their own place when they are off the visible board', () => {
    const text = renderPanel({
      title: 'Points',
      rows: topRows(leaderboardEntries, 'desc', 1),
      you: { rank: 3, score: 10 },
      placeholder: 'no scores yet'
    })
    expect(text).toContain('you  3. 10')
  })

  it('anchors its text to the panel model and runs the script on the root', () => {
    const byName = new Map(composite('leaderboard').components.map((component) => [component.name, component.data]))
    expect(Object.keys(byName.get('core::GltfContainer') ?? {})).toEqual(['512'])
    expect(Object.keys(byName.get('core::TextShape') ?? {})).toEqual(['513'])
    expect(Object.keys(byName.get(SCRIPT_COMPONENT) ?? {})).toEqual(['512'])
    const child = (byName.get('core::Transform') ?? {})['513']?.json
    expect(isRecord(child) && child.parent).toBe(512)
  })
})
