import { describe, it, expect } from 'vitest'

// The regression this file guards: a deploy that exits 0 without ever printing
// `ready` built nothing and uploaded nothing, and must not be reported as a
// broken build. The prose is the contract here — these are the exact sentences
// the creator reads — so the assertions are on the strings themselves, and on
// `worldUnchanged`, which --multi-scene makes true for every pre-upload exit.

import { BUILD_FAILED, classifyPublishExit, looksLikeBlockingPrompt, stoppedMessage } from './publish-classify'

const WORLD = 'boedo.dcl.eth'

describe('classifyPublishExit — the incident', () => {
  it('reads exit 0 before ready as stopped, not as a failed build', () => {
    const v = classifyPublishExit({ ready: false, code: 0, sawPrompt: false }, WORLD)
    expect(v).toEqual({
      kind: 'stopped',
      reason: 'early-exit',
      message: 'Publishing stopped before it started — nothing in boedo.dcl.eth changed.',
      worldUnchanged: true
    })
  })

  it('reads the same exit as stopped when the blocking prompt was seen in the log', () => {
    const v = classifyPublishExit({ ready: false, code: 0, sawPrompt: true }, WORLD)
    expect(v.kind).toBe('stopped')
    expect(v).toMatchObject({ reason: 'prompt' })
  })

  it('still blames the prompt when the CLI exits non-zero after asking', () => {
    const v = classifyPublishExit({ ready: false, code: 1, sawPrompt: true }, WORLD)
    expect(v).toMatchObject({ kind: 'stopped', reason: 'prompt', message: stoppedMessage(WORLD) })
  })
})

describe('classifyPublishExit — the other exits', () => {
  it('is a build failure only when the child exited non-zero on its own', () => {
    const v = classifyPublishExit({ ready: false, code: 1, sawPrompt: false }, WORLD)
    expect(v).toEqual({ kind: 'failed', reason: 'build-error', message: BUILD_FAILED, worldUnchanged: true })
  })

  it('treats a signal kill as stopped — a killed process built nothing either', () => {
    const v = classifyPublishExit({ ready: false, code: null, sawPrompt: false }, WORLD)
    expect(v).toMatchObject({ kind: 'stopped', reason: 'signal', message: stoppedMessage(WORLD) })
  })

  it('ignores every exit once the linker was ready — the upload owns that outcome', () => {
    for (const code of [0, 1, null]) {
      expect(classifyPublishExit({ ready: true, code, sawPrompt: false }, WORLD)).toEqual({
        kind: 'ignored',
        reason: 'uploading'
      })
    }
    expect(classifyPublishExit({ ready: true, code: 0, sawPrompt: true }, WORLD)).toMatchObject({ kind: 'ignored' })
  })
})

describe('classifyPublishExit — what every pre-upload verdict promises', () => {
  it('asserts the world is unchanged on every exit that never reached the upload', () => {
    const cases: Array<{ code: number | null; sawPrompt: boolean }> = [
      { code: 0, sawPrompt: false },
      { code: 0, sawPrompt: true },
      { code: 2, sawPrompt: false },
      { code: null, sawPrompt: false }
    ]
    for (const c of cases) {
      const v = classifyPublishExit({ ready: false, ...c }, WORLD)
      expect(v.kind === 'ignored' ? null : v.worldUnchanged).toBe(true)
    }
  })

  it('names the world the creator picked, verbatim', () => {
    const v = classifyPublishExit({ ready: false, code: 0, sawPrompt: false }, 'cozyfarm.dcl.eth')
    expect(v).toMatchObject({ message: 'Publishing stopped before it started — nothing in cozyfarm.dcl.eth changed.' })
  })
})

describe('looksLikeBlockingPrompt', () => {
  it('recognises the confirm the CLI can never get an answer to', () => {
    expect(looksLikeBlockingPrompt('There are scenes deployed in this world. Continue? (y/N) ')).toBe(true)
    expect(looksLikeBlockingPrompt('Continue? (Y/n)')).toBe(true)
    expect(looksLikeBlockingPrompt('proceed ( y / n )')).toBe(true)
  })

  it('leaves ordinary build output alone', () => {
    expect(looksLikeBlockingPrompt('Building scene in /Users/boedo/scenes/arena')).toBe(false)
    expect(looksLikeBlockingPrompt('ready at http://localhost:5173')).toBe(false)
    expect(looksLikeBlockingPrompt('found 0 vulnerabilities')).toBe(false)
  })
})
