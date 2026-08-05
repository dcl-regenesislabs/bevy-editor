// The pure half of scripts/sync-runtime-modules.mjs: which runtime modules a prefab
// script asks for, and what that pulls in transitively. No fs — the module graph is a
// plain object here, so these cases stay readable and cost nothing to run.
import { describe, it, expect } from 'vitest'
import {
  importSpecifiers,
  resolveSpecifier,
  runtimeImportsOf,
  stripCommentsAndStrings,
  transitiveModules
} from './sync-runtime-modules.mjs'

describe('importSpecifiers', () => {
  it('reads every static form', () => {
    const text = [
      "import { type Entity } from '@dcl/sdk/ecs'",
      'import defaults from "./runtime/spawner"',
      "import './runtime/side-effect'",
      "export { pool } from './runtime/pool'",
      "export * from './runtime/all'"
    ].join('\n')
    expect(importSpecifiers(text)).toEqual([
      '@dcl/sdk/ecs',
      './runtime/spawner',
      './runtime/pool',
      './runtime/all',
      './runtime/side-effect'
    ])
  })

  it('ignores the example imports prefab scripts document themselves with', () => {
    const text = [
      "// import { emitZone } from './runtime/zoneBus'",
      '/*',
      " * import { pool } from './runtime/spawner'",
      ' */',
      "import { real } from './runtime/rpc'"
    ].join('\n')
    expect(importSpecifiers(text)).toEqual(['./runtime/rpc'])
  })

  it('does not follow dynamic import(), which is banned repo-wide', () => {
    expect(importSpecifiers("const m = await import('./runtime/spawner')")).toEqual([])
  })

  it('leaves a url inside a string alone', () => {
    const text = ["const docs = 'https://example.com//x'", "import { a } from './runtime/a'"].join('\n')
    expect(importSpecifiers(text)).toEqual(['./runtime/a'])
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
    expect(resolveSpecifier('runtime/zoneBus.ts', './pure/zoneRegistry')).toBe('runtime/pure/zoneRegistry.ts')
    expect(resolveSpecifier('tabs/video/state.ts', '../../runtime/rpc')).toBe('runtime/rpc.ts')
  })

  it('keeps an explicit .ts extension instead of doubling it', () => {
    expect(resolveSpecifier('a.ts', './b.ts')).toBe('b.ts')
  })

  it('passes bare package names through as not-relative', () => {
    expect(resolveSpecifier('a.ts', '@dcl/sdk/ecs')).toBeNull()
  })

  it('refuses a specifier that escapes the prefab folder', () => {
    expect(() => resolveSpecifier('a.ts', '../../../secrets')).toThrow(/escapes/)
  })
})

describe('runtimeImportsOf', () => {
  it('takes only what resolves into scripts/runtime/', () => {
    const text = [
      "import { type Entity } from '@dcl/sdk/ecs'",
      "import { emitZone } from './runtime/zoneBus'",
      "import { Membership } from './runtime/pure/membership'",
      "import { insideZone } from './zone-geometry'"
    ].join('\n')
    expect(runtimeImportsOf(text, 'trigger-zone.ts')).toEqual(['zoneBus.ts', 'pure/membership.ts'])
  })

  it('resolves a nested script the same as a top-level one', () => {
    expect(runtimeImportsOf("import { createRpc } from '../runtime/rpc'", 'tabs/api.ts')).toEqual(['rpc.ts'])
  })

  it('reports each module once however many times it is imported', () => {
    const text = ["import { a } from './runtime/rpc'", "import { b } from './runtime/rpc'"].join('\n')
    expect(runtimeImportsOf(text, 'x.ts')).toEqual(['rpc.ts'])
  })

  it('does not mistake a sibling directory that starts with runtime', () => {
    expect(runtimeImportsOf("import { a } from './runtime-helpers/a'", 'x.ts')).toEqual([])
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
