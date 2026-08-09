// The pure half of scripts/sync-runtime-modules.mjs — which runtime modules a prefab
// script asks for, and what that pulls in transitively — plus the two guards the
// script exists to enforce, run against the real repo: the runtime digest, and the
// `minRuntime` a prefab declares.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  digestInputs,
  digestOf,
  digestUpdate,
  importSpecifiers,
  parseRuntimeVersion,
  plan,
  resolveSpecifier,
  runtimeImportsOf,
  runtimeVersion,
  setMinRuntime,
  stampActions,
  stripCommentsAndStrings,
  transitiveModules
} from './sync-runtime-modules.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('importSpecifiers', () => {
  it('reads every static form', () => {
    const text = [
      "import { type Entity } from '@dcl/sdk/ecs'",
      'import defaults from "~runtime/spawner"',
      "import '~runtime/side-effect'",
      "export { pool } from '~runtime/pool'",
      "export * from '~runtime/all'"
    ].join('\n')
    expect(importSpecifiers(text)).toEqual([
      '@dcl/sdk/ecs',
      '~runtime/spawner',
      '~runtime/pool',
      '~runtime/all',
      '~runtime/side-effect'
    ])
  })

  it('ignores the example imports prefab scripts document themselves with', () => {
    const text = [
      "// import { emitZone } from '~runtime/zoneBus'",
      '/*',
      " * import { pool } from '~runtime/spawner'",
      ' */',
      "import { real } from '~runtime/rpc'"
    ].join('\n')
    expect(importSpecifiers(text)).toEqual(['~runtime/rpc'])
  })

  it('does not follow dynamic import(), which is banned repo-wide', () => {
    expect(importSpecifiers("const m = await import('~runtime/spawner')")).toEqual([])
  })

  it('leaves a url inside a string alone', () => {
    const text = ["const docs = 'https://example.com//x'", "import { a } from '~runtime/a'"].join('\n')
    expect(importSpecifiers(text)).toEqual(['~runtime/a'])
  })
})

describe('stripCommentsAndStrings', () => {
  it('keeps string bodies, since specifiers live in them', () => {
    expect(stripCommentsAndStrings("const a = 'x' // note")).toBe("const a = 'x' ")
  })

  it('drops an unterminated block comment to the end of file', () => {
    expect(stripCommentsAndStrings('code\n/* trailing')).toBe('code\n')
  })
})

describe('resolveSpecifier', () => {
  it('resolves against the importing file, not the root', () => {
    expect(resolveSpecifier('zoneBus.ts', './pure/zoneRegistry')).toBe('pure/zoneRegistry.ts')
    expect(resolveSpecifier('pure/phase.ts', '../schedule')).toBe('schedule.ts')
  })

  it('keeps an explicit .ts extension instead of doubling it', () => {
    expect(resolveSpecifier('a.ts', './b.ts')).toBe('b.ts')
  })

  it('passes bare package names through as not-relative', () => {
    expect(resolveSpecifier('a.ts', '@dcl/sdk/ecs')).toBeNull()
  })

  it('refuses a specifier that escapes the masters folder', () => {
    expect(() => resolveSpecifier('a.ts', '../../../secrets')).toThrow(/escapes/)
  })
})

describe('runtimeImportsOf', () => {
  it('takes only the ~runtime/ alias', () => {
    const text = [
      "import { type Entity } from '@dcl/sdk/ecs'",
      "import { emitZone } from '~runtime/zoneBus'",
      "import { Membership } from '~runtime/pure/membership'",
      "import { insideZone } from './zone-geometry'"
    ].join('\n')
    expect(runtimeImportsOf(text)).toEqual(['zoneBus.ts', 'pure/membership.ts'])
  })

  it('reads the same from a nested script, since the alias carries no depth', () => {
    expect(runtimeImportsOf("import { createRpc } from '~runtime/rpc'")).toEqual(['rpc.ts'])
  })

  it('reports each module once however many times it is imported', () => {
    const text = ["import { a } from '~runtime/rpc'", "import { b } from '~runtime/rpc'"].join('\n')
    expect(runtimeImportsOf(text)).toEqual(['rpc.ts'])
  })

  it('leaves a relative import alone: it is the prefab folder’s own file', () => {
    expect(runtimeImportsOf("import { a } from './runtime/a'")).toEqual([])
  })

  it('does not mistake a sibling alias that starts with runtime', () => {
    expect(runtimeImportsOf("import { a } from '~runtime-helpers/a'")).toEqual([])
  })
})

