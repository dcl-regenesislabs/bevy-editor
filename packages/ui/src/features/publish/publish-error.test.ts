import { describe, expect, it } from 'vitest'
import { publishFailure } from './publish-error'

// The tail sdk-commands actually produced when a scene failed to typecheck.
const REAL_TAIL = [
  '\u001b[94mdebug: \u001b[39m[composite] .composite: assets/scene/main.composite',
  '\u001b[2mBundle saved \u001b[1mbin/index.js\u001b[22m',
  '\u001b[2m[2/2]\u001b[22m Running type checker',
  "\u001b[96msrc/scripts/runtime/spawner.ts\u001b[0m:\u001b[93m10\u001b[0m:\u001b[93m33\u001b[0m - \u001b[91merror\u001b[0m \u001b[90mTS2307: \u001b[0mCannot find module './flag'"
]

describe('publishFailure', () => {
  it('strips the colour codes the CLI writes', () => {
    const { detail } = publishFailure('The build failed.', REAL_TAIL)
    expect(detail.join('\n')).not.toMatch(/\u001b|\[\d+m/)
  })

  it('keeps the line that names the problem and drops the progress chatter', () => {
    const { detail } = publishFailure('The build failed.', REAL_TAIL)
    expect(detail).toEqual(["src/scripts/runtime/spawner.ts:10:33 - error TS2307: Cannot find module './flag'"])
  })

  it('falls back to the tail when nothing looks like an error', () => {
    const { detail } = publishFailure('The build failed.', ['one', 'two', 'three', 'four'])
    expect(detail).toEqual(['two', 'three', 'four'])
  })

  it('says nothing rather than something empty when the log is blank', () => {
    expect(publishFailure('The build failed.', ['', '   ']).detail).toEqual([])
  })

  it('keeps the headline the flow chose', () => {
    expect(publishFailure('Publishing stopped before it started.', []).headline).toBe(
      'Publishing stopped before it started.'
    )
  })
})
