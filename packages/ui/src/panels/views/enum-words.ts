// Creator-facing words for kit enum params whose STORED values are a wire
// contract (the scripts, their ai.md guides and the assistant prompt all write them
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

/** Moving Platform's `loop`: how the path repeats. Labels keep the stored words. */
export const PLATFORM_LOOP_WORDS: Record<string, { label: string; hint: string }> = {
  'back and forth': {
    label: 'back and forth',
    hint: 'Travels to the last point, then retraces its path home. Forever.'
  },
  around: {
    label: 'around',
    hint: 'Travels the points in a circle, from the last point back to the first.'
  },
  once: {
    label: 'once',
    hint: 'Makes the trip one time and stays at the last point.'
  }
}

/** Moving Platform's `runs`: when the path starts. */
export const PLATFORM_RUNS_WORDS: Record<string, { label: string; hint: string }> = {
  'from the start': {
    label: 'from the start',
    hint: 'Runs on its own from the moment the game starts.'
  },
  'when called': {
    label: 'when called',
    hint: "Waits until a script calls it by name — game.request('platform.call', { name })."
  }
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