describe('transitiveModules', () => {
  const masters = {
    'zoneBus.ts': "import { ZoneRegistry } from './pure/zoneRegistry'",
    'rpc.ts': "import { PendingMap } from './pure/pending'\nimport { ZoneRegistry } from './pure/zoneRegistry'",
    'pure/zoneRegistry.ts': 'export class ZoneRegistry {}',
    'pure/pending.ts': 'export class PendingMap {}',
    'unused.ts': "import { nothing } from './pure/missing'"
  }
  const read = (rel) => masters[rel] ?? null

  it('follows a module’s own imports', () => {
    expect(transitiveModules(['zoneBus.ts'], read)).toEqual(['pure/zoneRegistry.ts', 'zoneBus.ts'])
  })

  it('visits a shared dependency once and returns a stable sorted list', () => {
    expect(transitiveModules(['zoneBus.ts', 'rpc.ts'], read)).toEqual([
      'pure/pending.ts',
      'pure/zoneRegistry.ts',
      'rpc.ts',
      'zoneBus.ts'
    ])
  })

  it('leaves masters nothing imports out of the closure', () => {
    expect(transitiveModules(['rpc.ts'], read)).not.toContain('unused.ts')
  })

  it('terminates on a cycle', () => {
    const cyclic = { 'a.ts': "import './b'", 'b.ts': "import './a'" }
    expect(transitiveModules(['a.ts'], (rel) => cyclic[rel] ?? null)).toEqual(['a.ts', 'b.ts'])
  })

  it('fails loudly when a master is missing', () => {
    expect(() => transitiveModules(['unused.ts'], read)).toThrow(/no master for runtime module 'pure\/missing.ts'/)
  })

  it('returns nothing for a prefab that imports nothing', () => {
    expect(transitiveModules([], read)).toEqual([])
  })
})

describe('digestOf', () => {
  it('changes when a module’s text changes, or when one is renamed, moved or removed', () => {
    const before = digestOf([['a.ts', 'x'], ['pure/b.ts', 'y']])
    expect(digestOf([['a.ts', 'z'], ['pure/b.ts', 'y']])).not.toBe(before)
    expect(digestOf([['a.ts', 'x'], ['b.ts', 'y']])).not.toBe(before)
    expect(digestOf([['a.ts', 'x']])).not.toBe(before)
  })

  it('does not depend on the order the files are read in', () => {
    const files = [['a.ts', 'x'], ['pure/b.ts', 'y']]
    expect(digestOf([...files].reverse())).toBe(digestOf(files))
  })

  it('does not let a shifted boundary hash the same', () => {
    expect(digestOf([['a.ts', 'xy']])).not.toBe(digestOf([['a.ts', 'x'], ['y.ts', '']]))
  })
})

describe('digestUpdate', () => {
  const recorded = { runtimeVersion: '0.3.0', digest: 'aaa' }

  it('has nothing to write when both halves already agree', () => {
    expect(digestUpdate('aaa', recorded, '0.3.0')).toBeNull()
  })

  it('refuses a changed module set under an unchanged RUNTIME_VERSION', () => {
    expect(() => digestUpdate('bbb', recorded, '0.3.0')).toThrow(/bump it in packages\/desktop\/runtime-modules\/version.ts/)
  })

  it('records the new pair once the version moves too', () => {
    expect(digestUpdate('bbb', recorded, '0.4.0')).toEqual({ runtimeVersion: '0.4.0', digest: 'bbb' })
  })

  it('records a version bump on its own, so the file never lags version.ts', () => {
    expect(digestUpdate('aaa', recorded, '0.4.0')).toEqual({ runtimeVersion: '0.4.0', digest: 'aaa' })
  })

  it('writes the first record when there is no file yet', () => {
    expect(digestUpdate('aaa', null, '0.3.0')).toEqual({ runtimeVersion: '0.3.0', digest: 'aaa' })
  })
})

