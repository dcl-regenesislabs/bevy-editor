// Players can take damage and respawn. The game owns everyone's hit points and
// decides who died; each screen only moves its own player when the game tells it
// to, because moving an avatar is the one thing only that player's screen can do.
//
// Hit points live in `game.state.health` — one wallet → points map every screen
// can read, which is what makes a health bar or a "who is still alive" check a
// plain read instead of a message. Other green code hurts a player through
// damage() below; the sweep here notices the zero and respawns them.
import { Transform, type Entity } from '@dcl/sdk/ecs'
import { movePlayerTo } from '~system/RestrictedActions'
import { game, type Player } from './runtime/game'
import { afterDamage, asHealthMap, clampMax, deadPlayers } from './pure/health'

const HEALTH_KEY = 'health'
const RESPAWN = 'respawn'
const SWEEP_S = 0.5
const NO_POINT = "Players won't respawn anywhere until you pick a respawn point."

/** Hit points a player has right now. 0 means they are on their way back. */
export function healthOf(player: Player): number {
  return asHealthMap(game.state[HEALTH_KEY])[player] ?? 0
}

/**
 * Hurt a player, in the game, for everyone. Call it from a green handler — a
 * screen cannot change anyone's health. At zero the placed Health & Respawn
 * sends them back to its respawn point on their next sweep.
 */
export function damage(player: Player, amount: number): void {
  game.setState({ [HEALTH_KEY]: afterDamage(asHealthMap(game.state[HEALTH_KEY]), player, amount) })
}

// One Health & Respawn owns the roster. A second copy would revive everyone the
// first one just killed, half a second apart.
let claimed = false

export class HealthRespawn {
  private primary = false

  constructor(
    public src: string,
    public entity: Entity,
    /** Where players come back. Pick the pad or marker they should land on. */
    public respawnAt: Entity = 0 as Entity,
    /** Hit points a player starts every life with. */
    public maxHealth: number = 100,
    /** Players who fall below this height die. Leave at 0 to switch it off. */
    public dieBelowHeight: number = 0
  ) {}

  start(): void {
    this.primary = !claimed
    claimed = true
    if (!this.primary) {
      console.log('[healthRespawn] a second Health & Respawn is placed — only the first tracks health')
      return
    }
    // One handler per name, so it belongs to the copy whose params win. The game
    // whispers to one player and only that player's own screen can move them.
    game.onMessage(RESPAWN, () => this.goHome())
    if (this.respawnAt === (0 as Entity)) console.log(`[healthRespawn] ${NO_POINT}`)
    game.onStart(() => game.setState({ [HEALTH_KEY]: {} }))
    game.onPlayerJoin((player) => this.revive(player))
    game.onPlayerLeave((player) => {
      const map = { ...asHealthMap(game.state[HEALTH_KEY]) }
      delete map[player]
      game.setState({ [HEALTH_KEY]: map })
    })
    game.onRoundStart(() => {
      const map = asHealthMap(game.state[HEALTH_KEY])
      const full: Record<string, number> = {}
      for (const player of Object.keys(map)) full[player] = clampMax(this.maxHealth)
      game.setState({ [HEALTH_KEY]: full })
    })
    game.every(SWEEP_S, () => this.sweep())
  }

  private sweep(): void {
    const map = asHealthMap(game.state[HEALTH_KEY])
    const dead = deadPlayers(map, (player) => game.positionOf(player), this.deathPlane)
    if (dead.length === 0) return
    const next = { ...map }
    for (const player of dead) {
      next[player] = clampMax(this.maxHealth)
      void game.send(RESPAWN, {}, { to: player })
    }
    game.setState({ [HEALTH_KEY]: next })
  }

  private get deathPlane(): number {
    return Number.isFinite(this.dieBelowHeight) ? this.dieBelowHeight : 0
  }

  private revive(player: Player): void {
    game.setState({
      [HEALTH_KEY]: { ...asHealthMap(game.state[HEALTH_KEY]), [player]: clampMax(this.maxHealth) }
    })
  }

  private goHome(): void {
    const point = this.respawnAt === (0 as Entity) ? null : Transform.getOrNull(this.respawnAt)
    if (point === null) {
      console.log(`[healthRespawn] ${NO_POINT}`)
      return
    }
    void movePlayerTo({ newRelativePosition: { ...point.position } })
  }
}
