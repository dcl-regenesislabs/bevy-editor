import { describe, expect, it } from 'vitest'
import { enumLabelsFor } from './enum-words'

describe('enum words on the Script card', () => {
  it('reads Game Flow’s endsWhen as what actually finishes the round', () => {
    expect(enumLabelsFor(['timer', 'script'])).toEqual({
      timer: 'this clock',
      script: 'your own script'
    })
  })

  it('reads the Leaderboard’s sort as which end of the board wins', () => {
    expect(enumLabelsFor(['desc', 'asc'])).toEqual({
      desc: 'highest wins',
      asc: 'lowest wins'
    })
  })

  // The stored value is the wire the scripts, the guides and the AI prompt all
  // write, so the words are display-only and must never leak back into a layout.
  it('leaves an enum it does not own alone', () => {
    expect(enumLabelsFor(['this player', 'any player'])).toBeUndefined()
    expect(enumLabelsFor([])).toBeUndefined()
  })

  it('claims nothing from a dropdown that only shares one value', () => {
    expect(enumLabelsFor(['timer', 'script', 'a round'])).toBeUndefined()
    expect(enumLabelsFor(['asc', 'alphabetical'])).toBeUndefined()
  })
})
