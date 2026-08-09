import { describe, expect, it } from 'vitest'
import { gameUse, hasServerRegion, runsOn } from './runs-on'

const IMPORT = "import { game } from './runtime/game'\n"
const SDK = "import { isServer } from '@dcl/sdk/network'\n"

/** A script the way the runner drives one: the lifecycle the chip is about. */
function script(body: string): string {
  return `${IMPORT}export class Race {\n  start(): void {\n${body}\n  }\n}`
}

// The chip's whole job: a script that never says which side it is on runs every
// line on the Multiplayer Server too, and nothing else can tell the creator that.
describe('runsOn, the script that never says which side it is on', () => {
  it('speaks up for a game script with no branch, and names what it does', () => {
    const { unbranched, labels } = runsOn(
      script(`      game.onRequest('openChest', () => {})
      game.onEnterArea('Vault', () => {})`)
    )
    expect(unbranched).toBe(true)
    expect(labels).toEqual(['openChest', 'enter Vault'])
  })

  it('goes quiet the moment the file branches', () => {
    expect(
      runsOn(`${IMPORT}${SDK}
      export class Race {
        start(): void {
          if (isServer()) {
            game.onRequest('finish', () => {})
            return
          }
          game.onBroadcast('roundOver', () => {})
        }
      }`)
    ).toEqual({ unbranched: false, labels: [] })
  })

  it('goes quiet on a branch that stands its server half down', () => {
    // an empty server half is still an answer to the question the chip asks
    expect(runsOn(`${IMPORT}${SDK}update() { if (isServer()) return }`).unbranched).toBe(false)
  })

  it('says nothing about a script that never imports the game', () => {
    expect(runsOn("export class X { start() { game.onRequest('openChest', () => {}) } }")).toEqual({
      unbranched: false,
      labels: []
    })
  })

  it('says nothing about a module of free functions — there is nothing to branch', () => {
    // health.ts and race-ui.ts run wherever their caller does, so the advice
    // would have nowhere to land
    const text = `${IMPORT}export function healthOf(player: Player): number { return game.state.health[player] ?? 0 }`
    expect(runsOn(text).unbranched).toBe(false)
  })

  it('speaks up with no names when the script only reads the state', () => {
    const { unbranched, labels } = runsOn(`${IMPORT}update() { this.paint(game.state.clock, game.now()) }`)
    expect(unbranched).toBe(true)
    expect(labels).toEqual([])
  })
})

describe('runsOn labels', () => {
  it('spends the lifecycle hooks and the timer', () => {
    const { labels } = runsOn(
      script(`      game.onReady(() => {})
      game.onRoundStart(() => {})
      game.onPlayerJoin(() => {})
      game.onPlayerLeave(() => {})
      game.every(0.5, () => {})`)
    )
    expect(labels).toEqual(['ready', 'round start', 'a player arrives', 'a player leaves', 'every 0.5s'])
  })

  it('names both halves of the message API with the name they carry', () => {
    expect(runsOn(script("game.onRequest('finish', () => {})\ngame.onBroadcast('roundOver', () => {})")).labels).toEqual([
      'finish',
      'roundOver'
    ])
  })

  it('ignores a call written in a comment or a doc string', () => {
    const { labels } = runsOn(
      script(`      // game.onRequest('fromAComment', () => {})
      const help = "call game.onEnterArea('FromAString', …)"
      game.onReady(() => {})`)
    )
    expect(labels).toEqual(['ready'])
  })

  it('follows the import alias and skips type-only entries', () => {
    expect(
      runsOn(`import { game as shared, type Player } from './runtime/game'
      export class Race {
        start(): void {
          shared.onRequest('takeFlag', () => {})
        }
      }`).labels
    ).toEqual(['takeFlag'])
  })

  it('lists a name once however often it is handled', () => {
    expect(runsOn(script('game.onReady(() => {})\ngame.onReady(() => {})')).labels).toEqual(['ready'])
  })

  it('names the constant a script declared, the way real scripts write it', () => {
    expect(runsOn(script("const FINISH = 'finish'\ngame.onRequest(FINISH, () => {})")).labels).toEqual(['finish'])
  })

  it('still names the verb when the message name is computed', () => {
    expect(runsOn(script('game.onRequest(NAMES.open, () => {})')).labels).toEqual(['a message'])
  })

  // The unnamed fallback is a creator-visible string: the card says "area", the
  // word the Trigger Area prefab and game.onEnterArea both use.
  it('falls back to the area wording when the area name is computed', () => {
    expect(runsOn(script('game.onEnterArea(NAMES.start, () => {})')).labels).toEqual(['enter an area'])
  })
})

