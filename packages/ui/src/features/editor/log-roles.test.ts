import { describe, expect, it } from 'vitest'
import { GAME_LIFE_MARKER } from '../play/game-life'
import { taggedLine, taggedLines } from './log-roles'

describe('taggedLine', () => {
  it('reads the tag the runtime wrote and takes it out of the text', () => {
    expect(taggedLine('[3.14] Log: [game] openChest: chest already open')).toEqual({
      role: 'game',
      tag: 'game',
      text: '[3.14] Log: openChest: chest already open'
    })
  })

  it('reads a screen tag', () => {
    expect(taggedLine('[3.14] Log: [you] layout(\'rock\'): boom').role).toBe('you')
  })

  it('keeps a second player’s number', () => {
    expect(taggedLine('[3.14] Log: [player 2] jumped')).toEqual({
      role: 'player',
      tag: 'player 2',
      text: '[3.14] Log: jumped'
    })
  })

  it('leaves an untagged line alone', () => {
    const line = '[3.14] Log: hello from a creator script'
    expect(taggedLine(line)).toEqual({ role: null, tag: '', text: line })
  })

  it('does not mistake the engine’s own bracket for a tag', () => {
    expect(taggedLine('[3.14] Log: [gameplay] started').role).toBeNull()
  })
})

describe('taggedLines', () => {
  it('drops the strip’s machinery and keeps the rest in order', () => {
    const rows = taggedLines(['[1] Log: [you] one', `[2] Log: ${GAME_LIFE_MARKER} running`, '[3] Log: two'].join('\n'))
    expect(rows.map((r) => r.text)).toEqual(['[1] Log: one', '[3] Log: two'])
  })
})
