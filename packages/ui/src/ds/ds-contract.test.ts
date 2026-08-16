// The design-system STRICT RULES, enforced. One component per role, one popup
// surface, one toggle size set, no raw native controls, no cross-prefix CSS.
//
// This exists because the rules in CONVENTIONS.md were prose, and prose does not
// fail a build: the app drifted to two dropdown primitives, four popup surfaces
// and four rendered toggle sizes before anyone noticed. Scans source text (node
// env, no rendering) the way prefabs/builtin.test.ts guards prefab folders.
//
// ALLOWED_LEGACY must stay EMPTY. It exists only so a migration can land in
// stages; every entry is asserted to still match, so a stale exemption fails.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANONICAL_ROLES, UNROLED } from './canonical-roles'
import { CHIP_SIZES, CHIP_TONES } from './Chip'
import { STATE_TONES } from './StateBlock'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DS_DIR = path.join(SRC, 'ds')

const ALLOWED_LEGACY: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full)
    return [full]
  })
}

const ALL = walk(SRC)
const rel = (f: string): string => path.relative(SRC, f).split(path.sep).join('/')
const isDs = (f: string): boolean => f.startsWith(DS_DIR + path.sep)
const read = (f: string): string => readFileSync(f, 'utf8')

const TSX = ALL.filter((f) => f.endsWith('.tsx'))
const CSS = ALL.filter((f) => f.endsWith('.css'))
const NON_DS_TSX = TSX.filter((f) => !isDs(f))
const NON_DS_CSS = CSS.filter((f) => !isDs(f))
const DS_CSS = CSS.filter(isDs)

// Reports "file:line — detail" for every match, minus the legacy allowlist.
function findLines(files: string[], test: (line: string) => boolean): string[] {
  const hits: string[] = []
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (test(line)) hits.push(`${rel(f)}:${i + 1} — ${line.trim().slice(0, 100)}`)
    })
  }
  return hits.filter((h) => !ALLOWED_LEGACY.some((a) => h.startsWith(a)))
}

