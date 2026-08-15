import { describe, expect, it } from 'vitest'
import { publishFailure } from './publish-error'

// The tail sdk-commands actually produced when a scene failed to typecheck —
// including tsc saying the same thing four times: a census line and the
// diagnostic, each arriving twice.
const REAL_TAIL = [
  '[94mdebug: [39m[composite] .composite: assets/scene/main.composite',
  '[2mBundle saved [1mbin/index.js[22m',
  '[2m[2/2][22m Running type checker',
  'Found 1 error in src/scripts/runtime/spawner.ts:10',
  "Error: src/scripts/runtime/spawner.ts:10:33 - error TS2307: Cannot find module '@dcl/asset-packs' or its corresponding type declarations.",
  'Found 1 error in src/scripts/runtime/spawner.ts:10',
  "src/scripts/runtime/spawner.ts:10:33 - error TS2307: Cannot find module '@dcl/asset-packs' or its corresponding type declarations."
]

describe('publishFailure', () => {
  it('reports one mistake once, however many times the compiler said it', () => {
    const { problems } = publishFailure('The build failed.', REAL_TAIL)
    expect(problems).toEqual([
      {
        path: 'src/scripts/runtime/spawner.ts',
        line: 10,
        column: 33,
        message: "Cannot find module '@dcl/asset-packs' or its corresponding type declarations."
      }
    ])
  })

  it('drops the census line — a count of errors is not an error', () => {
    const { problems, detail } = publishFailure('The build failed.', ['Found 2 errors in 2 files.'])
    expect(problems).toEqual([])
    expect(detail).toEqual([])
  })

  it('keeps the compiler sentence and drops the code, which explains nothing', () => {
    const { problems } = publishFailure('The build failed.', REAL_TAIL)
    expect(problems[0].message).not.toMatch(/TS2307|error/)
  })

  it('strips the colour codes the CLI writes', () => {
    const { problems } = publishFailure('The build failed.', REAL_TAIL)
    expect(JSON.stringify(problems)).not.toMatch(/|\[\d+m/)
  })

  it('reads an esbuild diagnostic too', () => {
    const { problems } = publishFailure('The build failed.', ['src/index.ts:19:20: ERROR: Could not resolve "./x"'])
    expect(problems).toEqual([
      { path: 'src/index.ts', line: 19, column: 20, message: 'Could not resolve "./x"' }
    ])
  })

  it('reports two different mistakes separately', () => {
    const { problems } = publishFailure('The build failed.', [
      'src/a.ts:1:1 - error TS1005: Comma expected.',
      'src/b.ts:2:2 - error TS1005: Comma expected.'
    ])
    expect(problems.map((p) => p.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it("never points at the SDK's own code", () => {
    const { problems } = publishFailure('The build failed.', [
      'node_modules/@dcl/sdk/index.ts:4:1 - error TS1005: Comma expected.'
    ])
    expect(problems).toEqual([])
  })

  it('falls back to the tail only when nothing parsed', () => {
    const { problems, detail } = publishFailure('The build failed.', ['one', 'two', 'three', 'four'])
    expect(problems).toEqual([])
    expect(detail).toEqual(['two', 'three', 'four'])
  })

  it('never shows raw lines beside a parsed problem — that is the same thing twice', () => {
    expect(publishFailure('The build failed.', REAL_TAIL).detail).toEqual([])
  })

  it('says nothing rather than something empty when the log is blank', () => {
    const { problems, detail } = publishFailure('The build failed.', ['', '   '])
    expect(problems).toEqual([])
    expect(detail).toEqual([])
  })

  it('keeps the headline the flow chose', () => {
    expect(publishFailure('Publishing stopped before it started.', []).headline).toBe(
      'Publishing stopped before it started.'
    )
  })
})