// Every shape the kit ships today. The scanner is the only thing that can tell a
// server half apart from a server half that stands down, which is what the
// spawned-only scene check now asks it.
describe('hasServerRegion', () => {
  it('reads the canonical branch', () => {
    expect(
      hasServerRegion(`${SDK}
      export class Rig {
        start(): void {
          if (isServer()) {
            this.authority = new RigAuthority(this.rules)
            return
          }
          this.parts = collectParts(this.entity)
        }
      }`)
    ).toBe(true)
  })

  it('follows the dispatcher into the method it hands off to', () => {
    expect(
      hasServerRegion(`${SDK}
      export class Slots {
        start(): void {
          if (isServer()) this.startServer()
          else this.startClient()
        }
        private startClient(): void {}
        private startServer(): void {
          protectedSync({ entity: this.stateEntity })
        }
      }`)
    ).toBe(true)
  })

  it('reads the inverted bail as the rest of the method', () => {
    expect(
      hasServerRegion(`${SDK}
      export class Loop {
        start(): void {
          if (!isServer()) {
            this.render()
            return
          }
          void this.startServer()
        }
      }`)
    ).toBe(true)
  })

  it('reads the one-line inverted bail inside a free function', () => {
    expect(hasServerRegion(`${SDK}function draw(seed: number): void {\n  if (!isServer()) return\n  publish(seed)\n}`))
      .toBe(true)
  })

  it('reads the answer cached on a field and branched on later', () => {
    expect(
      hasServerRegion(`${SDK}
      export class Waves {
        private serverSide = false
        start(): void {
          this.serverSide = isServer()
          if (this.serverSide) this.startServer()
          else this.startClient()
        }
        private startClient(): void {}
        private startServer(): void {
          ledger.validate('hit', () => true)
        }
      }`)
    ).toBe(true)
  })

  it('reads the answer cached in a local', () => {
    expect(hasServerRegion(`${SDK}const server = isServer()\nif (server) { install() }`)).toBe(true)
  })

  it('follows the alias the import gave isServer', () => {
    expect(hasServerRegion(`import { isServer as onServer } from '@dcl/sdk/network'
      start(): void { if (onServer()) { this.arm() } }`)).toBe(true)
  })

  // The whole reason the premise changed: the scaffold puts the token in every
  // script, and a script that bails is keeping no server half at all.
  it('is false for a script whose server half is a bare return', () => {
    expect(hasServerRegion(`${SDK}start(): void { if (isServer()) return }\nupdate(): void { if (isServer()) return }`))
      .toBe(false)
  })

  it('is false for an empty server block', () => {
    expect(hasServerRegion(`${SDK}start(): void { if (isServer()) { } }`)).toBe(false)
  })

  it('is false for a script that never mentions the check', () => {
    expect(hasServerRegion('export class X { update(dt: number) {} }')).toBe(false)
  })

  it('reads nothing out of prose', () => {
    expect(hasServerRegion('// if (isServer()) { this.arm() }\nconst help = "if (isServer()) arm()"')).toBe(false)
  })

  it('leaves a compound condition alone rather than guessing', () => {
    expect(hasServerRegion(`${SDK}start(): void { if (isServer() && this.primary) { this.arm() } }`)).toBe(false)
  })
})

// What the scene checks read: the same parse, without the labels.
describe('gameUse', () => {
  it('names the zones a script listens on', () => {
    expect(gameUse(`${IMPORT}game.onEnterArea('Start', () => {})`).zones).toEqual(['Start'])
  })

  it('separates what the server answers from what this client asks for', () => {
    const use = gameUse(
      `${IMPORT}
      const FINISH = 'finish'
      export class Race {
        start(): void {
          game.onRequest(FINISH, () => this.finish())
        }
        update(): void {
          void game.request<Verdict>(FINISH, {})
        }
      }`
    )
    expect(use.handles).toEqual(['finish'])
    expect(use.sends).toEqual(['finish'])
    expect(use.endsRound).toBe(false)
  })

  it('leaves a broadcast out — nothing has to answer one', () => {
    expect(gameUse(`${IMPORT}game.broadcast('announce', { text: 'a climber made it' })`).sends).toEqual([])
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