describe('ds contract', () => {
  it('R1 every exported component has exactly one registered role', () => {
    const barrel = read(path.join(DS_DIR, 'index.tsx'))
    const exported = [
      ...barrel.matchAll(/^export (?:function|const) (\w+)/gm),
      ...barrel.matchAll(/^export \{ ([^}]+) \} from/gm)
    ].flatMap((m) =>
      m[0].startsWith('export {')
        ? m[1].split(',').map((s) => s.trim().replace(/^type .*/, '').split(' as ').pop() ?? '')
        : [m[1]]
    ).filter((n) => n !== '' && !n.startsWith('type '))

    const roled = Object.values(CANONICAL_ROLES).map((r) => r.component)
    const unclassified = exported.filter((n) => !roled.includes(n) && !UNROLED.includes(n))
    expect(unclassified, 'new ds export must be added to CANONICAL_ROLES or UNROLED in canonical-roles.ts').toEqual([])

    // no two roles may name the same component, and every role's component must exist
    expect(new Set(roled).size, 'two roles share one component').toBe(roled.length)
    for (const c of roled) expect(exported, `role component ${c} is not exported from ds/index.tsx`).toContain(c)
  })

  it('R2 no raw native select / option / checkbox outside ds', () => {
    const hits = findLines(NON_DS_TSX, (l) => /<select[\s>]/.test(l) || /<option[\s>]/.test(l) || /<input[^>]*type="checkbox"/.test(l))
    expect(hits, 'use ds Select / Checkbox instead of a native control').toEqual([])
  })

  it('R3 only ds stylesheets declare eui-ds-* selectors', () => {
    const hits = findLines(NON_DS_CSS, (l) => /\.eui-ds-/.test(l))
    expect(hits, 'a feature may not restyle a ds primitive — pass className and style your own class').toEqual([])
  })

  it('R4 no markup outside ds hand-writes a roled component class', () => {
    const owned = Object.values(CANONICAL_ROLES).flatMap((r) => r.classes)
    const hits: string[] = []
    for (const f of NON_DS_TSX) {
      read(f).split('\n').forEach((line, i) => {
        const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/.exec(line)
        if (cls === null) return
        const tokens = (cls[1] ?? cls[2] ?? cls[3] ?? '').split(/[\s${}?:'"]+/).filter(Boolean)
        for (const t of tokens) {
          if (owned.includes(t)) hits.push(`${rel(f)}:${i + 1} — ${t}`)
        }
      })
    }
    const left = hits.filter((h) => !ALLOWED_LEGACY.some((a) => h.startsWith(a)))
    expect(left, 'render the canonical component instead of writing its class by hand').toEqual([])
  })

  it('R5 toggle CSS declares exactly the sizes the component can emit', () => {
    const declared = new Set<string>()
    for (const f of DS_CSS) {
      for (const m of read(f).matchAll(/\.eui-ds-toggle\.([a-z]+)/g)) declared.add(m[1])
    }
    declared.delete('on') // state, not a size
    // TOGGLE_SIZES is ['sm','md']; 'md' is the unmodified base rule, so CSS carries only 'sm'
    expect([...declared].sort(), 'a toggle size exists in CSS that the component API cannot produce').toEqual(['sm'])
  })

  it('R5b chip CSS declares exactly the tones and sizes the component can emit', () => {
    const declared = new Set<string>()
    for (const f of DS_CSS) {
      for (const m of read(f).matchAll(/\.eui-ds-chip\.([a-z]+)/g)) declared.add(m[1])
    }
    // CHIP_TONES minus the unmodified 'default' base rule, plus CHIP_SIZES minus
    // the unmodified 'md' base rule.
    const expected = [...CHIP_TONES.filter((t) => t !== 'default'), ...CHIP_SIZES.filter((s) => s !== 'md')]
    expect([...declared].sort(), 'a chip tone/size exists in CSS that the component API cannot produce, or vice versa').toEqual(expected.sort())
  })

  it('R5c state-block CSS declares exactly the tones the component can emit', () => {
    const declared = new Set<string>()
    for (const f of DS_CSS) {
      for (const m of read(f).matchAll(/\.eui-ds-state-icon\.([a-z]+)/g)) declared.add(m[1])
    }
    // STATE_TONES minus the unmodified 'neutral' base rule.
    const expected = STATE_TONES.filter((t) => t !== 'neutral')
    expect([...declared].sort(), 'a state tone exists in CSS that the component API cannot produce, or vice versa').toEqual(
      [...expected].sort()
    )
  })

  it('R6 no inline style overrides ds metrics', () => {
    const hits = findLines(NON_DS_TSX, (l) => /style=\{\{[^}]*transform:\s*['"]?scale\(/.test(l))
    expect(hits, 'scaling a ds primitive forks its size — add a size prop instead').toEqual([])
  })

  it('R7 exactly one anchored popup surface exists', () => {
    // The dropdown-popup signature specifically: absolutely positioned, shadowed,
    // and anchored directly under its trigger (top: calc(100% …)). Toolbars,
    // toasts, tooltips and FABs float too, but they are not option lists.
    // eui-ds-pop = option lists (Select/MultiSelect). eui-menu = the one command
    // menu surface (MenuItem rows); eui-ctx/eui-ai-menu anchor to a cursor or a
    // composer, not a field. Adding a fifth means a role grew a second surface.
    const ALLOWED_SURFACES = ['eui-ds-pop', 'eui-menu', 'eui-ctx', 'eui-ai-menu']
    const surfaces: string[] = []
    for (const f of CSS) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [, sel, body] = m
        if (!/position:\s*absolute/.test(body) || !/box-shadow:/.test(body)) continue
        if (!/top:\s*calc\(100%/.test(body)) continue
        const names = [...sel.matchAll(/\.([a-zA-Z0-9-]+)/g)].map((x) => x[1])
        if (names.some((n) => ALLOWED_SURFACES.includes(n))) continue
        if (names.length > 0) surfaces.push(`${rel(f)} — ${sel.trim().slice(0, 60)}`)
      }
    }
    expect(surfaces, 'every option list renders in ds Popover — do not author a second popup surface').toEqual([])
  })

  // Rendered, not merely named: matching the whole file passed on the import
  // line alone, so R8 caught a primitive that was never added and missed one
  // whose story was deleted — the state the rule is actually written about.
  it('R8 every roled component is rendered in the showcase', () => {
    const showcase = read(path.join(SRC, 'ds-showcase.tsx'))
    const markup = showcase.replace(/import\s+[\s\S]*?from\s+'[^']*'/g, '')
    const roled = Object.values(CANONICAL_ROLES).map((r) => r.component)
    // A primitive another primitive owns has no story of its own: Popover IS the
    // Select popup, and the Select stories are where it is on screen.
    const insideAnother = read(path.join(DS_DIR, 'index.tsx'))
    const missing = roled.filter(
      (c) => !new RegExp(`<${c}\\b`).test(markup) && !new RegExp(`<${c}\\b`).test(insideAnother)
    )
    expect(missing, 'a primitive invisible in the showcase gets re-implemented by the next author').toEqual([])
  })

  it('R8b the showcase renders every demo it declares', () => {
    const showcase = read(path.join(SRC, 'ds-showcase.tsx'))
    const orphans = [...showcase.matchAll(/^function (\w+)\s*\(/gm)]
      .map((m) => m[1])
      .filter((name) => (showcase.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length < 2)
    expect(
      orphans,
      'a demo nothing renders is a story that was deleted while its component stayed imported — R8 then passes on a primitive no one can see'
    ).toEqual([])
  })

  it('R9 control heights come from --control-h tokens', () => {
    // The drift this stops: 40/38/28/26px controls sharing a flex row (a search
    // pill towering over the select beside it). A control's base or variant rule
    // takes height from a --control-h* token; the five scales live in tokens.css.
    // Descendant/context selectors (svg sizing, toolbar overrides) are out of scope.
    const CONTROL = /^\.eui-(btn|input|num|select|color-swatch|seg|ds-search|ds-select-field)(\.[a-z-]+)*$/
    const hits: string[] = []
    for (const f of DS_CSS) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, '')
      for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [, sels, body] = m
        const h = /(?:^|;)\s*height:\s*\d+px/.exec(body)
        if (h === null) continue
        for (const sel of sels.split(',')) {
          if (CONTROL.test(sel.trim())) hits.push(`${rel(f)} — ${sel.trim()}`)
        }
      }
    }
    expect(hits, 'a control declares a raw px height — use a --control-h* token (CONVENTIONS.md "Control metrics")').toEqual([])
  })

  it('ALLOWED_LEGACY is shrink-only — no stale exemptions', () => {
    // Each entry must still match something; when a migration removes the last
    // violation, the exemption has to go in the same commit.
    const allText = [...TSX, ...CSS].map((f) => `${rel(f)} ${read(f)}`)
    for (const entry of ALLOWED_LEGACY) {
      const file = entry.split(':')[0]
      expect(allText.some((t) => t.startsWith(file + ' ')), `stale exemption: ${entry}`).toBe(true)
    }
  })
})
