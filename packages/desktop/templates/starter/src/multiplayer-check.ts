import { engine, Schemas, Transform } from '@dcl/sdk/ecs'
import { isServer, registerMessages } from '@dcl/sdk/network'

// Registered at module load — message schemas must exist before the engine seals.
const room = registerMessages({
  'check.ping': Schemas.Map({}),
  'check.pong': Schemas.Map({})
})

// Far below the ground: invisible to players, visible to tooling.
export const MULTIPLAYER_MARKER_Y = -640.125

/**
 * Proves the scene's Multiplayer Server is reachable: the client pings until
 * the server answers, then drops a hidden marker entity. The editor's
 * validation probe asserts that marker; feel free to delete this file once
 * your scene has real multiplayer logic.
 */
export function startMultiplayerCheck(): void {
  if (isServer()) {
    room.onMessage('check.ping', (_data, context) => {
      if (context) room.send('check.pong', {}, { to: [context.from] })
    })
    return
  }

  let confirmed = false
  room.onMessage('check.pong', () => {
    if (confirmed) return
    confirmed = true
    const marker = engine.addEntity()
    Transform.create(marker, { position: { x: 0, y: MULTIPLAYER_MARKER_Y, z: 0 } })
    console.log('multiplayer-check: server connected')
  })

  // room readiness signals are unreliable across SDK builds — send-and-retry
  // until answered is the only dependable handshake.
  let cooldown = 0
  engine.addSystem((dt: number) => {
    if (confirmed) return
    cooldown -= dt
    if (cooldown > 0) return
    cooldown = 2
    try {
      room.send('check.ping', {})
    } catch {
      /* transport not connected yet — next tick retries */
    }
  })
}
