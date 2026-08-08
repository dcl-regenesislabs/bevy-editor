// Wallets are long. A board keyed by wallet has no display name to show — the
// game has no profile ask, and the client's own lookup only covers players who
// are connected — so both boards render the tail.
export function shortName(player: string): string {
  return player.startsWith('0x') && player.length > 10 ? `${player.slice(0, 6)}…${player.slice(-4)}` : player
}