describe('parseRuntimeVersion', () => {
  it('reads the literal without loading the module', () => {
    expect(parseRuntimeVersion("// header\nexport const RUNTIME_VERSION = '1.2.3'\n")).toBe('1.2.3')
  })

  it('fails loudly when the literal is gone', () => {
    expect(() => parseRuntimeVersion('export const OTHER = 1')).toThrow(/no RUNTIME_VERSION literal/)
  })
})

describe('stampActions', () => {
  const closures = new Map([
    ['leaderboard', ['game.ts', 'rpc.ts']],
    ['simple-chair', []]
  ])

  it('has nothing to do when every prefab already declares the right minimum', () => {
    const current = new Map([['leaderboard', '0.3.0'], ['simple-chair', undefined]])
    expect(stampActions(closures, current, '0.3.0')).toEqual([])
  })

  it('flags a stale minimum — this is what makes --check exit 1', () => {
    const current = new Map([['leaderboard', '0.2.0'], ['simple-chair', undefined]])
    expect(stampActions(closures, current, '0.3.0')).toEqual([{ folder: 'leaderboard', from: '0.2.0', to: '0.3.0' }])
  })

  it('removes the field from a prefab whose closure became empty', () => {
    const current = new Map([['leaderboard', '0.3.0'], ['simple-chair', '0.3.0']])
    expect(stampActions(closures, current, '0.3.0')).toEqual([
      { folder: 'simple-chair', from: '0.3.0', to: undefined }
    ])
  })
})

describe('setMinRuntime', () => {
  it('writes the field next to the prefab’s own version', () => {
    const data = { id: 'x', requiresSdk: 'auth-server', version: '1.1.0', origin: { source: 'builtin' } }
    expect(Object.keys(setMinRuntime(data, '0.3.0'))).toEqual(['id', 'requiresSdk', 'minRuntime', 'version', 'origin'])
  })

  it('replaces a stale value in place rather than moving it', () => {
    const data = { id: 'x', minRuntime: '0.2.0', version: '1.1.0' }
    expect(setMinRuntime(data, '0.3.0')).toEqual({ id: 'x', minRuntime: '0.3.0', version: '1.1.0' })
  })

  it('drops the field when the prefab no longer uses the runtime', () => {
    expect(setMinRuntime({ id: 'x', minRuntime: '0.3.0', version: '1.1.0' }, undefined)).toEqual({
      id: 'x',
      version: '1.1.0'
    })
  })
})

// The guards, against the real repo. These are the reason RUNTIME_VERSION is a
// version and not a decoration.
describe('the runtime digest', () => {
  it('matches every master on disk — edit one and bump RUNTIME_VERSION, in one commit', () => {
    const recorded = JSON.parse(
      fs.readFileSync(path.join(root, 'packages/desktop/runtime-modules/runtime-digest.json'), 'utf8')
    )
    expect(digestOf(digestInputs())).toBe(recorded.digest)
    expect(recorded.runtimeVersion).toBe(runtimeVersion())
  })
})

describe('the built-in prefabs', () => {
  it('uses the runtime in exactly the Multiplayer Server prefabs, and in no seat', () => {
    const users = [...plan()]
      .filter(([, modules]) => modules.length > 0)
      .map(([folder]) => folder)
    expect(users).toEqual([
      'announcer',
      'game-flow',
      'health-respawn',
      'leaderboard',
      'server-clock',
      'spawner',
      'trigger-zone'
    ])
  })

  it('declares a minRuntime that is in step with this build', () => {
    const out = execFileSync('node', ['scripts/sync-runtime-modules.mjs', '--check'], { cwd: root, encoding: 'utf8' })
    expect(out).toContain('in step')
  })
})
