// Creator-facing words for kit enum params whose STORED values are a wire
// contract (the scripts, their ai.md guides and the AI prompt all write them
// verbatim), so a raw 'timer' or 'asc' would otherwise be what the dropdown
// shows. Same rule as spawner-words.ts: the layout keeps the stored value, the
// creator reads the label.
//
// Matched on the OPTION SET, not on the param name — the same words then follow
// a param that is renamed, and one prefab's enum cannot claim another's values.

/** Game Flow's `endsWhen`: what finishes a round. */
export const ENDS_WHEN_WORDS: Record<string, string> = {
  timer: 'this clock',
  script: 'your own script'
}

/** Leaderboard's `sort`: which end of the board wins. */
export const SORT_WORDS: Record<string, string> = {
  asc: 'lowest wins',
  desc: 'highest wins'
}

const LABEL_MAPS = [ENDS_WHEN_WORDS, SORT_WORDS]

/**
 * The words for a dropdown, or undefined when its options are not ENTIRELY one
 * map's — another script's enum that happens to share a value keeps its own
 * stored strings.
 */
export function enumLabelsFor(options: string[]): Readonly<Record<string, string>> | undefined {
  if (options.length === 0) return undefined
  const words = LABEL_MAPS.find((map) => options.every((option) => map[option] !== undefined))
  return words === undefined ? undefined : Object.fromEntries(options.map((o) => [o, words[o]]))
}
