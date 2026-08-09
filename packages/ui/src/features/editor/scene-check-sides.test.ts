import { describe, expect, it } from 'vitest'
import type { PrefabSnapshot } from '../../prefabs/format'
import { BUILTIN_SCENE_CHECKS } from './scene-check-rules'
import { SIDES_CHECK_IDS, SIDES_SCENE_CHECKS } from './scene-check-sides'
import { check, context, entityScripts, scriptRow } from './scene-check-fixtures'

const RACE = 'custom/tower/scripts/madness-race.ts'
const SDK = "import { isServer } from '@dcl/sdk/network'\n"
const ACTIONS = "import { movePlayerTo, triggerEmote, openExternalUrl } from '~system/RestrictedActions'\n"
const BUS = "import { MessageBus } from '@dcl/sdk/message-bus'\n"

function placed(path: string, text: string, snapshot?: PrefabSnapshot) {
  return context({
    snapshot: snapshot ?? { '1': entityScripts([scriptRow(path)]) },
    scripts: { [path]: text }
  })
}

it('registers both hints with the shared registry', () => {
  const rules = SIDES_SCENE_CHECKS.map(([, rule]) => rule)
  const registered = BUILTIN_SCENE_CHECKS.filter(([, rule]) => rules.includes(rule))
  expect(registered.map(([id]) => id)).toEqual(Object.values(SIDES_CHECK_IDS))
})

// --- server-read-at-module-scope ---

describe('a script that asks which side it is on at the top of the file', () => {
  const run = check(SIDES_CHECK_IDS.moduleScopeServer)

  it('names the file and the two places the answer is real', () => {
    const found = run(placed(RACE, `${SDK}const SERVER = isServer()\n`))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('isServer() answers false at the top of madness-race.ts')
    expect(found[0].detail).toBe(
      'isServer() is not answered yet at the top of a file — it reads false there on the Multiplayer Server as well as on every client. Move this call inside start() or update(), where the answer is real.'
    )
    expect(found[0].entityId).toBe('1')
    expect(found[0].fix).toEqual({ label: 'Select entity', action: 'select-entity' })
  })

  it('fires on a branch taken at the top of the file, not only on a cached answer', () => {
    expect(run(placed(RACE, `${SDK}if (isServer()) { install() }\n`))).toHaveLength(1)
  })

  it('says nothing about the model creators are told to write', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}
        export class Race {
          start(): void {
            if (isServer()) { this.arm(); return }
            this.paint()
          }
          update(dt: number): void {
            if (isServer()) { return }
            this.tick(dt)
          }
        }`
      )
    )
    expect(found).toEqual([])
  })

  it('leaves a constructor alone — it is a function body like any other', () => {
    const found = run(
      placed(RACE, `${SDK}export class Race {\n  constructor(public src: string) { this.server = isServer() }\n}`)
    )
    expect(found).toEqual([])
  })

  it('leaves a callback alone, however it was written', () => {
    const found = run(
      placed(RACE, `${SDK}engine.addSystem(() => {\n  if (isServer()) return\n  paint()\n})\nconst side = () => isServer()`)
    )
    expect(found).toEqual([])
  })

  // Two classes in one file both declaring start() must both count as bodies —
  // keeping only the first would report the second one's branch as module code.
  it('reads every declaration of a method name, not just the first', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}
        export class Board { start(): void { if (isServer()) { this.arm() } } }
        export class Race { start(): void { if (isServer()) { this.arm() } } }`
      )
    )
    expect(found).toEqual([])
  })

  it('reads nothing out of prose', () => {
    const found = run(placed(RACE, `${SDK}// const SERVER = isServer()\nconst help = "const SERVER = isServer()"`))
    expect(found).toEqual([])
  })

  it('ignores a script no entity in the scene runs', () => {
    expect(run(context({ scripts: { [RACE]: `${SDK}const SERVER = isServer()` } }))).toEqual([])
  })

  it('leaves a carried runtime module alone', () => {
    const path = 'custom/tower/scripts/runtime/game.ts'
    expect(run(placed(path, `${SDK}const server = isServer()`))).toEqual([])
  })

  it('says it once for a script placed many times', () => {
    const snapshot: PrefabSnapshot = {
      '1': entityScripts([scriptRow(RACE)]),
      '2': entityScripts([scriptRow(RACE)])
    }
    expect(run(placed(RACE, `${SDK}const SERVER = isServer()`, snapshot))).toHaveLength(1)
  })
})

