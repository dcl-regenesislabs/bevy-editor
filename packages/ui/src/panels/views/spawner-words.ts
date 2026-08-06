// The creator-facing words for the Spawner's "when" dropdown. The STORED
// values are a wire contract (builtin-kit.test.ts, probe-spawner.mjs, the AI
// prompt and ai.md all write them verbatim), so a friendlier phrasing lives
// here as display-only words: the layout keeps the stored value, the creator
// reads the label, and the hint says what actually happens — including the one
// piece of wiring ('when another script asks') that no label can carry alone.
export interface SpawnerWhenWords {
  /** what the dropdown shows in place of the stored value */
  label: string
  /** one sentence saying what happens when this trigger is picked */
  hint: string
}

export const SPAWNER_WHEN_WORDS: Record<string, SpawnerWhenWords> = {
  'when clicked': {
    label: 'when clicked',
    hint: 'A player clicks it and a copy appears.'
  },
  'when a player enters': {
    label: 'when a player walks in',
    hint: 'A copy appears when someone walks into this spot — or into the zone this spawner sits in. Scale the spawner to size the spot.'
  },
  'every few seconds': {
    label: 'every few seconds',
    hint: 'Copies keep coming on a timer while the game runs.'
  },
  'when a script asks': {
    label: 'when another script asks',
    hint: "Nothing happens on its own: another script calls this spawner by its name — requestSpawn('Crate Spawner') — and a copy appears."
  }
}

export function spawnerWhenWords(stored: string): SpawnerWhenWords {
  return SPAWNER_WHEN_WORDS[stored] ?? { label: stored, hint: '' }
}
