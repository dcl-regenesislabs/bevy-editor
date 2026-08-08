import { describe, expect, it } from 'vitest'
import { GAME_LIFE_MARKER, gameStrip, isGameLifeLine, parseGameLife } from './game-life'

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

describe('gameStrip', () => {
  it('renders the four states', () => {
    expect(gameStrip('running', 0).text).toBe('● Game running')
    expect(gameStrip('waking', 12.4).text).toBe('◐ Waking… 12s')
    expect(gameStrip('asleep', 90).text).toBe('○ Game asleep — wakes when a player arrives.')
    expect(gameStrip('unreachable', 30).text).toBe('✕ Can’t reach the Multiplayer Server —')
  })

  it('offers the logs only where they are the next gesture', () => {
    expect(gameStrip('unreachable', 30).logs).toBe(true)
    expect(gameStrip('running', 0).logs).toBe(false)
    expect(gameStrip('asleep', 0).logs).toBe(false)
  })

  it('colours running green and unreachable red', () => {
    expect(gameStrip('running', 0).tone).toBe('server')
    expect(gameStrip('unreachable', 0).tone).toBe('danger')
  })
})

describe('isGameLifeLine', () => {
  it('marks the machinery the Game tab must not show', () => {
    expect(isGameLifeLine(line('running'))).toBe(true)
    expect(isGameLifeLine('[3.2] Log: [you] layout(\'rock\') failed')).toBe(false)
  })
})
