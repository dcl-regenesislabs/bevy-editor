import { describe, it, expect } from 'vitest'
import {
  RUNTIME_MODULE_MARKER,
  importSpecifiers,
  isVendoredCopy,
  runtimeImportsOf,
  runtimeModuleOf,
  strandedImports,
  stripComments,
  transitiveModules
} from './vendoring'

const MASTERS: Record<string, string> = {
  'spawner.ts': [
    "import { engine } from '@dcl/sdk/ecs'",
    "import { PoolState } from './pure/poolState'",
    "import { BUDGET } from './budget'",
    'export function pool(): void {}'
  ].join('\n'),
  'pure/poolState.ts': "import { clampMax } from './limits'\nexport class PoolState {}",
  'pure/limits.ts': 'export const clampMax = (n: number): number => n',
  'budget.ts': 'export const BUDGET = 32',
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

  // The shape a placed prefab's script writes: one copy per project, reached by
  // climbing out of custom/<folder>/scripts/. Classifying it as an ordinary
  // relative import is what would leave the module unvendored and the import red.
  it('recognises a placed prefab climb-out to the project shared copy', () => {
    expect(runtimeModuleOf('../../../src/scripts/runtime/game')).toBe('game.ts')
    expect(runtimeModuleOf('../../../src/scripts/runtime/pure/rng')).toBe('pure/rng.ts')
    expect(runtimeModuleOf('../../../src/scripts/runtime/zoneBus.ts')).toBe('zoneBus.ts')
  })

  it('is not fooled by a package or another folder', () => {
    expect(runtimeModuleOf('@dcl/sdk/ecs')).toBeNull()
    expect(runtimeModuleOf('./helpers')).toBeNull()
    expect(runtimeModuleOf('./runtime')).toBeNull()
    // reaching into another prefab's copy is a different (banned) thing
    expect(runtimeModuleOf('../../custom/other/scripts/runtime/rpc')).toBeNull()
    expect(runtimeModuleOf('../../../src/other/runtime/rpc')).toBeNull()
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

// The one predicate every vendoring pass must ask before it writes. The header
// this file promises — "a creator's own file is provably never touched" — is only
// true while all of them share it.
describe('ownership of a file under runtime/', () => {
  it('claims a master, and never a creator file wearing a master name', () => {
    expect(isVendoredCopy(`// ${RUNTIME_MODULE_MARKER} Do not edit.\nexport const x = 1\n`)).toBe(true)
    expect(isVendoredCopy('export function myOwnRng(): number { return 4 }\n')).toBe(false)
    expect(isVendoredCopy('')).toBe(false)
  })
})

describe('transitive closure', () => {
  it('follows a module into its own dependencies', () => {
    const entry = "import { pool } from './runtime/spawner'"
    expect(transitiveModules(entry, read)).toEqual([
      'budget.ts',
      'pure/limits.ts',
      'pure/poolState.ts',
      'spawner.ts'
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

// The other half of "only runtime modules travel": the specifiers the rewrite
// deliberately leaves alone are exactly the ones that stop resolving once the
// copy is in the folder, and nothing used to say so.
describe('imports stranded by the move', () => {
  it('reports a sibling and a generated accessor the folder will not hold', () => {
    const text = [
      "import { helper } from './helper'",
      "import { gameConfig } from './game-config'"
    ].join('\n')
    expect(strandedImports(text, 'src/scripts', 'custom/zombie_basic/scripts')).toEqual([
      './helper',
      './game-config'
    ])
  })

  it('reports a reach into another prefab folder', () => {
    const text = "import { outcomes } from '../../custom/wave_director/scripts/runtime/outcomes'"
    expect(strandedImports(text, 'src/scripts', 'custom/zombie_basic/scripts')).toEqual([
      '../../custom/wave_director/scripts/runtime/outcomes'
    ])
  })

  it('says nothing about packages or the runtime modules that do travel', () => {
    const text = [
      "import { engine } from '@dcl/sdk/ecs'",
      "import { pool } from '../runtime/spawner'"
    ].join('\n')
    expect(strandedImports(text, 'src/scripts/ai', 'custom/rig/scripts')).toEqual([])
  })

  // A climb-out to the project's shared copy is a runtime import, so it is
  // exempt — the module it names is the one the folder's own scripts already use.
  it('says nothing about a climb-out to the shared copy', () => {
    const text = "import { game } from '../../../src/scripts/runtime/game'"
    expect(strandedImports(text, 'custom/rig/scripts', 'custom/other/scripts')).toEqual([])
  })

  it('says nothing when the specifier resolves to the same project path either way', () => {
    const text = "import { shared } from '../../shared/math'"
    expect(strandedImports(text, 'src/scripts', 'lib/scripts')).toEqual([])
    // a folder script rewritten in place has not moved at all
    expect(strandedImports(text, 'custom/rig/scripts', 'custom/rig/scripts')).toEqual([])
  })
})
