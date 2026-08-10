// Guards the Multiplayer Server kit prefabs. Same job as builtin.test.ts — which
// still runs every generic sweep over these folders — but the kit's per-prefab
// facts are couplings between prefabs, not just folder hygiene: the state key one
// writes and another reads, the message name one sends and another shows. Those
// live here so builtin.test.ts stays under the size ceiling and so a kit change
// has one obvious test to update.
import { describe, expect, it } from 'vitest'
import { getScriptParams } from '../script/parser'
import { readPrefabFile as read } from './builtin-fixtures'
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

// Every kit prefab answers the same four questions the same way; asserting them
// once keeps the per-prefab blocks about what makes each one different.
describe('the Multiplayer Server kit', () => {
  const KIT = [
    'game-flow',
    'health-respawn',
    'announcer',
    'leaderboard',
    'spawner'
  ]
  // Moving a player is the only thing in the kit the runtime asks permission for.
  const PERMISSIONS: Record<string, string[]> = { 'health-respawn': ['ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE'] }
  // The Spawner is the one kit prefab NOT behind the group tile and NOT gated on
  // the auth-server SDK: making something appear is the first thing a beginner
  // reaches for, so its card sits beside Trigger Zone where they are already
  // looking, and it spawns client-side on the pin every editor scene gets.
  const UNGROUPED = new Set(['spawner'])
  const CLIENT_SIDE = new Set(['spawner'])

  it('ships as builtin prefabs with stable ids and only the permissions it names', () => {
    const ids = KIT.map((folder) => data(folder).id)
    expect(new Set(ids).size).toBe(KIT.length)
    for (const folder of KIT) {
      const value = data(folder)
      expect(value.origin?.source, folder).toBe('builtin')
      expect(value.requiresSdk, folder).toBe(CLIENT_SIDE.has(folder) ? undefined : 'auth-server')
      expect(value.group, folder).toBe(UNGROUPED.has(folder) ? undefined : 'Multiplayer Server')
      expect(value.category, folder).toBe('custom')
      expect(value.requiredPermissions ?? [], folder).toEqual(PERMISSIONS[folder] ?? [])
    }
  })

  // `hidden` is the desktop library's own flag (prefab-library.ts): a kit prefab
  // carrying it would ship in the app but never appear on a card.
  it('offers every kit prefab in the library', () => {
    for (const folder of KIT) {
      expect((JSON.parse(read(`${folder}/data.json`)) as { hidden?: boolean }).hidden, folder).toBeUndefined()
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

describe('the spawner', () => {
  const FOLDER = 'spawner'
  const { params, error } = getScriptParams(read(`${FOLDER}/scripts/spawner.ts`))

  it('is a single entity with no authored Transform — the drop point places it', () => {
    const layout = prefabLayout(composite(FOLDER))
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(layout.entities[0].transform).toBeUndefined()
  })

  it('ships a marker of its own, so a spawn point is visible while building', () => {
    const names = composite(FOLDER).components.map((component) => component.name)
    expect(names).toContain('core::MeshRenderer')
    expect(names).toContain('core::Material')
    expect(names).toContain('core::VisibilityComponent')
    expect(names).not.toContain('core::GltfContainer')
  })

  it('points at the spawner script with a layout stub placement fills in', () => {
    expect(scriptPath(FOLDER, '0')).toBe(`${ASSET_PATH_TOKEN}/scripts/spawner.ts`)
    const script = composite(FOLDER).components.find((component) => component.name === SCRIPT_COMPONENT)
    const json = script?.data['0']?.json
    const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
    expect(isRecord(value[0]) && value[0].layout).toBe('{"params":{},"actions":[]}')
  })

  // The right-click gesture, the assistant's routing rule and the scene checks are
  // all written against these exact names — a rename that only lands in the script
  // silently stops the menu item pre-setting anything.
  it('exposes the seven settings the gesture and the guide are written against', () => {
    expect(error).toBeUndefined()
    // What sets the spot off is derived from where it sits — parented to
    // something, that something is the button or the zone — so there is no
    // clickable picker and no zone name. Spread and marker visibility are
    // automatic for the same reason. WHERE a copy lands is the one thing
    // placement cannot always say, so it alone is a setting.
    expect(Object.keys(params)).toEqual([
      'spawn',
      'when',
      'everySeconds',
      'hoverLabel',
      'atMostAtOnce',
      'disappearsAfter',
      'where'
    ])
    expect(params.spawn.type).toBe('prefab')
    expect(params.atMostAtOnce.value).toBe(1)
    expect(params.hoverLabel.value).toBe('Use')
  })

  // These three strings are the same wire: the layout stores them verbatim, and
  // 'custom spot' is the value the editor watches for to materialize the marker.
  it('offers the three spots in creator words, landing at the spawner', () => {
    expect(params.where.options).toEqual(['at this spawner', 'at the player', 'custom spot'])
    expect(params.where.value).toBe('at this spawner')
  })

  // These five strings ARE the wire between the dropdown, the menu item and the
  // prompt: the assistant writes one into a placePrefab request verbatim.
  it('offers the four triggers in creator words', () => {
    expect(params.when.options).toEqual([
      'when clicked',
      'when a player enters',
      'every few seconds',
      'when a script asks'
    ])
    expect(params.when.value).toBe('when clicked')
  })

  // Editor finding 4: a pool opened inside a carried runtime module is invisible
  // to the guarantee scan, and the prefab it copies reads "Not used yet" forever.
  it('opens its pool from the prefab script, where the guarantee scan can see it', () => {
    const source = read(`${FOLDER}/scripts/spawner.ts`)
    expect(source).toContain("openPool(this.spawn, 'seeded')")
  })
})

// Which built-ins say how a creator drives them, and which say nothing.
//
// The complaint that produced the field: an Announcer offers hold seconds and
// font size, and the game.broadcast that makes it speak lives only in ai.md,
// which the assistant reads and the creator does not. So the code line each of
// these ships is the SAME verb its guide teaches — a hint that drifts from the
// guide is worse than none, because a creator copies it.
describe('the line a placed item says it is driven by', () => {
  const DRIVEN: Record<string, string> = {
    announcer: "game.broadcast('announce'",
    leaderboard: 'game.setState(',
    'trigger-zone': 'onZone(',
    'health-respawn': 'damage('
  }
  // Placed and it runs: nothing to drive, so nothing to say. A row here would be
  // an empty row on every one of these cards.
  const SELF_DRIVING = ['game-flow', 'server-clock', 'spawner', 'admin-tools', 'video-screen']

  it('names the same verb the prefab’s guide teaches', () => {
    for (const [folder, verb] of Object.entries(DRIVEN)) {
      const drive = data(folder).drivenBy
      expect(drive, folder).toBeDefined()
      expect(drive?.code, folder).toContain(verb)
      expect(read(`${folder}/ai.md`), folder).toContain(verb)
    }
  })

  it('says nothing for an item that drives itself', () => {
    for (const folder of SELF_DRIVING) expect(data(folder).drivenBy, folder).toBeUndefined()
  })

  // Every one of these strings is creator-facing, and the kit's vocabulary is
  // fixed: "client", "the server", "player", "Script" — never "behavior", never
  // "the game" as the thing that acts, never "the AI".
  it('keeps the kit’s vocabulary', () => {
    for (const folder of Object.keys(DRIVEN)) {
      const drive = data(folder).drivenBy
      const prose = `${drive?.rule ?? ''} ${drive?.next ?? ''}`
      expect(prose, folder).not.toMatch(/behaviou?rs?\b|authoritative|\bthe AI\b|\bscreens?\b/i)
      expect(prose.trim().length, folder).toBeGreaterThan(40)
    }
  })
})
