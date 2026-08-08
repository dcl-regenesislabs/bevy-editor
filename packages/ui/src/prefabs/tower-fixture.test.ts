import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { exportShape } from './codegen'

// The shape rule the Tower of Madness fixture has to keep, checked against the
// editor's own reader.
//
// The SDK's script runner constructs `Object.values(module).find(exp => typeof
// exp === 'function')` — the FIRST function-valued export, not the class it can
// see. A helper exported above the class turns the whole Script row into a call
// to that helper, silently, with the scene still building and nothing in the
// console. That is why every shared function in that scene lives under pure/.
//
// The scene lives in packages/desktop/validate/fixtures/tower-of-madness/ and
// its behaviour is tested there (packages/desktop/src/tower-of-madness.test.ts);
// this reader is the editor's, so the shape check belongs on this side.
const SCRIPTS = fileURLToPath(new URL('../../../desktop/validate/fixtures/tower-of-madness/scripts/', import.meta.url))
const ATTACHED = ['tower-builder.ts', 'madness-race.ts', 'round-results.ts', 'clock-board.ts', 'tower-probe.ts']

describe("Tower of Madness — the scene's attached scripts", () => {
  it.each(ATTACHED)('%s exports exactly one class, so the runner cannot construct a helper', (file) => {
    const shape = exportShape(fs.readFileSync(`${SCRIPTS}${file}`, 'utf8'))
    expect(shape.error).toBeUndefined()
    expect(shape.functions).toHaveLength(1)
    expect(shape.reexports).toBe(false)
  })

  it('the helpers they share are all in pure/, where nothing constructs them', () => {
    const pure = fs.readdirSync(`${SCRIPTS}pure`).filter((name) => name.endsWith('.ts'))
    expect(pure.sort()).toEqual(['boards.ts', 'clock.ts', 'names.ts', 'tower.ts'])
    for (const file of pure) {
      expect(fs.readFileSync(`${SCRIPTS}pure/${file}`, 'utf8')).not.toContain("from '@dcl/sdk")
    }
  })
})
