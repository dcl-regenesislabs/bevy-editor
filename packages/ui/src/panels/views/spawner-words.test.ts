import { describe, expect, it } from 'vitest'
import { SPAWNER_WHEN_WORDS, SPAWNER_WHERE_WORDS, spawnerWhenWords } from './spawner-words'

// The five STORED values are pinned by builtin-kit.test.ts; this map must cover
// exactly that set or the dropdown shows a bare wire value for the odd one out.
const STORED = [
  'when clicked',
  'when a player enters',
  'every few seconds',
  'when a script asks'
]

describe('the spawner "when" words', () => {
  it('covers every stored trigger value, and nothing else', () => {
    expect(Object.keys(SPAWNER_WHEN_WORDS).sort()).toEqual([...STORED].sort())
  })

  it('gives each trigger a label and a hint', () => {
    for (const stored of STORED) {
      const words = spawnerWhenWords(stored)
      expect(words.label.length, stored).toBeGreaterThan(0)
      expect(words.hint.length, stored).toBeGreaterThan(10)
    }
  })

  it('falls back to the stored value for a trigger it does not know', () => {
    expect(spawnerWhenWords('whenever')).toEqual({ label: 'whenever', hint: '' })
  })
})

// Same contract for the "where" dropdown: builtin-kit.test.ts pins the stored
// options; this map must cover exactly that set or the odd one renders bare.
describe('the spawner "where" words', () => {
  const STORED_WHERE = ['at this spawner', 'at the player', 'custom spot']

  it('covers every stored spot value, and nothing else', () => {
    expect(Object.keys(SPAWNER_WHERE_WORDS).sort()).toEqual([...STORED_WHERE].sort())
  })

  it('gives each spot a label and a hint', () => {
    for (const stored of STORED_WHERE) {
      const words = SPAWNER_WHERE_WORDS[stored]
      expect(words.label.length, stored).toBeGreaterThan(0)
      expect(words.hint.length, stored).toBeGreaterThan(10)
    }
  })
})
