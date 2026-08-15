import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The failure dialog drifted into four kinds of control at once: a primary pill,
// a bare `eui-link`, a monospace link and a variant-less <Button>, which falls
// back to the legacy flat `eui-btn` rather than the design system's. They read
// as different kinds of thing because they were.
const SRC = path.join(__dirname, 'PublishModal.tsx')

describe('publish modal controls', () => {
  const source = fs.readFileSync(SRC, 'utf8')

  it('never renders a hand-written link where a control belongs', () => {
    expect(source).not.toMatch(/className="eui-link"/)
  })

  it('gives every Button a variant, so none falls back to the legacy flat button', () => {
    const buttons = source.match(/<Button(\s[^>]*)?>/g) ?? []
    const variantless = buttons.filter((b) => !b.includes('variant='))
    expect(variantless, 'a <Button> with no variant renders eui-btn, not eui-ds-btn').toEqual([])
  })
})
