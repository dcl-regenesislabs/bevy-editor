// Pins the two strings the deploy probe reads out of the installed CLI, and the
// decision each of the three shapes produces.
//
// SDK_7_25_1 below is a verbatim excerpt of @dcl/sdk-commands
// 7.25.1-31507635064.commit-7a85254 dist/commands/deploy/index.js. If a version
// bump renames `--multi-scene` or rewords the confirmation prompt, this suite
// fails loudly — the alternative is the probe silently reading "unsupported"
// and every publish going back to wiping the world it deploys into.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildDeployArgs, declineStdin, deployCapability } from './publish-args'

// --- fixtures: real dist excerpts -------------------------------------------

// 7.25.1: declares the flag AND still carries the prompt behind it
const SDK_7_25_1 = `
const args = (0, args_1.declareArgs)({
    '--dir': String,
    '--target': String,
    '-t': '--target',
    '--target-content': String,
    '-tc': '--target-content',
    '--skip-validations': Boolean,
    '--skip-version-checks': Boolean,
    '--skip-build': Boolean,
    '--https': Boolean,
    '--force-upload': Boolean,
    '--yes': Boolean,
    '--no-browser': Boolean,
    '-b': '--no-browser',
    '--port': Number,
    '-p': '--port',
    '--programmatic': Boolean,
    '--multi-scene': Boolean
});
    let needsDelete = false;
    if (isWorld && !multiScene && worldName) {
        options.components.logger.warn('Deploying without --multi-scene will DELETE all existing scenes in world first.');
        if (!autoYes) {
            const confirmed = await (0, utils_1.promptUser)('Continue? (y/N) ');
            if (!confirmed) {
                throw new error_1.CliError('DEPLOY_CANCELLED', 'Deployment cancelled by user.');
            }
        }
        needsDelete = true;
    }
`

// the prompt shipped before the flag did: no way to opt out of the wipe
const SDK_PROMPT_ONLY = SDK_7_25_1.split('\n')
  .filter((l) => !l.includes('--multi-scene'))
  .join('\n')

// old enough that the destructive pre-flight does not exist at all
const SDK_OLD = `
const args = (0, args_1.declareArgs)({
    '--dir': String,
    '--target-content': String,
    '--no-browser': Boolean,
    '--port': Number
});
`

// --- helpers ----------------------------------------------------------------

const dirs: string[] = []

// a project whose node_modules carries a deploy command with `source`
function project(source: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-args-'))
  dirs.push(dir)
  if (source !== null) {
    const pkg = path.join(dir, 'node_modules', '@dcl', 'sdk-commands', 'dist')
    fs.mkdirSync(path.join(pkg, 'commands', 'deploy'), { recursive: true })
    fs.writeFileSync(path.join(pkg, 'index.js'), '// entry point')
    fs.writeFileSync(path.join(pkg, 'commands', 'deploy', 'index.js'), source)
  }
  return dir
}

const argsFor = (dir: string): string[] =>
  buildDeployArgs({
    projectDir: dir,
    port: 4242,
    targetContent: 'https://worlds-content-server.decentraland.org',
    capability: deployCapability(dir)
  })

// --- suites -----------------------------------------------------------------

describe('the pinned 7.25.1 markers', () => {
  it('declares the flag exactly as the probe spells it', () => {
    expect(SDK_7_25_1).toContain("'--multi-scene': Boolean")
  })

  it('asks to confirm exactly as the probe spells it', () => {
    expect(SDK_7_25_1).toContain("promptUser)('Continue? (y/N) ')")
  })

  it('gates the whole destructive block on the flag', () => {
    expect(SDK_7_25_1).toContain('if (isWorld && !multiScene && worldName) {')
  })
})

