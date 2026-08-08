// The announcer's decisions, with no SDK and no I/O: what a message turns into,
// and how long it stays. A message is a moment — the game says it once and it
// fades, which is exactly why a player who joins afterwards never sees it.

export const MAX_TEXT_CHARS = 140
export const MIN_HOLD_S = 1
export const MAX_HOLD_S = 60

export function clampHold(seconds: number): number {
  if (!Number.isFinite(seconds)) return 4
  return Math.min(MAX_HOLD_S, Math.max(MIN_HOLD_S, Math.round(seconds)))
}

/**
 * The line to show, or null when there is nothing sayable. Payloads come off the
 * wire, so a missing field, a number, or a paragraph must all end somewhere
 * predictable rather than on screen.
 */
export function toastText(data: unknown): string | null {
  const value =
    typeof data === 'string'
      ? data
      : typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).text
        : undefined
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text === '') return null
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS - 1)}…` : text
}
