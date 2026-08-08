// What other scripts call to read and change a player's hit points. It lives
// beside health-respawn.ts rather than in it because a prefab's script file
// exports exactly one class — the runtime constructs the first function-valued
// export, so a helper sitting next to the class could be built instead of it.
import { game, type Player } from './runtime/game'
import { afterDamage, asHealthMap } from './pure/health'

export const HEALTH_KEY = 'health'

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
