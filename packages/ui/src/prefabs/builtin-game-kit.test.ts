// Guards the four kit prefabs built on the `game` module: Game Flow, Health &
// Respawn, Announcer and the rewritten Leaderboard. builtin.test.ts runs the
// generic folder sweeps and builtin-kit.test.ts owns the shelved pre-game family
// (Round Loop, Wave Director, Level Slots, Player Rig) plus the shared kit facts;
// what lives here is each piece's own contract — the params the guide and the
// assistant are written against, the state key one writes and another reads, and
// the pure halves of their decisions.
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
import { boardRows, clampRows, renderPanel } from '../../../desktop/prefabs/leaderboard/scripts/pure/board'
import {
  advanceFlow,
  asFlowFact,
  configFromSeconds,
  intermissionState,
  lobbyState,
  panelText,
  podiumLine,
  roundState
} from '../../../desktop/prefabs/game-flow/scripts/pure/flow'
import {
  afterDamage,
  asHealthMap,
  clampMax,
  deadPlayers
} from '../../../desktop/prefabs/health-respawn/scripts/pure/health'
import { clampHold, toastText } from '../../../desktop/prefabs/announcer/scripts/pure/toast'

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

describe('the game flow', () => {
  const FOLDER = 'game-flow'

  it('is a single entity with no authored Transform — the drop point places it', () => {
    const layout = prefabLayout(composite(FOLDER))
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(layout.entities[0].transform).toBeUndefined()
  })

  it('points at the flow script with a layout stub placement fills in', () => {
    expect(scriptPath(FOLDER, '0')).toBe(`${ASSET_PATH_TOKEN}/scripts/game-flow.ts`)
    const script = composite(FOLDER).components.find((component) => component.name === SCRIPT_COMPONENT)
    const json = script?.data['0']?.json
    const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
    expect(isRecord(value[0]) && value[0].layout).toBe('{"params":{},"actions":[]}')
  })

  // These names are the wire between the inspector, the guide and the assistant's
  // placePrefab request — a rename that only lands in the script is a silent break.
  it('exposes the six settings the guide is written against', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/game-flow.ts`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual([
      'roundSeconds',
      'countdownSeconds',
      'intermissionSeconds',
      'minPlayers',
      'endsWhen',
      'boardKey'
    ])
    expect(params.endsWhen.options).toEqual(['timer', 'script'])
    expect(params.boardKey.value).toBe('leaderboard')
  })

  it('shows a placeholder countdown before the first sync', () => {
    const text = composite(FOLDER).components.find((component) => component.name === 'core::TextShape')
    const json = text?.data['0']?.json
    expect(isRecord(json) && typeof json.text === 'string' && json.text.includes('--:--')).toBe(true)
  })

  // The winners line is the only thing Game Flow tells the screens, and the
  // Announcer is what shows it. One string, two folders.
  it('announces its winners on the name the announcer handles', () => {
    expect(read(`${FOLDER}/scripts/game-flow.ts`)).toContain("const ANNOUNCE = 'announce'")
    expect(read('announcer/scripts/announcer.tsx')).toContain("const ANNOUNCE = 'announce'")
  })

  // If this list changes the cause is a runtime-module edit upstream, not this
  // prefab — re-run node scripts/sync-runtime-modules.mjs, then update it.
  it('carries the game module and everything it imports', () => {
    expect(carried(FOLDER)).toContain('game.ts')
    expect(carried(FOLDER)).toContain('pure/gameCore.ts')
    expect(carried(FOLDER)).toEqual(carried('announcer'))
  })

  it('parks the lobby while the scene is short of players, then counts down', () => {
    const config = configFromSeconds(300, 10, 10, 2)
    const parked = advanceFlow(lobbyState(), config, 1, 1000)
    expect(parked.state.endsAtMs).toBe(0)
    expect(parked.action).toBe('none')
    const arming = advanceFlow(parked.state, config, 2, 1000)
    expect(arming.state.endsAtMs).toBe(11_000)
    expect(advanceFlow(arming.state, config, 2, 10_999).action).toBe('none')
    expect(advanceFlow(arming.state, config, 2, 11_000).action).toBe('startRound')
  })

  it('drops a half-counted lobby back to parked when the players leave again', () => {
    const config = configFromSeconds(300, 10, 10, 2)
    const armed = advanceFlow(lobbyState(), config, 2, 1000).state
    expect(advanceFlow(armed, config, 1, 2000).state.endsAtMs).toBe(0)
  })

  it('ends a round on its deadline and never before it', () => {
    const config = configFromSeconds(300, 10, 10, 1)
    const round = roundState(lobbyState(), config, 5000)
    expect(round).toEqual({ phase: 'round', endsAtMs: 305_000, round: 1 })
    expect(advanceFlow(round, config, 1, 304_999).action).toBe('none')
    expect(advanceFlow(round, config, 1, 305_000).action).toBe('endRound')
  })

  // A round the head count cannot end is the whole point: players leaving
  // mid-round must not silently close it.
  it('leaves a running round alone when everyone walks out', () => {
    const config = configFromSeconds(300, 10, 10, 2)
    const round = roundState(lobbyState(), config, 0)
    expect(advanceFlow(round, config, 0, 1000).action).toBe('none')
  })

  it('goes straight into the next round after the winners, or back to the lobby', () => {
    const config = configFromSeconds(300, 10, 10, 2)
    const shown = intermissionState({ phase: 'round', endsAtMs: 0, round: 3 }, config, 1000)
    expect(shown).toEqual({ phase: 'intermission', endsAtMs: 11_000, round: 3 })
    expect(advanceFlow(shown, config, 2, 11_000).action).toBe('startRound')
    const empty = advanceFlow(shown, config, 1, 11_000)
    expect(empty.action).toBe('none')
    expect(empty.state).toEqual({ phase: 'lobby', endsAtMs: 0, round: 3 })
  })

  it('clamps a round length a creator typed nonsense into', () => {
    expect(configFromSeconds(0, -5, Number.NaN, 0)).toEqual({
      roundMs: 1000,
      countdownMs: 1000,
      intermissionMs: 1000,
      minPlayers: 1
    })
  })

  it('refuses a flow fact that is not one', () => {
    expect(asFlowFact({ phase: 'nope' })).toBeNull()
    expect(asFlowFact(null)).toBeNull()
    expect(asFlowFact({ phase: 'round', endsAtMs: 'soon', round: -2, present: 3 })).toEqual({
      phase: 'round',
      endsAtMs: 0,
      round: 0,
      present: 3
    })
  })

  it('reads the winners out of whatever shape the game wrote', () => {
    expect(podiumLine([{ p: '0xabcdef0123456789', time: 12 }, { player: 'bo', seconds: 20 }], 3)).toBe(
      'Round over — 1. 0xabcd…6789  2. bo'
    )
    expect(podiumLine([], 3)).toBe('Round over — nobody scored.')
    expect(podiumLine('not a board', 3)).toBe('Round over — nobody scored.')
  })

  it('paints the phase the game published, and hides a clock a script owns', () => {
    const lobby = { phase: 'lobby' as const, endsAtMs: 0, round: 0, present: 1 }
    expect(panelText(lobby, 0, true, 2)).toBe('LOBBY\n--:--\n1/2 players')
    const round = { phase: 'round' as const, endsAtMs: 95_000, round: 2, present: 2 }
    expect(panelText(round, 5000, true, 2)).toBe('ROUND 2\n1:30')
    expect(panelText(round, 5000, false, 2)).toBe('ROUND 2')
    expect(panelText(null, 0, true, 2)).toContain('--:--')
  })
})

describe('the health & respawn', () => {
  const FOLDER = 'health-respawn'

  it('is one invisible entity carrying only its script', () => {
    const layout = prefabLayout(composite(FOLDER))
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(composite(FOLDER).components.map((component) => component.name)).toEqual([
      'core-schema::Name',
      SCRIPT_COMPONENT
    ])
    expect(scriptPath(FOLDER, '0')).toBe(`${ASSET_PATH_TOKEN}/scripts/health-respawn.ts`)
  })

  // `respawnAt` names an entity, so the inspector has to offer the picker rather
  // than a text field — the type annotation is what switches it (parser.ts).
  it('takes its respawn point as an entity pick, not a typed id', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/health-respawn.ts`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['respawnAt', 'maxHealth', 'dieBelowHeight'])
    expect(params.respawnAt.type).toBe('entity')
    expect(params.dieBelowHeight.value).toBe(0)
  })

  it('declares the permission its respawn needs', () => {
    expect(data(FOLDER).requiredPermissions).toContain('ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE')
  })

  it('never invents a roster row for someone who is not in the game', () => {
    expect(afterDamage({}, '0xa', 10)).toEqual({})
    expect(afterDamage({ '0xa': 30 }, '0xa', 10)).toEqual({ '0xa': 20 })
    expect(afterDamage({ '0xa': 5 }, '0xa', 40)).toEqual({ '0xa': 0 })
    expect(afterDamage({ '0xa': 5 }, '0xa', Number.NaN)).toEqual({ '0xa': 5 })
  })

  it('repairs a health map that came off the wire', () => {
    expect(asHealthMap({ '0xa': 10, '0xb': 'lots', '0xc': -3 })).toEqual({ '0xa': 10, '0xc': 0 })
    expect(asHealthMap([1, 2])).toEqual({})
    expect(clampMax(0)).toBe(1)
    expect(clampMax(Number.NaN)).toBe(100)
  })

  // A death plane of 0 is the off switch: a scene whose ground sits at y 0 would
  // otherwise kill everyone standing on it.
  it('kills on zero health always and on the death plane only when one is set', () => {
    const feet = (player: string): { y: number } | null => (player === '0xa' ? { y: 2 } : { y: 20 })
    expect(deadPlayers({ '0xa': 100, '0xb': 100 }, feet, 7)).toEqual(['0xa'])
    expect(deadPlayers({ '0xa': 100, '0xb': 100 }, feet, 0)).toEqual([])
    expect(deadPlayers({ '0xa': 0, '0xb': 100 }, () => null, 0)).toEqual(['0xa'])
  })
})

