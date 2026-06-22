import { describe, it, expect } from 'vitest'
import { ensureImports } from './importTsx'

describe('ensureImports', () => {
  it('adds a missing named component to the react-ecs import', () => {
    const src = "import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'\n"
    const out = ensureImports(src, '<UiEntity><Label value={1} /></UiEntity>')
    expect(out).toContain('UiEntity')
    expect(out).toMatch(/import ReactEcs, \{ [^}]*Label[^}]* \} from '@dcl\/sdk\/react-ecs'/)
  })

  it('does not duplicate already-present imports', () => {
    const src = "import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'\n"
    const out = ensureImports(src, '<UiEntity><Label value={1} /></UiEntity>')
    expect(out.match(/Label/g)).toHaveLength(1) // still only in the single import line
    expect((out.match(/import ReactEcs/g) ?? []).length).toBe(1)
  })

  it('upgrades a bare ReactEcs import to a named one', () => {
    const src = "import ReactEcs from '@dcl/sdk/react-ecs'\n"
    const out = ensureImports(src, '<Input placeholder={1} />')
    expect(out).toMatch(/import ReactEcs, \{ Input \} from '@dcl\/sdk\/react-ecs'/)
  })

  it('adds a Color4 import when the JSX uses it and none exists', () => {
    const src = "import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'\n"
    const out = ensureImports(src, '<UiEntity uiBackground={{ color: Color4.create(1,0,0,1) }} />')
    expect(out).toContain("import { Color4 } from '@dcl/sdk/math'")
  })

  it('merges Color4 into an existing math import', () => {
    const src = "import { Vector3 } from '@dcl/sdk/math'\n"
    const out = ensureImports(src, '<UiEntity uiBackground={{ color: Color4.White() }} />')
    expect(out).toMatch(/import \{ [^}]*Vector3[^}]* \} from '@dcl\/sdk\/math'/)
    expect(out).toMatch(/import \{ [^}]*Color4[^}]* \} from '@dcl\/sdk\/math'/)
    expect((out.match(/@dcl\/sdk\/math/g) ?? []).length).toBe(1)
  })

  it('leaves imports untouched when nothing new is used', () => {
    const src = "import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'\nimport { Color4 } from '@dcl/sdk/math'\n"
    const out = ensureImports(src, '<UiEntity uiBackground={{ color: Color4.White() }} />')
    expect(out).toBe(src)
  })
})
