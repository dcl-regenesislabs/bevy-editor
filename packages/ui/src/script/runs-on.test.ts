import { describe, expect, it } from 'vitest'
import { getScriptTemplateClass } from './template'
import { gameUse, runsOn } from './runs-on'

const IMPORT = "import { game, onClick } from './runtime/game'\n"

describe('runsOn', () => {
  it('names the green call sites in source order', () => {
    const { green, blue } = runsOn(
      `${IMPORT}
      game.onMessage('openChest', () => {})
      game.onEnterArea('Vault', () => {})
      game.onExitArea('Vault', () => {})`
    )
    expect(green).toEqual(['openChest', 'enter Vault', 'leave Vault'])
    expect(blue).toEqual([])
  })

  it('names the blue call sites', () => {
    const { green, blue } = runsOn(
      `${IMPORT}
      game.onStateChange(() => {})
      game.layout('rock', () => [])
      onClick(this.entity, () => {})`
    )
    expect(green).toEqual([])
    expect(blue).toEqual(['synced state changes', 'rock layout', 'clicks'])
  })

  it('names the layouts when the prefab is computed', () => {
    expect(runsOn(`${IMPORT}game.layout(this.item, () => [])`).blue).toEqual(['layouts'])
  })

  it('spends the lifecycle hooks and the timer', () => {
    const { green } = runsOn(
      `${IMPORT}
      game.onStart(() => {})
      game.onRoundStart(() => {})
      game.onPlayerJoin(() => {})
      game.onPlayerLeave(() => {})
      game.every(0.5, () => {})`
    )
    expect(green).toEqual(['start', 'round start', 'a player arrives', 'a player leaves', 'every 0.5s'])
  })

  it('says nothing about a script that never imports the game', () => {
    expect(runsOn("game.onMessage('openChest', () => {})")).toEqual({ green: [], blue: [] })
  })

  it('ignores a call written in a comment or a doc string', () => {
    const { green, blue } = runsOn(
      `${IMPORT}
      // game.onMessage('fromAComment', () => {})
      const help = "call game.onEnterArea('FromAString', …)"
      game.onStateChange(() => {})`
    )
    expect(green).toEqual([])
    expect(blue).toEqual(['synced state changes'])
  })

  it('follows the import alias and skips type-only entries', () => {
    const { green } = runsOn(
      `import { game as shared, type Player } from './runtime/game'
      shared.onMessage('takeFlag', () => {})`
    )
    expect(green).toEqual(['takeFlag'])
  })

  it('lists a name once however often it is handled', () => {
    const { green } = runsOn(`${IMPORT}game.onStart(() => {})\ngame.onStart(() => {})`)
    expect(green).toEqual(['start'])
  })

  it('names the constant a script declared, the way real scripts write it', () => {
    expect(runsOn(`${IMPORT}const FINISH = 'finish'\ngame.onMessage(FINISH, () => {})`).green).toEqual(['finish'])
  })

  it('still says where a call runs when its name is computed', () => {
    // the label is unknowable, but "this runs on the server" is the point of the
    // line — dropping the call entirely left a card looking like it had no
    // server-side code at all
    expect(runsOn(`${IMPORT}game.onMessage(NAMES.open, () => {})`).green).toEqual(['a message'])
  })

  // The unnamed fallback is a creator-visible string: the card says "area", the
  // word the Trigger Area prefab and game.onEnterArea both use.
  it('falls back to the area wording when the area name is computed', () => {
    expect(runsOn(`${IMPORT}game.onEnterArea(NAMES.start, () => {})`).green).toEqual(['enter an area'])
    expect(runsOn(`${IMPORT}game.onExitArea(NAMES.start, () => {})`).green).toEqual(['leave an area'])
  })

  it('reads the scaffolded template as one green handler', () => {
    expect(runsOn(getScriptTemplateClass('wall-button'))).toEqual({ green: ['wallButton'], blue: [] })
  })
})

// The line was blind to the commonest screen-side script of all: one that only
// paints what the game decided. A sign reading game.state had no line at all.
describe('runsOn, a screen that only shows what the game decided', () => {
  it('says a script reading the state on the screen shows synced state', () => {
    const { green, blue } = runsOn(
      `${IMPORT}
      export class ClockBoard {
        update(): void {
          const left = game.state.clock
          this.paint(String(left), game.now())
        }
      }`
    )
    expect(green).toEqual([])
    expect(blue).toEqual(['shows synced state'])
  })

  it('counts the round the screen paints as synced state', () => {
    expect(runsOn(`${IMPORT}update() { if (game.round.number > 0) this.show() }`).blue).toEqual(['shows synced state'])
  })

  it('says nothing extra when the read is the game’s own', () => {
    // every read here happens inside a green callback, or in the method one
    // hands off to — this script never shows state on a screen
    const { green, blue } = runsOn(
      `${IMPORT}
      export class RoundResults {
        start(): void {
          game.every(1, () => this.close())
          game.onStart(() => game.setState({ at: game.now() }))
        }
        private close(): void {
          const finishers = game.state.finishers
          game.setState({ top: finishers, at: game.now() })
        }
      }`
    )
    expect(green).toEqual(['every 1s', 'start'])
    expect(blue).toEqual([])
  })

  it('does not say it twice when the script already reacts to changes', () => {
    expect(runsOn(`${IMPORT}game.onStateChange(() => this.paint(game.state.score))`).blue).toEqual([
      'synced state changes'
    ])
  })

  it('stays quiet on a script that never imports the game', () => {
    expect(runsOn('update() { paint(game.state.clock) }').blue).toEqual([])
  })
})

// What the scene checks read: the same parse, without the labels.
describe('gameUse', () => {
  it('names the zones a script listens on', () => {
    expect(gameUse(`${IMPORT}game.onEnterArea('Start', () => {})\ngame.onExitArea('Vault', () => {})`).zones).toEqual([
      'Start',
      'Vault'
    ])
  })

  it('separates what it answers from what a screen sends', () => {
    const use = gameUse(
      `${IMPORT}
      const FINISH = 'finish'
      export class Race {
        start(): void {
          game.onMessage(FINISH, () => this.finish())
        }
        update(): void {
          void game.send<Verdict>(FINISH, {})
        }
        private finish(): void {
          void game.send('announce', { text: 'a climber made it' })
        }
      }`
    )
    expect(use.handles).toEqual(['finish'])
    // 'announce' is the game telling every screen, not a message anything answers
    expect(use.sends).toEqual(['finish'])
    expect(use.endsRound).toBe(false)
  })

  it('sees the script that ends its own round', () => {
    expect(gameUse(`${IMPORT}game.newRound()`).endsRound).toBe(true)
  })

  it('reads nothing out of prose', () => {
    expect(gameUse(`${IMPORT}// game.onEnterArea('FromAComment', …)\nconst help = "game.newRound()"`)).toEqual({
      zones: [],
      handles: [],
      sends: [],
      endsRound: false
    })
  })
})
