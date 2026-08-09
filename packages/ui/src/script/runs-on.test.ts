import { describe, expect, it } from 'vitest'
import { gameUse, hasServerRegion } from './runs-on'

const IMPORT = "import { game } from './runtime/game'\n"
const SDK = "import { isServer } from '@dcl/sdk/network'\n"

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

  it('follows the import alias and skips type-only entries', () => {
    const use = gameUse(`import { game as shared, type Player } from './runtime/game'
      export class Race {
        start(): void {
          shared.onRequest('takeFlag', () => {})
        }
      }`)
    expect(use.handles).toEqual(['takeFlag'])
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