describe('the announcer', () => {
  const FOLDER = 'announcer'

  it('is one invisible entity carrying only its script', () => {
    const layout = prefabLayout(composite(FOLDER))
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(scriptPath(FOLDER, '0')).toBe(`${ASSET_PATH_TOKEN}/scripts/announcer.tsx`)
  })

  it('exposes only how long a message stays and how big it is', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/announcer.tsx`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['holdSeconds', 'fontSize'])
    expect(params.holdSeconds.value).toBe(4)
  })

  // Only one script per scene may draw UI, and admin-tools shipped the marker
  // first. Both folders read the same globalThis key or the second one blanks
  // whatever the first drew.
  it('cooperates with the other UI-owning prefab over the single renderer', () => {
    expect(read(`${FOLDER}/scripts/ui-owner.ts`)).toBe(read('admin-tools/scripts/ui-owner.ts'))
  })

  it('shows a line and nothing that is not one', () => {
    expect(toastText({ text: '  Round   over  ' })).toBe('Round over')
    expect(toastText('plain')).toBe('plain')
    expect(toastText({ text: '' })).toBeNull()
    expect(toastText({ text: 42 })).toBeNull()
    expect(toastText(undefined)).toBeNull()
    expect(toastText({ text: 'x'.repeat(200) })?.length).toBe(140)
  })

  it('clamps a hold a creator typed nonsense into', () => {
    expect(clampHold(Number.NaN)).toBe(4)
    expect(clampHold(0)).toBe(1)
    expect(clampHold(1000)).toBe(60)
  })
})

describe('the leaderboard', () => {
  const FOLDER = 'leaderboard'

  it('anchors its text to the panel model and runs the script on the root', () => {
    const byName = new Map(composite(FOLDER).components.map((component) => [component.name, component.data]))
    expect(Object.keys(byName.get('core::GltfContainer') ?? {})).toEqual(['512'])
    expect(Object.keys(byName.get('core::TextShape') ?? {})).toEqual(['513'])
    expect(Object.keys(byName.get(SCRIPT_COMPONENT) ?? {})).toEqual(['512'])
    const child = (byName.get('core::Transform') ?? {})['513']?.json
    expect(isRecord(child) && child.parent).toBe(512)
  })

  // boardKey is the whole contract with the rest of the kit: Game Flow reads the
  // same default for its winners line.
  it('exposes the four settings the guide is written against', () => {
    const { params, error } = getScriptParams(read(`${FOLDER}/scripts/leaderboard.ts`))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['title', 'boardKey', 'sort', 'rows'])
    expect(params.sort.options).toEqual(['desc', 'asc'])
    expect(params.boardKey.value).toBe('leaderboard')
    const flow = getScriptParams(read('game-flow/scripts/game-flow.ts')).params
    expect(flow.boardKey.value).toBe(params.boardKey.value)
  })

  // Creators name the fields themselves, so the reader has to take whichever
  // shape the game wrote — and skip a row it cannot read rather than paint it.
  it('reads a board out of whatever shape the game wrote', () => {
    const rows = boardRows(
      [{ player: 'ana', points: 10 }, { p: 'bo', pts: 30 }, { address: 'cy', score: 20 }, { p: 'no' }, null],
      'desc',
      8
    )
    expect(rows).toEqual([
      { rank: 1, player: 'bo', score: 30 },
      { rank: 2, player: 'cy', score: 20 },
      { rank: 3, player: 'ana', score: 10 }
    ])
    expect(boardRows('not a board', 'desc', 8)).toEqual([])
  })

  it('ranks lowest-first on an asc board and cuts to the visible places', () => {
    const entries = [{ p: 'ana', time: 10 }, { p: 'bo', time: 30 }, { p: 'cy', time: 20 }]
    expect(boardRows(entries, 'asc', 2).map((row) => row.player)).toEqual(['ana', 'cy'])
    expect(clampRows(Number.NaN)).toBe(8)
    expect(clampRows(0)).toBe(1)
    expect(clampRows(999)).toBe(25)
  })

  it('paints times as a clock, points as a number, and wallets short', () => {
    const desc = renderPanel('Points', boardRows([{ p: '0xabcdef0123456789', points: 30 }], 'desc', 8), 'desc', 'none')
    expect(desc).toBe('POINTS\n\n1. 0xabcd…6789   30')
    const asc = renderPanel('Best Times', boardRows([{ p: 'ana', time: 95 }], 'asc', 8), 'asc', 'none')
    expect(asc).toBe('BEST TIMES\n\n1. ana   1:35')
  })

  // The empty state is the card's teaching line: it must name the next gesture.
  it('paints its empty state, and the panel ships with the same words', () => {
    expect(renderPanel('Leaderboard', [], 'desc', 'Nothing to show yet — set the board key your game writes to.')).toBe(
      'LEADERBOARD\n\nNothing to show yet — set the board key your game writes to.'
    )
    const text = composite(FOLDER).components.find((component) => component.name === 'core::TextShape')
    const json = text?.data['513']?.json
    expect(isRecord(json) && String(json.text)).toContain('Nothing to show yet — set the board key')
  })
})

