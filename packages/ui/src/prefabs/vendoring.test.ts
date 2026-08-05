import { describe, it, expect } from 'vitest'
import {
  claimedGlobals,
  importSpecifiers,
  rewriteRuntimeImports,
  runtimeImportsOf,
  runtimeModuleOf,
  stripComments,
  transitiveModules
} from './vendoring'

const MASTERS: Record<string, string> = {
  'spawner.ts': [
    "import { engine } from '@dcl/sdk/ecs'",
    "import { PoolState } from './pure/poolState'",
    "import { RUNTIME_VERSION } from './version'",
    'export function pool(): void {}'
  ].join('\n'),
  'pure/poolState.ts': "import { clampMax } from './limits'\nexport class PoolState {}",
  'pure/limits.ts': 'export const clampMax = (n: number): number => n',
  'version.ts': "export const RUNTIME_VERSION = '0.2.0'",
  'rpc.ts': 'export function createRpc(): void {}'
}

const read = (rel: string): string | null => MASTERS[rel] ?? null

describe('specifier scanning', () => {
  it('drops comments so a documented example is not a dependency', () => {
    const text = [
      "// import { pool } from './runtime/spawner'",
      "/* import { rpc } from './runtime/rpc' */",
      "import { plan } from './runtime/spawner'"
    ].join('\n')
    expect(runtimeImportsOf(text)).toEqual(['spawner.ts'])
  })

  it('keeps string literals, including escaped quotes', () => {
    expect(stripComments("const s = 'it\\'s // fine'")).toBe("const s = 'it\\'s // fine'")
  })

  it('reads every static form and no dynamic one', () => {
    const text = [
      "import a from './a'",
      "import './side-effect'",
      "export { b } from './b'",
      "const c = await import('./c')"
    ].join('\n')
    expect(importSpecifiers(text)).toEqual(['./a', './side-effect', './b'])
  })
})

describe('runtime module resolution', () => {
  it('recognises a runtime import at any nesting depth', () => {
    expect(runtimeModuleOf('./runtime/spawner')).toBe('spawner.ts')
    expect(runtimeModuleOf('./runtime/pure/rng')).toBe('pure/rng.ts')
    expect(runtimeModuleOf('../runtime/rpc')).toBe('rpc.ts')
    expect(runtimeModuleOf('../../runtime/rpc.ts')).toBe('rpc.ts')
  })

  it('is not fooled by a package or another folder', () => {
    expect(runtimeModuleOf('@dcl/sdk/ecs')).toBeNull()
    expect(runtimeModuleOf('./helpers')).toBeNull()
    expect(runtimeModuleOf('./runtime')).toBeNull()
    // reaching into another prefab's copy is a different (banned) thing
    expect(runtimeModuleOf('../../custom/other/scripts/runtime/rpc')).toBeNull()
  })

  it('collects direct imports in source order, deduped', () => {
    const text = [
      "import { pool } from './runtime/spawner'",
      "import { createRng } from './runtime/pure/rng'",
      "import { plan } from './runtime/spawner'"
    ].join('\n')
    expect(runtimeImportsOf(text)).toEqual(['spawner.ts', 'pure/rng.ts'])
  })
})

describe('transitive closure', () => {
  it('follows a module into its own dependencies', () => {
    const entry = "import { pool } from './runtime/spawner'"
    expect(transitiveModules(entry, read)).toEqual([
      'pure/limits.ts',
      'pure/poolState.ts',
      'spawner.ts',
      'version.ts'
    ])
  })

  it('carries nothing when the script imports nothing of ours', () => {
    expect(transitiveModules("import { engine } from '@dcl/sdk/ecs'", read)).toEqual([])
  })

  // Half a module set is worse than none: it fails inside the creator's scene,
  // pointing at code they never wrote.
  it('refuses to carry an incomplete set', () => {
    expect(() => transitiveModules("import { x } from './runtime/missing'", read)).toThrow(
      "no master for runtime module 'missing.ts'"
    )
  })
})

describe('rewriting a captured script imports', () => {
  it('leaves an already-correct specifier byte-identical', () => {
    const text = "import { pool } from './runtime/spawner'\nexport class A {}"
    expect(rewriteRuntimeImports(text, 'custom/rig/scripts', 'custom/rig/scripts')).toBe(text)
  })

  it('re-points a nested source at the copy next to it', () => {
    const text = "import { rpc } from '../runtime/rpc'"
    expect(rewriteRuntimeImports(text, 'src/scripts/ai', 'custom/rig/scripts')).toBe(
      "import { rpc } from './runtime/rpc'"
    )
  })

  it('keeps an explicit extension explicit', () => {
    expect(rewriteRuntimeImports("import x from '../runtime/pure/rng.ts'", 'src/scripts/ai', 'custom/rig/scripts')).toBe(
      "import x from './runtime/pure/rng.ts'"
    )
  })

  it('never touches package or sibling imports', () => {
    const text = ["import { engine } from '@dcl/sdk/ecs'", "import { helper } from './helper'"].join('\n')
    expect(rewriteRuntimeImports(text, 'src/scripts/ai', 'custom/rig/scripts')).toBe(text)
  })
})

describe('claimed globals', () => {
  it('reports this repo versioned keys, in sorted order', () => {
    const texts = [
      "const bus = globalThis.__dclZoneBus_v1 ?? {}",
      "globalThis['__dclSpawner_v1'] = registry",
      'globalThis.__DCL_SCRIPT_INSTANCES__ = new Map()',
      'globalThis.window = undefined'
    ]
    expect(claimedGlobals(texts)).toEqual(['__dclSpawner_v1', '__dclZoneBus_v1'])
  })

  it('ignores a key that only appears in a comment', () => {
    expect(claimedGlobals(['// globalThis.__dclGhost_v1 is not ours'])).toEqual([])
  })
})
