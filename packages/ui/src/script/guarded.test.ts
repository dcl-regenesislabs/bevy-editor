import { describe, it, expect } from 'vitest'
import { isEntryPoint, syntaxError, missingMain, checkEntryPoint } from './guarded'

const GOOD = `import { engine } from '@dcl/sdk/ecs'
export function main() {
  engine.addSystem(() => {})
}`

describe('entry-point detection', () => {
  it('matches the scene entry point, not scripts', () => {
    expect(isEntryPoint('src/index.ts')).toBe(true)
    expect(isEntryPoint('./src/index.ts')).toBe(true)
    expect(isEntryPoint('src/index.tsx')).toBe(true)
    expect(isEntryPoint('src/scripts/Door.ts')).toBe(false)
    expect(isEntryPoint('src/other/index.ts')).toBe(false)
    expect(isEntryPoint(null)).toBe(false)
  })
})

describe('syntax gate', () => {
  it('accepts valid TypeScript', () => {
    expect(syntaxError(GOOD)).toBeNull()
  })

  it('accepts TSX and modern syntax', () => {
    expect(syntaxError('export const main = async () => { await Promise.resolve() }')).toBeNull()
    expect(syntaxError('type A = { a?: string }\nexport function main(): void {}')).toBeNull()
  })

  it('reports a missing brace with a line number', () => {
    const err = syntaxError('export function main() {\n  const a = 1\n')
    expect(err).not.toBeNull()
    expect(err).toMatch(/line \d+/)
  })

  it('blocks a broken file and says so', () => {
    const res = checkEntryPoint('export function main() {')
    expect(res.block).not.toBeNull()
    expect(res.warn).toBeNull()
  })
})

describe('main() warning', () => {
  it('accepts every legal shape without warning', () => {
    expect(missingMain(GOOD)).toBe(false)
    expect(missingMain('export const main = () => {}')).toBe(false)
    expect(missingMain('export async function main() {}')).toBe(false)
    expect(missingMain('export let main: () => void = () => {}')).toBe(false)
    expect(missingMain('function main() {}\nexport { main }')).toBe(false)
  })

  it('warns but does not block when main is gone', () => {
    const res = checkEntryPoint('const x = 1')
    expect(res.block).toBeNull()
    expect(res.warn).toMatch(/main/)
  })
})
