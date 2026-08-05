// The Round Loop is the only clock in the game, so every other prefab inherits its
// mistakes. These tests pin the two properties that make it trustworthy: a phase
// starts at the previous phase's DEADLINE (a hitched tick can never push the
// schedule out), and a tuple that comes back from Storage or off the wire is
// repaired field by field rather than believed.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  advance,
  catchUp,
  clampSeconds,
  countdownSeconds,
  durationsFromSeconds,
  formatCountdown,
  holdAt,
  isReady,
  phaseEndsAtMs,
  phaseKind,
  phaseLabel,
  remainingMs,
  requiredPlayers,
  sanitizeTuple,
  startRound,
  waveNumber
} from '../prefabs/round-loop/scripts/pure/phases'

const FOLDER = path.resolve(__dirname, '../prefabs/round-loop')
const PARAMS = ['lobbySeconds', 'waveSeconds', 'intermissionSeconds', 'minPlayers', 'soloMode']

function read(rel: string): string {
  return fs.readFileSync(path.join(FOLDER, rel), 'utf8')
}

const durations = durationsFromSeconds(30, 90, 20)

describe('round-loop phases', () => {
  it('maps the phase index onto lobby, waves and intermissions', () => {
    expect(phaseKind(0)).toBe('lobby')
    expect(phaseKind(1)).toBe('wave')
    expect(phaseKind(2)).toBe('intermission')
    expect(phaseKind(3)).toBe('wave')
    expect(waveNumber(3)).toBe(2)
    expect(waveNumber(2)).toBe(0)
    expect(phaseLabel(5)).toBe('WAVE 3')
    expect(phaseLabel(0)).toBe('LOBBY')
  })

  it('starts each phase at the previous deadline, not at "now"', () => {
    const lobby = startRound(7, 1000, 1)
    const wave = advance(lobby, durations, 1)
    expect(wave.phaseStartMs).toBe(1000 + durations.lobbyMs)
    expect(advance(wave, durations, 1).phaseStartMs).toBe(1000 + durations.lobbyMs + durations.waveMs)
    expect(wave.seed).toBe(7)
    expect(wave.phase).toBe(1)
  })

  it('pins the config version of the phase being entered', () => {
    expect(advance(startRound(1, 0, 3), durations, 4).configVersion).toBe(4)
  })

  // Cold start: the process died, the tuple did not. Two players who reload at
  // different moments must land on the same phase.
  it('fast-forwards an expired tuple and reports when it is too old to replay', () => {
    const start = startRound(1, 0, 0)
    const now = durations.lobbyMs + durations.waveMs + 5
    const caught = catchUp(start, durations, now, 512, 0)
    expect(caught).toMatchObject({ steps: 2, exhausted: false })
    expect(caught.tuple.phase).toBe(2)
    expect(caught.tuple.phaseStartMs).toBe(durations.lobbyMs + durations.waveMs)
    expect(catchUp(start, durations, now, 1, 0).exhausted).toBe(true)
    expect(catchUp(start, durations, 5, 512, 0).steps).toBe(0)
  })

  it('counts whole seconds down to zero and no further', () => {
    const wave = { seed: 1, phase: 1, phaseStartMs: 0, configVersion: 0 }
    expect(countdownSeconds(wave, durations, 0)).toBe(90)
    expect(countdownSeconds(wave, durations, 89_100)).toBe(1)
    expect(countdownSeconds(wave, durations, 300_000)).toBe(0)
    expect(remainingMs(wave, durations, 300_000)).toBe(0)
    expect(formatCountdown(90)).toBe('1:30')
    expect(formatCountdown(5)).toBe('0:05')
    expect(formatCountdown(-3)).toBe('0:00')
  })

  it('holds a parked phase at full length', () => {
    const held = holdAt(startRound(1, 0, 0), 50_000)
    expect(phaseEndsAtMs(held, durations)).toBe(50_000 + durations.lobbyMs)
    expect(held.phase).toBe(0)
  })

  it('lets soloMode override minPlayers outright', () => {
    expect(requiredPlayers(4, true)).toBe(1)
    expect(requiredPlayers(4, false)).toBe(4)
    expect(requiredPlayers(0, false)).toBe(1)
    expect(isReady(1, 4, true)).toBe(true)
    expect(isReady(1, 4, false)).toBe(false)
    expect(isReady(4, 4, false)).toBe(true)
  })

  it('clamps unusable durations instead of spinning the machine', () => {
    expect(clampSeconds(0)).toBe(1)
    expect(clampSeconds(Number.NaN)).toBe(1)
    expect(durationsFromSeconds(0, -5, 99_999)).toEqual({
      lobbyMs: 1000,
      waveMs: 1000,
      intermissionMs: 3_600_000
    })
  })

  it('repairs a corrupt restored tuple field by field', () => {
    const fallback = startRound(9, 100, 2)
    expect(sanitizeTuple(null, fallback)).toEqual(fallback)
    expect(sanitizeTuple('nonsense', fallback)).toEqual(fallback)
    expect(sanitizeTuple({ seed: 4, phase: -3, phaseStartMs: 'x', configVersion: 1 }, fallback)).toEqual({
      seed: 4,
      phase: 0,
      phaseStartMs: 100,
      configVersion: 1
    })
  })
})

describe('round-loop folder', () => {
  it('keeps the phase component server-owned and derives time from the server clock', () => {
    const source = read('scripts/round-loop.ts')
    expect(source).toContain('validate: () => false')
    expect(source).toContain("createRpc('round')")
    expect(source).toContain('getServerTime()')
    // Identity is context.from, the wallet the transport authenticated.
    expect(source).not.toMatch(/body\.address|body\.from|body\.player/)
  })

  it('documents every param the guide has to name', () => {
    const guide = read('ai.md')
    const source = read('scripts/round-loop.ts')
    for (const param of PARAMS) {
      expect(source, param).toContain(`public ${param}`)
      expect(new RegExp(`\\b${param}\\b`).test(guide), `ai.md never mentions ${param}`).toBe(true)
    }
  })
})
