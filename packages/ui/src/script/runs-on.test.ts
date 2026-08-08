import { describe, expect, it } from 'vitest'
import { getScriptTemplateClass } from './template'
import { runsOn } from './runs-on'

const IMPORT = "import { game, onClick } from './runtime/game'\n"

describe('runsOn', () => {
  it('names the green call sites in source order', () => {
    const { green, blue } = runsOn(
      `${IMPORT}
      game.onMessage('openChest', () => {})
      game.onEnterZone('Vault', () => {})
      game.onExitZone('Vault', () => {})`
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
    expect(blue).toEqual(['shared facts change', 'rock layout', 'clicks'])
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
      const help = "call game.onEnterZone('FromAString', …)"
      game.onStateChange(() => {})`
    )
    expect(green).toEqual([])
    expect(blue).toEqual(['shared facts change'])
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

  it('drops a call whose name is computed rather than written', () => {
    expect(runsOn(`${IMPORT}game.onMessage(NAMES.open, () => {})`).green).toEqual([])
  })

  it('reads the scaffolded template as one green handler', () => {
    expect(runsOn(getScriptTemplateClass('wall-button'))).toEqual({ green: ['wallButton'], blue: [] })
  })
})
