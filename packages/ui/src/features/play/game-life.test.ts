import { describe, expect, it } from 'vitest'
import {
  GAME_LIFE_MARKER,
  GAME_LOG_TAIL,
  GAME_POLL_MS,
  GAME_SILENT_MS,
  gameLife,
  gameStrip,
  isGameLifeLine,
  parseGameLife,
  serverPresence,
  silentLife,
  withProblems
} from './game-life'

const line = (state: string): string => `[3.14] Log: ${GAME_LIFE_MARKER} ${state}`

describe('parseGameLife', () => {
  it('reads the last state the scene reported', () => {
    expect(parseGameLife([line('waking'), '[3.2] Log: hello', line('running')].join('\n'))).toBe('running')
  })

  it('answers null for a scene that never reported one', () => {
    expect(parseGameLife('[1.0] Log: hello\n[2.0] Log: world')).toBeNull()
  })

  it('reads degraded as running — the lagging state was cut', () => {
    expect(parseGameLife(line('degraded'))).toBe('running')
  })

  it('ignores a rung it does not know', () => {
    expect(parseGameLife([line('running'), line('sideways')].join('\n'))).toBe('running')
  })
})

describe('silentLife', () => {
  it('waits before blaming anyone — a game takes seconds to wake', () => {
    expect(silentLife(0)).toBe('waking')
    expect(silentLife(GAME_SILENT_MS - 1)).toBe('waking')
  })

  it('calls a game that never reported out of reach', () => {
    expect(silentLife(GAME_SILENT_MS)).toBe('unreachable')
  })
})

describe('serverPresence', () => {
  it('reads the auth-server API as a server this scene can reach', () => {
    expect(serverPresence({ authServer: true, installed: true })).toBe('present')
  })

  it('reads an installed SDK without the API as no server at all', () => {
    expect(serverPresence({ authServer: false, installed: true })).toBe('absent')
  })

  it('holds its tongue when the scene has nothing installed yet', () => {
    expect(serverPresence({ authServer: false, installed: false })).toBe('unknown')
    expect(serverPresence(null)).toBe('unknown')
  })
})

describe('gameLife', () => {
  it('names the missing server instead of blaming a fault that cannot exist', () => {
    expect(gameLife(null, 0, 'absent')).toBe('no-server')
    expect(gameLife(null, GAME_SILENT_MS, 'absent')).toBe('no-server')
    expect(gameLife('unreachable', 0, 'absent')).toBe('no-server')
  })

  it('keeps unreachable where a server really should be answering', () => {
    expect(gameLife(null, GAME_SILENT_MS, 'present')).toBe('unreachable')
    expect(gameLife('unreachable', 0, 'present')).toBe('unreachable')
  })

  it('says nothing new while the answer is unknown', () => {
    expect(gameLife(null, 0, 'unknown')).toBe('waking')
    expect(gameLife(null, GAME_SILENT_MS, 'unknown')).toBe('unreachable')
  })

  it('believes the scene over the probe once the game speaks', () => {
    expect(gameLife('running', 0, 'absent')).toBe('running')
    expect(gameLife('asleep', 0, 'absent')).toBe('asleep')
  })
})

describe('gameStrip', () => {
  it('renders the five states', () => {
    expect(gameStrip('running', 0).text).toBe('● Game running')
    expect(gameStrip('waking', 12.4).text).toBe('◐ Waking… 12s')
    expect(gameStrip('asleep', 90).text).toBe('○ Game asleep — wakes when a player arrives.')
    expect(gameStrip('unreachable', 30).text).toBe('✕ Can’t reach the Multiplayer Server —')
    expect(gameStrip('no-server', 30).text).toBe('○ This scene has no Multiplayer Server — place a Game Flow item to add one.')
  })

  it('offers the logs only where they are the next gesture', () => {
    expect(gameStrip('unreachable', 30).logs).toBe(true)
    expect(gameStrip('running', 0).logs).toBe(false)
    expect(gameStrip('asleep', 0).logs).toBe(false)
    expect(gameStrip('no-server', 0).logs).toBe(false)
  })

  it('colours running green and unreachable red, and leaves the missing server neutral', () => {
    expect(gameStrip('running', 0).tone).toBe('server')
    expect(gameStrip('unreachable', 0).tone).toBe('danger')
    expect(gameStrip('no-server', 0).tone).toBe('default')
  })
})

describe('withProblems', () => {
  it('says how many problems printed, and offers the logs that explain them', () => {
    const one = withProblems(gameStrip('running', 0), 1)
    expect(one.text).toBe('● Game running · 1 problem')
    expect(one.logs).toBe(true)
    expect(one.tone).toBe('danger')
    expect(withProblems(gameStrip('running', 0), 2).text).toBe('● Game running · 2 problems')
  })

  it('leaves a quiet game alone', () => {
    expect(withProblems(gameStrip('running', 0), 0)).toEqual(gameStrip('running', 0))
  })

  it('does not talk over a state that already sends the creator to the logs', () => {
    expect(withProblems(gameStrip('unreachable', 30), 3)).toEqual(gameStrip('unreachable', 30))
  })
})

describe('the console tail the strip reads', () => {
  // The scene prints one line per transition, so the tail has to outlive a poll
  // window's worth of output — not merely hold the last few lines.
  it('is far deeper than a poll window of ordinary output', () => {
    expect(GAME_LOG_TAIL).toBeGreaterThanOrEqual((GAME_POLL_MS / 1000) * 100)
  })
})

describe('isGameLifeLine', () => {
  it('marks the machinery the Game tab must not show', () => {
    expect(isGameLifeLine(line('running'))).toBe(true)
    expect(isGameLifeLine('[3.2] Log: [you] layout(\'rock\') failed')).toBe(false)
  })
})
