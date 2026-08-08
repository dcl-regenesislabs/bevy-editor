// The observer that rides inside the probe-game.mjs scene.
//
// It is deliberately a CREATOR's file: it sits in src/scripts/, it imports
// './runtime/game', and it never mentions the editor. Nothing carries that module
// into the scene — the import alone is what makes the editor generate it, which is
// the claim probe-game.mjs exists to check. If the generation pass regresses this
// file does not compile, and the scene never boots.
//
// LOCAL PREVIEW, stated once: `sdk-commands start` serves the scene to a client
// and nothing else, so isServer() is false everywhere and the green half of every
// verb is unreachable. Every record carries `server`, and the harness reports the
// game-side claims as skipped rather than passed when no record ever says true.
//
// Records leave the scene twice: as a console line (scene_logs) and as a TextShape
// on a throwaway entity (crdt_snapshot), because the log ring truncates.
import { TextShape, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { isServer } from '@dcl/sdk/network'
import { game } from './runtime/game'

const MARK = '[GAME-PROBE]'
const ASK = 'probeAsk'
const published = new Set<string>()

// One entity per record, written once per key: a rebuild must not interleave two
// runs of the same claim.
function publish(key: string, value: Record<string, unknown>): void {
  if (published.has(key)) return
  published.add(key)
  const line = `${MARK} ${JSON.stringify({ tag: key.split(':')[0], server: isServer(), ...value })}`
  console.log(line)
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, -100, 0) })
  TextShape.create(entity, { text: line, fontSize: 1 })
}

export class GameProbe {
  constructor(
    public src: string,
    public entity: Entity
  ) {}

  start() {
    // every send and every reply prints itself, which is what the harness reads
    // when a claim fails
    game.trace(true)

    // The game's half. Registered on both copies (registration is role-agnostic);
    // only the copy running in the game ever hears an ask.
    game.onMessage(ASK, (data: { n: number }, player) => {
      publish(`green:${data.n}`, { n: data.n, player })
      return { pong: data.n }
    })

    publish('boot', { entity: this.entity })

    // This player's screen asks the game, once, and reports whichever way it
    // ends — a reply proves the whole round trip; a rejection names why.
    void (async () => {
      try {
        const reply = (await game.send(ASK, { n: 7 })) as { pong?: number } | null
        publish('round-trip', { pong: reply?.pong ?? null })
      } catch (error) {
        publish('ask-failed', { error: String(error) })
      }
    })()
  }

  update(_dt: number) {
    // The shared clock only answers once a game has answered the sync exchange,
    // so this is a sampler rather than a one-shot read at start.
    const now = game.now()
    if (now > 0) publish('clock', { now })
  }
}
