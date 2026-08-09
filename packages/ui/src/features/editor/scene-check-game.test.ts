import { describe, expect, it } from 'vitest'
import type { PrefabSnapshot } from '../../prefabs/format'
import { GAME_CHECK_IDS, GAME_SCENE_CHECKS } from './scene-check-game'
import { BUILTIN_SCENE_CHECKS } from './scene-check-rules'
import { check, context, entityScripts, scriptRow } from './scene-check-fixtures'

const RACE = 'custom/tower/scripts/madness-race.ts'
const FLOW = 'custom/game-flow/scripts/game-flow.ts'
const IMPORT = "import { game } from './runtime/game'\n"

const NAME = 'core-schema::Name'

function named(name: string): PrefabSnapshot[string] {
  return { [NAME]: { value: name } }
}

function scene(entities: Record<string, PrefabSnapshot[string]>): PrefabSnapshot {
  return entities
}

it('registers all three hints with the shared registry', () => {
  const rules = GAME_SCENE_CHECKS.map(([, rule]) => rule)
  const registered = BUILTIN_SCENE_CHECKS.filter(([, rule]) => rules.includes(rule))
  expect(registered.map(([id]) => id)).toEqual(Object.values(GAME_CHECK_IDS))
})

// --- zone-name-unmatched ---

describe('a script that waits at an area nothing is named for', () => {
  const run = check(GAME_CHECK_IDS.zoneName)
  const listens = `${IMPORT}game.onEnterArea('Start', () => {})`

  it('says which name is missing and what to name', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]) }),
        scripts: { [RACE]: listens }
      })
    )
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('No area named “Start”')
    expect(found[0].detail).toContain('name a Trigger Area that')
    expect(found[0].detail).toContain('madness-race.ts')
    expect(found[0].entityId).toBe('1')
  })

  it('says nothing once an entity carries that name, however it is typed', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]), '2': named(' start ') }),
        scripts: { [RACE]: listens }
      })
    )
    expect(found).toEqual([])
  })

  it('stays quiet when the name is computed', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]) }),
        scripts: { [RACE]: `${IMPORT}game.onEnterArea(this.zone, () => {})` }
      })
    )
    expect(found).toEqual([])
  })

  it('ignores a script no entity in the scene runs', () => {
    expect(run(context({ scripts: { [RACE]: listens } }))).toEqual([])
  })
})

// --- message-unanswered ---

describe('a message nothing on the server answers', () => {
  const run = check(GAME_CHECK_IDS.unanswered)
  const asks = `${IMPORT}update() { void game.request('finish', {}) }`

  it('names the message and the handler to add', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]) }),
        scripts: { [RACE]: asks }
      })
    )
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('Nothing on the server answers “finish”')
    expect(found[0].detail).toContain("game.onRequest('finish', …)")
    // the fix button selects the SENDER, so the gesture has to say where the
    // handler goes rather than "add it to a script"
    expect(found[0].detail).toContain('inside the if (isServer()) branch')
    expect(found[0].entityId).toBe('1')
  })

  it('says nothing when any script in the project answers it', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]) }),
        scripts: { [RACE]: asks, 'src/scripts/scoreboard.ts': `${IMPORT}game.onRequest('finish', () => {})` }
      })
    )
    expect(found).toEqual([])
  })

  // The Announcer ships as a .tsx, so a listing that read only .ts told a
  // creator to add a handler they had already written.
  it('says nothing when the handler is in a .tsx script', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]) }),
        scripts: { [RACE]: asks, 'custom/announcer/scripts/announcer.tsx': `${IMPORT}game.onRequest('finish', () => {})` }
      })
    )
    expect(found).toEqual([])
  })

  it('leaves a broadcast alone', () => {
    // game.broadcast is one-way by its own name, so nothing has to answer it and
    // a hint asking for a handler would be wrong
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([scriptRow(RACE)]) }),
        scripts: { [RACE]: `${IMPORT}game.onRoundStart(() => { game.broadcast('announce', {}) })` }
      })
    )
    expect(found).toEqual([])
  })
})

// --- round-never-ends ---

describe('a round handed to a script that never ends it', () => {
  const run = check(GAME_CHECK_IDS.endlessRound)
  const flowRow = (endsWhen: string): unknown =>
    scriptRow(FLOW, { endsWhen: { type: 'string', value: endsWhen } })

  // Game Flow's own ceiling calls game.newRound(), so the shipped script is in
  // every project this hint fires in — reading it as an answer would silence the
  // hint everywhere.
  const flowScript = `${IMPORT}game.every(1, () => game.newRound())`

  it('says the round never ends, and what to call', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([flowRow('script')]) }),
        scripts: { [FLOW]: flowScript }
      })
    )
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('This round never ends')
    expect(found[0].detail).toContain('game.newRound()')
    expect(found[0].entityId).toBe('1')
  })

  it('says nothing once a script of the creator’s ends the round', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([flowRow('script')]) }),
        scripts: { [FLOW]: flowScript, 'src/scripts/round-results.ts': `${IMPORT}game.newRound()` }
      })
    )
    expect(found).toEqual([])
  })

  it('says nothing while the timer still ends the round', () => {
    const found = run(
      context({
        snapshot: scene({ '1': entityScripts([flowRow('timer')]) }),
        scripts: { [FLOW]: flowScript }
      })
    )
    expect(found).toEqual([])
  })
})
