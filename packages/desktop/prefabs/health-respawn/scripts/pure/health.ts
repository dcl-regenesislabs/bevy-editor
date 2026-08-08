// Health & Respawn's bookkeeping, with no SDK and no I/O.
//
// Health is one shared fact — a wallet → hit points map under `game.state.health`
// — so every screen can draw a bar for anyone without asking, and a late joiner
// reads the whole roster from the snapshot. The map is the ONLY place hit points
// live: the sweep in the game reacts to a zero, whoever wrote it.

export type HealthMap = Record<string, number>

export const MIN_HEALTH = 1
export const MAX_HEALTH = 100000

export function clampMax(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(MAX_HEALTH, Math.max(MIN_HEALTH, Math.round(value)))
}

/** Defensive read: the map crossed the wire and a script can clobber the key. */
export function asHealthMap(value: unknown): HealthMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: HealthMap = {}
  for (const [player, points] of Object.entries(value as Record<string, unknown>)) {
    if (typeof points === 'number' && Number.isFinite(points)) out[player] = Math.max(0, Math.floor(points))
  }
  return out
}

/**
 * The map after `amount` damage. A player with no entry is not in the game —
 * hurting them would invent a roster row that never gets cleaned up.
 */
export function afterDamage(map: HealthMap, player: string, amount: number): HealthMap {
  const before = map[player]
  if (before === undefined) return map
  const hurt = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0
  return { ...map, [player]: Math.max(0, before - hurt) }
}

/**
 * The players the game should respawn right now: at or below zero, or fallen
 * past the death plane. `dieBelowY` of 0 switches the plane off — a scene whose
 * ground sits at y 0 would otherwise kill everyone standing on it.
 */
export function deadPlayers(
  map: HealthMap,
  feetOf: (player: string) => { y: number } | null,
  dieBelowY: number
): string[] {
  const out: string[] = []
  for (const [player, points] of Object.entries(map)) {
    if (points <= 0) {
      out.push(player)
      continue
    }
    if (dieBelowY === 0) continue
    const feet = feetOf(player)
    if (feet !== null && feet.y < dieBelowY) out.push(player)
  }
  return out
}
