// The creator-facing words for the Spawner's "when" dropdown. The STORED
// values are a wire contract (builtin-kit.test.ts, probe-spawner.mjs, the AI
// prompt and ai.md all write them verbatim), so a friendlier phrasing lives
// here as display-only words: the layout keeps the stored value, the creator
// reads the label, and the hint says what actually happens — including the one
// piece of wiring ('when another script asks') that no label can carry alone.
export interface SpawnerWords {
  /** what the dropdown shows in place of the stored value */
  label: string
  /** one sentence saying what happens when this trigger is picked */
  hint: string
}

export const SPAWNER_WHEN_WORDS: Record<string, SpawnerWords> = {
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

export function spawnerWhenWords(stored: string): SpawnerWords {
  return SPAWNER_WHEN_WORDS[stored] ?? { label: stored, hint: '' }
}

// The "where" dropdown, same contract: stored values are the wire, these are
// the creator's words. 'custom spot' is the one option that DOES something the
// moment it is picked (the marker appears, selected, gizmos armed), so its hint
// describes that consequence rather than a rule.
export const SPAWNER_WHERE_WORDS: Record<string, SpawnerWords> = {
  'at this spawner': {
    label: 'at this spawner',
    hint: 'Copies appear at the spawner’s own spot — move the spawner to move it.'
  },
  'at the player': {
    label: 'at the player',
    hint: 'Copies appear at the feet of the player who set it off, facing their way.'
  },
  'custom spot': {
    label: 'at a custom spot',
    hint: 'A Spawn Spot marker appears showing the model — put it where copies should land. Players never see the marker.'
  }
}

interface WiringSnapshot {
  [entityId: string]: Record<string, unknown> | undefined
}

function parentOf(snapshot: WiringSnapshot, entityId: string): string | null {
  const transform = snapshot[entityId]?.Transform
  const parent =
    typeof transform === 'object' && transform !== null ? (transform as { parent?: unknown }).parent : undefined
  if (typeof parent !== 'number' || parent === 0) return null
  return snapshot[String(parent)] === undefined ? null : String(parent)
}

function nameOf(snapshot: WiringSnapshot, entityId: string): string {
  const name = snapshot[entityId]?.['core-schema::Name']
  const value = typeof name === 'object' && name !== null ? (name as { value?: unknown }).value : undefined
  return typeof value === 'string' && value !== '' ? value : 'what it sits on'
}

/**
 * The trigger is derived from where the spawner sits, and nothing else shows
 * which way it resolved — so the hint under "when" says it for THIS placement:
 * which entity is the button, or whose zone it is, or that its own spot is the
 * area. This is the line that stops "it silently does something I can't see".
 */
export function derivedWhenHint(stored: string, snapshot: WiringSnapshot, entityId: string): string {
  const parent = parentOf(snapshot, entityId)
  if (stored === 'when clicked') {
    return parent === null
      ? 'This spawner is the button — its disc shows while playing so players can see what to click.'
      : `Players click ${nameOf(snapshot, parent)} — the thing this spawner sits on.`
  }
  if (stored === 'when a player enters') {
    const parentIsZone = parent !== null && snapshot[parent]?.TriggerArea !== undefined
    return parentIsZone
      ? `A copy appears when someone walks into ${nameOf(snapshot, parent)} — the zone this spawner sits in.`
      : "This spawner's own spot is the walk-in area — scale the spawner to set its size."
  }
  return spawnerWhenWords(stored).hint
}
