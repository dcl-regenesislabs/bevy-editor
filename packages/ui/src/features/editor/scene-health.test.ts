// Fixture lines are verbatim from a real session (a scene with a deliberate
// `congoel.log()` in src/index.ts), ANSI escapes included.
import { beforeEach, describe, expect, it } from 'vitest'
import { errorLocation, healthForTest, parseChunk, parseLine, resetForTest, type SceneHealth } from './scene-health'

const ESC = ''
const TS_ERROR = `${ESC}[96msrc/index.ts${ESC}[0m:${ESC}[93m64${ESC}[0m:${ESC}[93m1${ESC}[0m - ${ESC}[91merror${ESC}[0m${ESC}[90m TS2304: ${ESC}[0mCannot find name 'congoel'.`
const FOUND_ONE = `[${ESC}[90m1:17:55 PM${ESC}[0m] Found 1 error. Watching for file changes.`
const FOUND_ZERO = `[${ESC}[90m1:22:01 PM${ESC}[0m] Found 0 errors. Watching for file changes.`
const FILE_CHANGED = `${ESC}[2mFile /x/src/index.ts changed, rebuilding...${ESC}[22m`
const CRASH =
  '[NODEJS] isolated-vm runtime for scene Tower of Madness terminated with error: ReferenceError: congoel is not defined'
const RELOAD = 'Change detected for scene: b64-abc, reloading...'

describe('scene-health log parsing', () => {
  beforeEach(resetForTest)

  it('reports a build error from the tsc watch summary, ANSI stripped', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    expect(healthForTest()).toEqual({
      kind: 'build',
      lines: ["src/index.ts:64:1 - error TS2304: Cannot find name 'congoel'."]
    })
  })

  it('clears the build error when a clean compile lands', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    parseLine(FILE_CHANGED)
    parseLine(FOUND_ZERO)
    expect(healthForTest()).toBeNull()
  })

  it('does not leak error lines from a previous compile cycle', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    parseLine(FILE_CHANGED)
    parseLine(TS_ERROR.replace('congoel', 'otherone'))
    parseLine(FOUND_ONE)
    expect(healthForTest()?.lines).toEqual([
      "src/index.ts:64:1 - error TS2304: Cannot find name 'otherone'."
    ])
  })

  it('reports a runtime crash and recovers on scene reload', () => {
    parseLine(CRASH)
    expect(healthForTest()).toEqual({
      kind: 'runtime',
      lines: ['ReferenceError: congoel is not defined']
    })
    parseLine(RELOAD)
    expect(healthForTest()).toBeNull()
  })

  it('a reload does not clear a build error — only a clean compile does', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    parseLine(RELOAD)
    expect(healthForTest()?.kind).toBe('build')
  })

  it('reports an esbuild hard failure at server start (no tsc summary on that path)', () => {
    parseLine('[1/2] Bundling file /x/src/index.ts')
    parseLine('✘ [ERROR] Unterminated string literal')
    parseLine('Error: Build failed with 1 error:')
    parseLine('src/index.ts:19:20: ERROR: Unterminated string literal')
    expect(healthForTest()).toEqual({
      kind: 'build',
      lines: [
        '✘ [ERROR] Unterminated string literal',
        'src/index.ts:19:20: ERROR: Unterminated string literal'
      ]
    })
  })

  it('does not stack error lines across crashed server restart attempts', () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      parseLine('[1/2] Bundling file /x/src/index.ts')
      parseLine('✘ [ERROR] Unterminated string literal')
      parseLine('Error: Build failed with 1 error:')
    }
    expect(healthForTest()?.lines).toEqual(['✘ [ERROR] Unterminated string literal'])
  })

  it('holds one stable value through the crash-restart replay storm (no flicker)', () => {
    const attempt = (): void => {
      parseLine('[1/2] Bundling file /x/src/index.ts')
      parseLine('✘ [ERROR] Unterminated string literal')
      parseChunk('Error: Build failed with 1 error:\nsrc/index.ts:19:20: ERROR: Unterminated string literal')
      parseLine('Developer: All errors thrown must be an instance of "CliError"Error: Build failed with 1 error:')
      parseLine('src/index.ts:19:20: ERROR: Unterminated string literal')
    }
    attempt()
    const settled = healthForTest()
    expect(settled?.lines).toEqual([
      '✘ [ERROR] Unterminated string literal',
      'src/index.ts:19:20: ERROR: Unterminated string literal'
    ])
    // three more identical attempts: the published object must not even change
    // identity — identical content re-published is what made the card flicker
    for (let i = 0; i < 3; i++) attempt()
    expect(healthForTest()).toBe(settled)
  })

  it('a repeated identical runtime crash does not re-publish', () => {
    parseLine(CRASH)
    const settled = healthForTest()
    parseLine(CRASH)
    expect(healthForTest()).toBe(settled)
  })

  it('parses multi-line chunks with CRLF endings (Windows pipe buffering)', () => {
    parseChunk(`${TS_ERROR}\r\n${FOUND_ONE}\r\n`)
    expect(healthForTest()?.kind).toBe('build')
    parseChunk(`${FILE_CHANGED}\r\n${FOUND_ZERO}\r\n`)
    expect(healthForTest()).toBeNull()
  })

  it('a session boundary clears errors from the previous project', () => {
    parseLine(CRASH) // towerofmadness's crash, still in main's buffer…
    expect(healthForTest()?.kind).toBe('runtime')
    parseLine('■ scene closed — stopped project dev server')
    expect(healthForTest()).toBeNull()
    parseLine(TS_ERROR)
    parseLine('▶ port 8004: starting "npm exec -- sdk-commands start" (cwd /x/genesis-plaza)')
    // …must not leak into the next scene's session
    parseLine(FOUND_ZERO)
    expect(healthForTest()).toBeNull()
  })

  it('stays healthy through normal boot chatter', () => {
    parseLine('▶ port 8004: starting "npm exec -- sdk-commands start"')
    parseLine('Bundle saved bin/index.js')
    parseLine('✓ port 8004: server is up')
    parseLine(FOUND_ZERO)
    expect(healthForTest()).toBeNull()
  })
})

