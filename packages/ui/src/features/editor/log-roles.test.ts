import { describe, expect, it } from 'vitest'
import { GAME_LIFE_MARKER } from '../play/game-life'
import { PROBLEM_MARKER, allProblemLines, gameTabLines, lastSeconds, type LogLine, type RelayedLine } from './log-roles'

function relayed(lines: string[], at: number | null = null): RelayedLine[] {
  return lines.map((text) => ({ text, at }))
}

function rows(sceneLogs: string, lines: RelayedLine[] = []): LogLine[] {
  return gameTabLines(sceneLogs, lines)
}

// The tab keeps blank lines — a stack trace reads by them — so a case about the
// build stream alone reads past the one an empty client log leaves behind.
function serverRows(lines: RelayedLine[]): LogLine[] {
  return gameTabLines('', lines).filter((row) => row.text !== '')
}

describe('the tag a row carries', () => {
  it('reads the tag the runtime wrote and takes it out of the text', () => {
    expect(rows('[3.14] Log: [you] openChest: chest already open')).toEqual([
      { role: 'you', text: '[3.14] Log: openChest: chest already open', at: 3.14, error: false }
    ])
  })

  it('reads a Multiplayer Server tag', () => {
    expect(rows('[3.14] Log: [server] round 2 started')[0].role).toBe('server')
  })

  it('leaves an untagged line alone', () => {
    const line = '[3.14] Log: hello from a creator script'
    expect(rows(line)).toEqual([{ role: null, text: line, at: 3.14, error: false }])
  })

  it('leaves the retired tag untagged rather than dropping the line', () => {
    expect(rows('[3.14] Log: [game] round 2 started')[0]).toMatchObject({
      role: null,
      text: '[3.14] Log: [game] round 2 started'
    })
  })

  it('does not mistake the engine’s own bracket for a tag', () => {
    expect(rows('[3.14] Log: [gameplay] started')[0].role).toBeNull()
  })
})

describe('the engine’s Error verb', () => {
  it('marks the row a creator has to act on', () => {
    expect(rows('[3.14] Error: [server] state.score: setState every frame — coalesced.')[0]).toEqual({
      role: 'server',
      text: '[3.14] Error: state.score: setState every frame — coalesced.',
      at: 3.14,
      error: true
    })
  })

  it('leaves a routine line alone, verb or no verb', () => {
    expect(rows('[3.14] Log: [you] popup shown')[0].error).toBe(false)
    expect(rows('a line with no verb at all')[0].error).toBe(false)
  })

  it('is not fooled by the word appearing inside a message', () => {
    expect(rows('[3.14] Log: [you] Error: is what the script printed')[0].error).toBe(false)
  })

  it('hands the strip the error rows as written, so a repeat poll counts once', () => {
    const logs = ['[1] Log: [you] fine', '[2] Error: [you] a.b: dropped', '[3] Error: hand-rolled'].join('\n')
    expect(allProblemLines(logs, [])).toEqual(['[2] Error: a.b: dropped', '[3] Error: hand-rolled'])
    expect(allProblemLines('[1] Log: [you] fine', [])).toEqual([])
  })
})

// The Multiplayer Server prints through its own process, not the engine console,
// so no verb is ever in front of these lines — and the shell relays its stdout
// and stderr down one channel, so console.error and console.log arrive
// identical. The mark the runtime writes is the only thing that tells one from
// the other.
describe('a card the Multiplayer Server printed', () => {
  const card = `${PROBLEM_MARKER} [server] round: 'round' from 0x1 dropped — too many per second.`

  it('counts as a problem even though no engine verb reaches it', () => {
    expect(serverRows(relayed([card]))[0].error).toBe(true)
    expect(allProblemLines('', relayed([card]))).toEqual(["round: 'round' from 0x1 dropped — too many per second."])
  })

  it('shows the sentence the runtime wrote, never the mark', () => {
    expect(serverRows(relayed([card]))[0].text).toBe("round: 'round' from 0x1 dropped — too many per second.")
  })

  it('leaves a routine server notice uncounted, colon or no colon', () => {
    const notices = [
      '[server] game.state.scores is over 512 bytes — split it into smaller keys.',
      '[server] Game Flow: The round hit its time ceiling — call game.newRound() from your script, or raise the ceiling.',
      '[server] openChest: already open'
    ]
    expect(serverRows(relayed(notices)).map((row) => row.error)).toEqual([false, false, false])
    expect(allProblemLines('', relayed(notices))).toEqual([])
  })

  it('reads the mark on this player’s client too, where the engine also stamps a verb', () => {
    const line = `[3.14] Log: ${PROBLEM_MARKER} [you] state.score: synced state arrived with invalid JSON.`
    expect(rows(line)[0]).toEqual({
      role: 'you',
      text: '[3.14] Log: state.score: synced state arrived with invalid JSON.',
      at: 3.14,
      error: true
    })
  })
})

describe('the scene clock', () => {
  it('reads the newest stamp in a block', () => {
    expect(lastSeconds(['[1] Log: a', '[9.5] Log: b', 'no stamp here'].join('\n'))).toBe(9.5)
    expect(lastSeconds('nothing stamped')).toBeNull()
  })

  it('is not fooled by a tag, which is never a stamp', () => {
    expect(lastSeconds('[server] round 2 started')).toBeNull()
  })
})

describe('the Game tab’s rows', () => {
  it('drops the strip’s machinery and keeps the rest in order', () => {
    const logs = ['[1] Log: [you] one', `[2] Log: ${GAME_LIFE_MARKER} running`, '[3] Log: two'].join('\n')
    expect(rows(logs).map((r) => r.text)).toEqual(['[1] Log: one', '[3] Log: two'])
    expect(serverRows(relayed([`${GAME_LIFE_MARKER} running`]))).toEqual([])
  })

  it('lifts the shared copy’s lines out of the build stream and leaves the build noise', () => {
    const lines = relayed(['✓ port 8004: server is up (3.1s)', '[server] round 2 started'], 4)
    expect(serverRows(lines)).toEqual([{ role: 'server', text: 'round 2 started', at: 4, error: false }])
  })

  it('finds a tag fused into a chunk with other output', () => {
    const chunk = relayed(['Bundle saved\n[server] openChest: already open\nFound 0 errors.'])
    expect(serverRows(chunk).map((r) => r.text)).toEqual(['openChest: already open'])
  })

  it('interleaves the two copies on the scene clock instead of stacking them', () => {
    const screen = ['[1] Log: [you] asked', '[3] Log: [you] saw the answer'].join('\n')
    const merged = rows(screen, relayed(['[server] answered'], 2))
    expect(merged.map((r) => r.text)).toEqual(['[1] Log: asked', 'answered', '[3] Log: saw the answer'])
  })

  it('keeps each copy’s own order when a line carries no key', () => {
    const merged = rows('[5] Log: [you] late', [
      { text: '[server] backlog one', at: null },
      { text: '[server] backlog two', at: null }
    ])
    expect(merged.map((r) => r.text)).toEqual(['backlog one', 'backlog two', '[5] Log: late'])
  })
})
