// Structural guards for the publish dialog.
//
// Five rounds of fixing one state at a time failed because nothing in the code
// said what a publish state IS: two if-ladders and three action-row
// implementations meant every state hand-assembled its own layout, and every
// edit drifted. The shape is now a single descriptor (publish-view.tsx), one
// body component with no `actions` prop (ds StateBlock), and one footer
// renderer that owns variant, size and order (PublishFooter).
//
// These scans are what keeps it that way: they fail the moment a state grows its
// own button, its own size, or a class borrowed from another feature.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DIR = __dirname
const MODAL = path.join(DIR, 'PublishModal.tsx')

const sources = fs
  .readdirSync(DIR)
  .filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(DIR, f), 'utf8') }))

const modal = fs.readFileSync(MODAL, 'utf8')
const css = fs.readFileSync(path.join(DIR, 'publish.css'), 'utf8')

const hits = (test: (line: string, file: string) => boolean): string[] =>
  sources.flatMap((s) => s.text.split('\n').flatMap((line, i) => (test(line, s.name) ? [`${s.name}:${i + 1} — ${line.trim().slice(0, 90)}`] : [])))

describe('publish dialog structure', () => {
  it('G1 renders no button of its own — actions exist only in PublishFooter', () => {
    expect(modal).not.toMatch(/<Button/)
    expect(modal).not.toMatch(/<ConfirmButton/)
    // and PublishFooter is RENDERED, never called. Called as a function its
    // early return would register hooks conditionally in PublishModal's own
    // slot, and the first zero-action state (O3) would crash the dialog.
    expect(modal).toMatch(/<PublishFooter\b/)
    expect(modal, 'PublishFooter is a component, not a helper').not.toMatch(/PublishFooter\(\{/)
  })

  it('G2 never passes a button size — one size for the whole flow', () => {
    const bad = hits((line) => /<(Button|ConfirmButton)\b[^>]*\bsize=/.test(line))
    expect(bad, 'the ds default (sm) is the publish flow’s only button size').toEqual([])
  })

  it('G3 borrows no class from another feature and hand-writes no link', () => {
    const BANNED = [
      'eui-signin-row',
      'eui-account-empty-icon',
      'eui-home-modal',
      'eui-publish-actions',
      'eui-publish-world',
      'eui-publish-center',
      'eui-publish-party'
    ]
    const bad = hits((line) => BANNED.some((c) => line.includes(c)) || line.includes('className="eui-link"'))
    expect(bad, 'render the canonical component instead of borrowing a class or re-rolling a role').toEqual([])
  })

  it('G4 writes no CSS in TS', () => {
    const bad = hits((line) => line.includes('style={{'))
    expect(bad, 'styles live in publish.css — an inline object is how the spacer hack got in').toEqual([])
  })

  // EVERY eui- class in the selector, not just the one the rule belongs to:
  // `.eui-publish-modal .eui-modal-foot { … }` is owned by publish on its first
  // token and restyles the action row of the whole app on its second. That is
  // the shape of the `.eui-home-modal` borrow this dialog was rebuilt to undo,
  // re-authored from publish's own stylesheet.
  it('G5 styles nothing but its own classes', () => {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const bad: string[] = []
    for (const m of text.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      for (const sel of m[1].split(',')) {
        for (const cls of sel.match(/\beui-[a-zA-Z0-9-]+/g) ?? []) {
          if (!cls.startsWith('eui-publish')) bad.push(`${sel.trim().slice(0, 60)} — ${cls}`)
        }
      }
    }
    expect(bad, 'a feature may not restyle .eui-modal-*, .eui-btn or .eui-link — not even under its own class').toEqual([])
  })

  it('G6 renders exactly one body and at most one disclosure', () => {
    expect((modal.match(/<StateBlock/g) ?? []).length).toBe(1)
    expect((modal.match(/<Shelf/g) ?? []).length).toBe(1)
  })
})