const h = (kind: SceneHealth['kind'], ...lines: string[]): SceneHealth => ({ kind, lines })

describe('errorLocation', () => {
  it('reads a tsc error location', () => {
    expect(errorLocation(h('build', "src/index.ts:64:1 - error TS2304: Cannot find name 'congoel'."))).toEqual({
      path: 'src/index.ts',
      line: 64,
      column: 1
    })
  })

  it('reads an esbuild location', () => {
    expect(errorLocation(h('build', 'src/scripts/Door.ts:19:20: ERROR: Expected ")" but found "}"'))).toEqual({
      path: 'src/scripts/Door.ts',
      line: 19,
      column: 20
    })
  })

  it('reads a stack frame after a runtime crash', () => {
    const health = h('runtime', 'ReferenceError: congoel is not defined', '    at main (src/index.ts:12:5)')
    expect(errorLocation(health)).toEqual({ path: 'src/index.ts', line: 12, column: 5 })
  })

  it('skips SDK internals and finds the creator frame', () => {
    const health = h(
      'runtime',
      'ReferenceError: congoel is not defined',
      '    at node_modules/@dcl/sdk/index.js:100:2',
      '    at main (src/index.ts:12:5)'
    )
    expect(errorLocation(health)?.path).toBe('src/index.ts')
  })

  it('handles a tsx file and a leading ./', () => {
    expect(errorLocation(h('build', './src/ui.tsx:8:3 - error TS1005'))?.path).toBe('src/ui.tsx')
  })

  it('returns null when there is no location to jump to', () => {
    expect(errorLocation(h('runtime', 'ReferenceError: congoel is not defined'))).toBeNull()
    expect(errorLocation(h('build', 'Build failed with 1 error'))).toBeNull()
  })
})

// The real sequence a typo produces: tsc reports the location, the bundle saves
// ANYWAY, the scene reloads and the runtime dies naming only the identifier.
describe('a compile error that also crashes the scene', () => {
  beforeEach(resetForTest)

  it('keeps the file:line from the compile error after the crash lands', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    parseLine('[stack] Bundle saved bin/index.js')
    parseLine(CRASH)
    const h = healthForTest()
    expect(h?.kind).toBe('runtime')
    expect(h?.lines[0]).toBe('ReferenceError: congoel is not defined')
    expect(errorLocation(h as SceneHealth)).toEqual({ path: 'src/index.ts', line: 64, column: 1 })
  })

  it('still reports the crash when no compile error preceded it', () => {
    parseLine(CRASH)
    const h = healthForTest()
    expect(h?.lines).toEqual(['ReferenceError: congoel is not defined'])
    expect(errorLocation(h as SceneHealth)).toBeNull()
  })

  it('does not re-publish an identical crash', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    parseLine(CRASH)
    const first = healthForTest()
    parseLine(CRASH)
    expect(healthForTest()).toBe(first)
  })

  it('clears once the fix compiles and the scene reloads', () => {
    parseLine(TS_ERROR)
    parseLine(FOUND_ONE)
    parseLine(CRASH)
    parseLine(RELOAD)
    expect(healthForTest()).toBeNull()
  })
})
