// The renderer names the file it wants, so the guard is the point of this
// module: a project that can ask for any path can read the user's disk.
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readRuntimeModule, resolveRuntimeModule } from './runtime-modules'

const made: string[] = []

function tree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-modules-test-'))
  made.push(root)
  fs.mkdirSync(path.join(root, 'pure'), { recursive: true })
  fs.writeFileSync(path.join(root, 'spawner.ts'), 'export function registerSpawnables() {}\n')
  fs.writeFileSync(path.join(root, 'pure', 'poolState.ts'), 'export const cap = 1\n')
  fs.writeFileSync(path.join(root, 'README.md'), '# not a module\n')
  fs.writeFileSync(path.join(root, '..', path.basename(root) + '-secret.ts'), 'secret\n')
  made.push(path.join(root, '..', path.basename(root) + '-secret.ts'))
  return root
}

afterEach(() => {
  for (const p of made.splice(0)) fs.rmSync(p, { recursive: true, force: true })
})

describe('reading a runtime-module master', () => {
  it('resolves a module and a pure/ module below the root', () => {
    const root = tree()
    expect(resolveRuntimeModule(root, 'spawner.ts')).toBe(path.join(root, 'spawner.ts'))
    expect(resolveRuntimeModule(root, 'pure/poolState.ts')).toBe(path.join(root, 'pure', 'poolState.ts'))
  })

  it('refuses anything that leaves the tree, however it is spelled', () => {
    const root = tree()
    expect(resolveRuntimeModule(root, `../${path.basename(root)}-secret.ts`)).toBeNull()
    expect(resolveRuntimeModule(root, 'pure/../../elsewhere.ts')).toBeNull()
    expect(resolveRuntimeModule(root, path.join(root, '..', 'elsewhere.ts'))).toBeNull()
    expect(resolveRuntimeModule(root, '')).toBeNull()
    expect(resolveRuntimeModule(root, '.')).toBeNull()
  })

  it('refuses anything that is not a TypeScript module', () => {
    const root = tree()
    expect(resolveRuntimeModule(root, 'README.md')).toBeNull()
    expect(resolveRuntimeModule(root, 'pure')).toBeNull()
  })

  it('reads a master and returns null rather than throwing for one that is absent', () => {
    const root = tree()
    expect(readRuntimeModule(root, 'spawner.ts')).toContain('registerSpawnables')
    expect(readRuntimeModule(root, 'not-a-module.ts')).toBeNull()
    expect(readRuntimeModule(root, `../${path.basename(root)}-secret.ts`)).toBeNull()
  })
})