describe('deployCapability', () => {
  it('reads 7.25.1 as additive — the flag is there', () => {
    expect(deployCapability(project(SDK_7_25_1))).toEqual({ kind: 'additive' })
  })

  it('reads a prompt without the flag as destructive', () => {
    expect(deployCapability(project(SDK_PROMPT_ONLY))).toEqual({ kind: 'destructive' })
  })

  it('reads a build with neither marker as legacy-additive', () => {
    expect(deployCapability(project(SDK_OLD))).toEqual({ kind: 'legacy-additive' })
  })

  it('reads an uninstalled project as unknown, and does not cache that answer', () => {
    const dir = project(null)
    expect(deployCapability(dir)).toEqual({ kind: 'unknown' })
    const pkg = path.join(dir, 'node_modules', '@dcl', 'sdk-commands', 'dist')
    fs.mkdirSync(path.join(pkg, 'commands', 'deploy'), { recursive: true })
    fs.writeFileSync(path.join(pkg, 'index.js'), '// entry point')
    fs.writeFileSync(path.join(pkg, 'commands', 'deploy', 'index.js'), SDK_7_25_1)
    expect(deployCapability(dir)).toEqual({ kind: 'additive' })
  })

  it('re-reads the same folder after the creator updates the SDK in it', () => {
    // the blocked screen's own call to action is `npm i @dcl/sdk@latest` in this
    // very folder; a cache keyed on the path alone would keep telling them to do
    // the thing they just did until the app restarts
    const dir = project(SDK_PROMPT_ONLY)
    expect(deployCapability(dir)).toEqual({ kind: 'destructive' })
    const deploy = path.join(dir, 'node_modules', '@dcl', 'sdk-commands', 'dist', 'commands', 'deploy', 'index.js')
    fs.writeFileSync(deploy, SDK_7_25_1)
    fs.utimesSync(deploy, new Date(), new Date(Date.now() + 60_000))
    expect(deployCapability(dir)).toEqual({ kind: 'additive' })
  })

  it('finds the markers in nested files too', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-args-'))
    dirs.push(dir)
    const deep = path.join(dir, 'node_modules', '@dcl', 'sdk-commands', 'dist', 'commands', 'deploy', 'nested')
    fs.mkdirSync(deep, { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', '@dcl', 'sdk-commands', 'dist', 'index.js'), '// entry')
    fs.writeFileSync(path.join(deep, 'utils.js'), SDK_7_25_1)
    expect(deployCapability(dir)).toEqual({ kind: 'additive' })
  })
})

describe('buildDeployArgs', () => {
  it('appends --multi-scene only for an additive CLI', () => {
    expect(argsFor(project(SDK_7_25_1))).toContain('--multi-scene')
    expect(argsFor(project(SDK_PROMPT_ONLY))).not.toContain('--multi-scene')
    expect(argsFor(project(SDK_OLD))).not.toContain('--multi-scene')
    expect(argsFor(project(null))).not.toContain('--multi-scene')
  })

  it('never passes --yes, --force-upload or --skip-version-checks', () => {
    for (const source of [SDK_7_25_1, SDK_PROMPT_ONLY, SDK_OLD, null]) {
      const args = argsFor(project(source))
      expect(args).not.toContain('--yes')
      expect(args).not.toContain('-y')
      expect(args).not.toContain('--force-upload')
      expect(args).not.toContain('--skip-version-checks')
    }
  })

  it('keeps the npm exec shape and the flags the CLI declares', () => {
    const dir = project(SDK_7_25_1)
    expect(argsFor(dir)).toEqual([
      'exec',
      '--',
      'sdk-commands',
      'deploy',
      '--dir',
      dir,
      '--port',
      '4242',
      '--no-browser',
      '--target-content',
      'https://worlds-content-server.decentraland.org',
      '--multi-scene'
    ])
  })
})

describe('declineStdin', () => {
  it('answers no and closes the pipe', () => {
    const written: string[] = []
    const stdin = { on: (): void => {}, end: (chunk: string): void => void written.push(chunk) }
    declineStdin(stdin as unknown as NodeJS.WritableStream)
    expect(written).toEqual(['n\n'])
  })

  it('registers an error listener before writing, and swallows a dead pipe', () => {
    const events: string[] = []
    const stdin = {
      on: (name: string): void => void events.push(name),
      end: (): void => {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
      }
    }
    expect(() => declineStdin(stdin as unknown as NodeJS.WritableStream)).not.toThrow()
    expect(events).toEqual(['error'])
  })

  it('is a no-op without a pipe', () => {
    expect(() => declineStdin(null)).not.toThrow()
    expect(() => declineStdin(undefined)).not.toThrow()
  })
})

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})
