import { describe, expect, it } from 'vitest'
import { GAME_LIFE_MARKER } from '../play/game-life'
import {
  bothCopiesPrinted,
  gameTabLines,
  lastSeconds,
  lineSeconds,
  serverGameLines,
  taggedLine,
  taggedLines,
  type RelayedLine
} from './log-roles'

function relayed(lines: string[], at: number | null = null): RelayedLine[] {
  return lines.map((text) => ({ text, at }))
}

describe('taggedLine', () => {
  it('reads the tag the runtime wrote and takes it out of the text', () => {
    expect(taggedLine('[3.14] Log: [game] openChest: chest already open')).toEqual({
      role: 'game',
      tag: 'game',
      text: '[3.14] Log: openChest: chest already open',
      at: 3.14
    })
  })

  it('reads a screen tag', () => {
    expect(taggedLine('[3.14] Log: [you] layout(\'rock\'): boom').role).toBe('you')
  })

  it('keeps a second player’s number', () => {
    expect(taggedLine('[3.14] Log: [player 2] jumped')).toEqual({
      role: 'player',
      tag: 'player 2',
      text: '[3.14] Log: jumped',
      at: 3.14
    })
  })

  it('leaves an untagged line alone', () => {
    const line = '[3.14] Log: hello from a creator script'
    expect(taggedLine(line)).toEqual({ role: null, tag: '', text: line, at: 3.14 })
  })

  it('does not mistake the engine’s own bracket for a tag', () => {
    expect(taggedLine('[3.14] Log: [gameplay] started').role).toBeNull()
  })
})

describe('the scene clock', () => {
  it('reads the stamp the engine writes in front of a line', () => {
    expect(lineSeconds('[12.5] Log: hello')).toBe(12.5)
  })

  it('is not fooled by a tag, which is never a stamp', () => {
    expect(lineSeconds('[game] round 2 started')).toBeNull()
  })

  it('reads the newest stamp in a block', () => {
    expect(lastSeconds(['[1] Log: a', '[9.5] Log: b', 'no stamp here'].join('\n'))).toBe(9.5)
    expect(lastSeconds('nothing stamped')).toBeNull()
  })
})

describe('taggedLines', () => {
  it('drops the strip’s machinery and keeps the rest in order', () => {
    const rows = taggedLines(['[1] Log: [you] one', `[2] Log: ${GAME_LIFE_MARKER} running`, '[3] Log: two'].join('\n'))
    expect(rows.map((r) => r.text)).toEqual(['[1] Log: one', '[3] Log: two'])
  })
})

describe('serverGameLines', () => {
  it('lifts the shared copy’s lines out of the build stream and leaves the build noise', () => {
    const rows = serverGameLines(relayed(['✓ port 8004: server is up (3.1s)', '[game] round 2 started'], 4))
    expect(rows).toEqual([{ role: 'game', tag: 'game', text: 'round 2 started', at: 4 }])
  })

  it('finds a tag fused into a chunk with other output', () => {
    const rows = serverGameLines(relayed(['Bundle saved\n[game] openChest: already open\nFound 0 errors.']))
    expect(rows.map((r) => r.text)).toEqual(['openChest: already open'])
  })

  it('never shows the strip’s own machinery', () => {
    expect(serverGameLines(relayed([`${GAME_LIFE_MARKER} running`]))).toEqual([])
  })
})

describe('the Game tab’s reading order', () => {
  it('interleaves the two copies on the scene clock instead of stacking them', () => {
    const screen = ['[1] Log: [you] asked', '[3] Log: [you] saw the answer'].join('\n')
    const rows = gameTabLines(screen, relayed(['[game] answered'], 2))
    expect(rows.map((r) => r.text)).toEqual(['[1] Log: asked', 'answered', '[3] Log: saw the answer'])
  })

  it('keeps each copy’s own order when a line carries no key', () => {
    const rows = gameTabLines('[5] Log: [you] late', [
      { text: '[game] backlog one', at: null },
      { text: '[game] backlog two', at: null }
    ])
    expect(rows.map((r) => r.text)).toEqual(['backlog one', 'backlog two', '[5] Log: late'])
  })

  it('says so only when both copies printed', () => {
    expect(bothCopiesPrinted('[1] Log: [you] asked', relayed(['[game] answered'], 2))).toBe(true)
    expect(bothCopiesPrinted('', relayed(['[game] answered'], 2))).toBe(false)
    expect(bothCopiesPrinted('[1] Log: [you] asked', relayed(['✓ port 8004: server is up'], 2))).toBe(false)
  })
})
