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
import { DENSITIES, MODAL_SIZES, SPINNER_SIZES } from './index'
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

// The variant classes ds CSS declares for one base class (`.eui-ds-chip.warn`),
// sorted, minus the given non-variant classes (a state or a colour). R5* compares
// that set to the closed union the component can emit.
function cssVariants(base: string, ...notVariants: string[]): string[] {
  const declared = new Set<string>()
  const re = new RegExp(`\\.${base}\\.([a-z0-9]+)`, 'g')
  for (const f of DS_CSS) {
    for (const m of read(f).matchAll(re)) declared.add(m[1])
  }
  for (const n of notVariants) declared.delete(n)
  return [...declared].sort()
}

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
    // TOGGLE_SIZES is ['sm','md']; 'md' is the unmodified base rule, so CSS carries only 'sm'
    expect(cssVariants('eui-ds-toggle', 'on'), 'a toggle size exists in CSS that the component API cannot produce').toEqual(['sm'])
  })

  it('R5b chip CSS declares exactly the tones and sizes the component can emit', () => {
    // the unmodified base rules ('default' tone, 'md' size) carry no class of their own
    const expected = [...CHIP_TONES.filter((t) => t !== 'default'), ...CHIP_SIZES.filter((s) => s !== 'md')].sort()
    expect(cssVariants('eui-ds-chip'), 'a chip tone/size exists in CSS that the component API cannot produce, or vice versa').toEqual(expected)
  })

  it('R5c state-block CSS declares exactly the tones the component can emit', () => {
    const expected = STATE_TONES.filter((t) => t !== 'neutral').sort() // 'neutral' is the base rule
    expect(cssVariants('eui-ds-state-icon'), 'a state tone exists in CSS that the component API cannot produce, or vice versa').toEqual(expected)
  })

  it('R5d spinner CSS declares exactly the sizes the component can emit', () => {
    // Every rung is declared, the default included: the component always writes the
    // class, so a size missing from CSS renders at the wrong diameter silently.
    expect(cssVariants('eui-ds-spinner'), 'a spinner size exists in CSS that the component API cannot produce, or vice versa').toEqual(
      [...SPINNER_SIZES].sort()
    )
  })

  it('R5e select-field CSS declares exactly the densities the component can emit', () => {
    const expected = DENSITIES.filter((d) => d !== 'default').sort() // 'default' is the base rule
    expect(
      cssVariants('eui-ds-select-field', 'light'), // 'light' is a colour variant, not a density
      'a select density exists in CSS that the component API cannot produce, or vice versa'
    ).toEqual(expected)
  })

  it('R5f modal CSS declares exactly the widths the component can emit', () => {
    // The base rule is the no-size default (content-sized under 680px), so a size
    // missing from CSS renders at that default instead of the width its caller asked for.
    expect(cssVariants('eui-modal'), 'a modal size exists in CSS that the component API cannot produce, or vice versa').toEqual(
      [...MODAL_SIZES].sort()
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

  it('R9 control heights come from a --control-h token', () => {
    // The drift this stops: 40/38/28/26px controls sharing a flex row. Judged on
    // the LAST compound of the selector, because that is the element the height
    // lands on — anchoring the whole selector let context overrides (a 30px
    // toolbar primary, a 32px lg segment) ship unseen.
    // Asserted as "the value IS a token", not "is not a raw px": the old detector
    // needed a digit right after `height:`, so `calc(38px * var(--ld-scale))`
    // walked through the one rule aimed at it. `ds-toggle` stays out of CONTROL —
    // R5 guards Toggle against TOGGLE_SIZES and its track is not a control box.
    const CONTROL =
      /^\.eui-(btn|ds-btn|ds-ctl|input|num|select|color-swatch|seg|seg-btn|ds-search|ds-select-field|menu-item|pop-item|row|boot)(\.[a-z-]+)*$/
    const OK = /^(var\(--(control-h|head-h)|auto|inherit|100%|fit-content|min-content|max-content)/
    // A calc() reading only tokens is composition (a rung less the well's own
    // padding); one carrying a `*` or a bare length is a scale, which R11 blocks.
    const composed = (v: string): boolean =>
      /^calc\(/.test(v) && v.includes('var(--') && !v.includes('*') && !/[\d.]+(px|rem|em|vh|vw|%)/.test(v)
    const hits: string[] = []
    for (const f of CSS) {
      const text = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // unwrap at-rules, or a nested rule is captured with `@media (…)` as its
        // selector and dropped — a breakpoint is where the next "bigger on a
        // large window" hack lives
        .replace(/@[a-z-]+[^{;]*\{/g, '')
      for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [, sels, body] = m
        const h = /(?:^|;)\s*(?:min-|max-)?height:\s*([^;]+)/.exec(body)
        if (h === null || OK.test(h[1].trim()) || composed(h[1].trim())) continue
        for (const sel of sels.split(',')) {
          const last = sel.trim().split(/\s+/).pop() ?? ''
          if (CONTROL.test(last)) hits.push(`${rel(f)} — ${sel.trim()} { height: ${h[1].trim()} }`)
        }
      }
    }
    expect(hits, 'a control declares a height that is not a --control-h* token — a raw px OR a calc() off one').toEqual([])
  })

  it('R10 no unitless multiplier token exists', () => {
    // Keyed on shape, not on the substring "scale": a unitless number declared as a
    // custom property is a multiplier by construction, whatever it is called
    // (--ld-zoom would pass a name-based rule). The one legitimate unitless value in
    // CSS is a stacking order, so such a token is legal exactly while every var()
    // that reads it is a z-index — and while it has a reader at all, since
    // "declared now, multiplied next commit" is the window a knob is born in.
    const declared: Array<{ name: string; at: string }> = []
    for (const f of CSS) {
      // blank out comments in place so line numbers survive
      read(f).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).split('\n').forEach((line, i) => {
        // matchAll, not exec: a compact token block puts several declarations on one
        // line. `}` terminates too, or `.eui-x{--zoom:1.3}` is invisible.
        for (const m of line.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:\s*-?[\d.]+\s*(?=[;}]|$)/g)) {
          declared.push({ name: m[1], at: `${rel(f)}:${i + 1}` })
        }
      })
    }
    const hits: string[] = []
    for (const { name, at } of declared) {
      const asSize: string[] = []
      let readers = 0
      for (const f of CSS) {
        read(f).split('\n').forEach((line, i) => {
          if (!new RegExp(`var\\(\\s*${name}[,)]`).test(line)) return
          readers += 1
          if (!/z-index\s*:/.test(line)) asSize.push(`${rel(f)}:${i + 1}`)
        })
      }
      if (asSize.length > 0) hits.push(`${at} — ${name} read as a metric at ${asSize.join(', ')}`)
      else if (readers === 0) hits.push(`${at} — ${name} is a unitless token nothing reads`)
    }
    expect(
      hits,
      'a unitless number token is a zoom, and a zoom is not a size: it lands on no ladder, makes one component render at ' +
        'N sizes, and leaks through inheritance across feature boundaries. Add the rung to tokens.css and a declared ' +
        'size to the primitive instead.'
    ).toEqual([])
  })

  it('R11 no size is computed by multiplication', () => {
    // Both operand orders — calc(14px * var(--x)) and calc(var(--x) * 14px).
    // Composition stays legal (offset = space + control-h + space); scaling does not.
    const hits = findLines(
      CSS,
      (l) =>
        /calc\([^;]*\*\s*var\(--/.test(l) ||
        /calc\([^;]*var\(--[^)]*\)\s*\*/.test(l) ||
        /calc\(\s*-?[\d.]+(px|rem|em)\s*\*/.test(l)
    )
    expect(
      hits,
      'a size produced by a multiplier is on no ladder by construction — name the step in tokens.css and reference it'
    ).toEqual([])
  })

  // R12 is reserved, not lost: "a type size comes from --fs-*/--label-*". It is
  // the one rule this ladder cannot land yet — ~260 raw px type values still ship
  // (base.css 65, ai.css 59, views.css 30, prefabs.css 27), so it arrives with the
  // migration that converts them, and it needs its own exemption list rather than
  // ALLOWED_LEGACY, which every other rule shares.

  it('R13 Spinner size is a declared step, never a number', () => {
    // The real gate is the type (SpinnerSize); this backs tsc so a numeric cannot
    // return through a JS call site. Requiring a digit keeps a string-union
    // expression — size={compact ? 'md' : 'lg'} — legal.
    const hits = findLines(TSX, (l) => /<Spinner[^>]*\bsize=\{[^}]*\d/.test(l))
    expect(
      hits,
      "Spinner's size is 'xs'|'sm'|'md'|'lg'|'xl'. A numeric size is the door the loading-screen scale walked through: " +
        'R3 blocked the CSS route and `<Spinner size={39} />` was hand-written into two .tsx files instead.'
    ).toEqual([])
  })

  it('R14 every var() names a custom property something declares', () => {
    // A missing custom property with no fallback resolves to `unset` and INHERITS,
    // so the rule renders someone else's value instead of failing loudly (four
    // shipped lines did). Declarations count from .tsx too — ParcelMap sets its own
    // from JSX — and comments are stripped first, or a name quoted in prose
    // (`/* --ghost: 4px */`) satisfies the rule written to catch it.
    const declared = new Set<string>()
    for (const f of [...CSS, ...TSX]) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, ' ')
      for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1])
      for (const m of text.matchAll(/['"](--[a-z0-9-]+)['"]/g)) declared.add(m[1])
    }
    const hits: string[] = []
    for (const f of CSS) {
      read(f).split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
          if (!declared.has(m[1])) hits.push(`${rel(f)}:${i + 1} — ${m[1]}`)
        }
      })
    }
    expect(hits, 'this var() names nothing — it inherits silently instead of rendering what the rule says').toEqual([])
  })

  it('R15 feature CSS never declares a ds-owned selector', () => {
    // R3 guards one naming prefix. The pre-`ds-` half of the ds carries no `-ds-`
    // infix, so features restyled .eui-btn / .eui-input / .eui-modal-body freely.
    // Matched per RULE, not per line: a wrapped selector list puts half its
    // selectors on lines that carry no `{`, so `.eui-input,\n.my-class {` would
    // slip past a line-based scan.
    const DS_OWNED = /\.eui-(ds-[a-z-]+|btn|input|num|select|link|row|modal[a-z-]*|shelf[a-z-]*|menu-item|toast)\b/
    const raw: string[] = []
    for (const f of NON_DS_CSS) {
      const text = read(f).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      for (const m of text.matchAll(/([^{}]+)\{/g)) {
        const sels = m[1]
        if (/^\s*@/.test(sels) || !DS_OWNED.test(sels)) continue
        // count to the selector's first non-space char: the match starts right after
        // the previous rule's `}`, so its leading newline belongs to the line before
        const start = (m.index ?? 0) + (sels.length - sels.trimStart().length)
        const line = text.slice(0, start).split('\n').length
        raw.push(`${rel(f)}:${line} — ${sels.trim().replace(/\s+/g, ' ').slice(0, 100)}`)
      }
    }
    const hits = raw.filter((h) => !ALLOWED_LEGACY.some((a) => h.startsWith(a)))
    expect(
      hits,
      'CONVENTIONS.md "Styling" — class prefixes are ownership. A primitive gets a size/variant prop, or the caller passes ' +
        'className and styles its OWN class'
    ).toEqual([])
  })

  it('ALLOWED_LEGACY is shrink-only — no stale exemptions', () => {
    // Each entry must still match something; when a migration removes the last
    // violation, the exemption has to go in the same commit.
    const allText = [...TSX, ...CSS].map((f) => `${rel(f)}\u0000${read(f)}`)
    for (const entry of ALLOWED_LEGACY) {
      const file = entry.split(':')[0]
      expect(allText.some((t) => t.startsWith(file + '\u0000')), `stale exemption: ${entry}`).toBe(true)
    }
  })
})