// --- client-only-call-on-server ---

describe('a call only a player’s own client can carry out, made on the server', () => {
  const run = check(SIDES_CHECK_IDS.clientOnlyOnServer)

  it('names the call and the branch to take it out of', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}${ACTIONS}
        export class Race {
          start(): void {
            if (isServer()) {
              void movePlayerTo({ newRelativePosition: this.spot })
              return
            }
            this.paint()
          }
        }`
      )
    )
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('madness-race.ts calls movePlayerTo() on the Multiplayer Server')
    expect(found[0].detail).toBe(
      'movePlayerTo() only works on a player’s own client — on the Multiplayer Server it resolves with no error and nothing happens. Move this call out of the if (isServer()) branch.'
    )
    expect(found[0].entityId).toBe('1')
  })

  it('says nothing about the same call written in the client half', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}${ACTIONS}
        export class Race {
          start(): void {
            if (isServer()) {
              this.arm()
              return
            }
            void movePlayerTo({ newRelativePosition: this.spot })
          }
        }`
      )
    )
    expect(found).toEqual([])
  })

  // The shape every seat in the kit ships: the server stands down first, and the
  // call lives in a method the client alone ever reaches.
  it('says nothing when the server bails and the call is further down the file', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}${ACTIONS}
        export class Seat {
          start(): void {
            if (isServer()) { return }
            this.arm()
          }
          private sit(): void {
            void movePlayerTo({ newRelativePosition: this.spot })
            void triggerEmote({ predefinedEmote: 'wave' })
          }
        }`
      )
    )
    expect(found).toEqual([])
  })

  it('reads the inverted bail — the rest of the method is the server’s', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}${ACTIONS}
        export class Race {
          start(): void {
            if (!isServer()) return
            void openExternalUrl({ url: 'https://decentraland.org' })
          }
        }`
      )
    )
    expect(found).toHaveLength(1)
    expect(found[0].title).toBe('madness-race.ts calls openExternalUrl() on the Multiplayer Server')
  })

  it('names each call once, in the order the file makes them', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}${ACTIONS}
        export class Race {
          start(): void {
            if (isServer()) {
              void triggerEmote({ predefinedEmote: 'wave' })
              void movePlayerTo({ newRelativePosition: this.spot })
              void triggerEmote({ predefinedEmote: 'clap' })
            }
          }
        }`
      )
    )
    expect(found.map((f) => f.title)).toEqual([
      'madness-race.ts calls triggerEmote() on the Multiplayer Server',
      'madness-race.ts calls movePlayerTo() on the Multiplayer Server'
    ])
  })

  it('says nothing about a script that never says which side it is on', () => {
    const found = run(placed(RACE, `${ACTIONS}export class Race { sit(): void { void movePlayerTo({}) } }`))
    expect(found).toEqual([])
  })

  it('names the MessageBus built at the top of the file, and where it belongs', () => {
    const found = run(placed(RACE, `${BUS}const receiver = new MessageBus()\n`))
    expect(found).toHaveLength(1)
    expect(found[0].level).toBe('warning')
    expect(found[0].title).toBe('madness-race.ts builds a MessageBus at the top of the file')
    expect(found[0].detail).toBe(
      'new MessageBus() only works on a client, and the top of a file runs on the Multiplayer Server too — there it fails with “not implemented”. Move it inside start(), on the client side of the if (isServer()) branch.'
    )
  })

  it('says nothing once the bus is built inside start()', () => {
    const found = run(
      placed(
        RACE,
        `${SDK}${BUS}
        export class Race {
          start(): void {
            if (isServer()) { return }
            this.bus = new MessageBus()
          }
        }`
      )
    )
    expect(found).toEqual([])
  })

  it('reads nothing out of prose', () => {
    const found = run(placed(RACE, `${BUS}// const receiver = new MessageBus()\nconst help = "new MessageBus()"`))
    expect(found).toEqual([])
  })
})
