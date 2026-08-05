import { describe, it, expect, beforeEach } from 'vitest'
import { BUILTIN_SCENE_CHECKS } from './scene-check-rules'
import { context } from './scene-check-fixtures'
import {
  allowBlockedPlay,
  consumePlayOverride,
  findingsSummary,
  playBlockingFindings,
  registerSceneCheck,
  registeredSceneChecks,
  resetSceneChecksForTest,
  runSceneChecks,
  sceneFindings,
  setSceneFindings,
  type SceneFinding
} from './scene-checks'

// --- registry ---

describe('the registry', () => {
  beforeEach(resetSceneChecksForTest)

  it('ships every documented check', () => {
    expect(registeredSceneChecks()).toEqual(BUILTIN_SCENE_CHECKS.map(([id]) => id))
  })

  it('sorts blockers before warnings', () => {
    registerSceneCheck('test-order', () => [
      { id: 'w', level: 'warning', title: 'w', detail: 'w' },
      { id: 'b', level: 'blocker', title: 'b', detail: 'b' },
      { id: 'p', level: 'play-blocker', title: 'p', detail: 'p' }
    ])
    const found = runSceneChecks(context()).filter((f) => ['w', 'b', 'p'].includes(f.id))
    expect(found.map((f) => f.id)).toEqual(['b', 'p', 'w'])
  })

  it('keeps reporting when one rule throws', () => {
    registerSceneCheck('test-throws', () => {
      throw new Error('boom')
    })
    registerSceneCheck('test-fine', () => [{ id: 'ok', level: 'warning', title: 'ok', detail: 'ok' }])
    expect(runSceneChecks(context()).some((f) => f.id === 'ok')).toBe(true)
  })
})

describe('the published findings', () => {
  beforeEach(resetSceneChecksForTest)

  const finding = (level: SceneFinding['level']): SceneFinding => ({ id: level, level, title: level, detail: level })

  it('keeps the same array when nothing changed', () => {
    setSceneFindings([finding('blocker')])
    const first = sceneFindings()
    setSceneFindings([finding('blocker')])
    expect(sceneFindings()).toBe(first)
  })

  it('blocks Play on anything that is not a warning', () => {
    setSceneFindings([finding('warning'), finding('play-blocker'), finding('blocker')])
    expect(playBlockingFindings().map((f) => f.level)).toEqual(['play-blocker', 'blocker'])
  })

  it('summarises blockers first', () => {
    expect(findingsSummary([finding('blocker'), finding('warning')]).text).toBe('1 problem blocking Play · 1 warning')
    expect(findingsSummary([finding('warning'), finding('warning')]).text).toBe('2 things to look at')
  })
})

describe('the Play override', () => {
  beforeEach(resetSceneChecksForTest)

  it('waves through exactly one Play', () => {
    allowBlockedPlay()
    expect(consumePlayOverride()).toBe(true)
    expect(consumePlayOverride()).toBe(false)
  })

  it('is off until something asks for it', () => {
    expect(consumePlayOverride()).toBe(false)
  })
})
