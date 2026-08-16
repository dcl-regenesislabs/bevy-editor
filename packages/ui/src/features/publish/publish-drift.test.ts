// A publish state may not grow controls, sizes or classes of its own.
//
// The dialog was rebuilt on one skeleton — a ds Modal, one ds StateBlock body
// with no `actions` prop, and one PublishFooter that owns variant, size and
// order. That only holds while every state goes through it. Five rounds of
// one-state-at-a-time fixes drifted because a state CAN always render one more
// button, and nothing said it may not.
//
// publish-skeleton.test.tsx mounts every state and reads the DOM back, which is
// the stronger check wherever a rendered tree can answer the question. These
// scans cover what a render cannot: code that is written but not reachable from
// an enumerated state — a helper that hand-rolls a control, a variant left off a
// Button in a branch no fixture reaches, a class copied in from another feature
// and not yet used. A rendered state is a sample; the source is all of it.
//
//   R1  every <Button> in the feature names a variant. Button's default is
//       'default', which renders `.eui-btn` — the quiet editor-chrome control,
//       not the design system's pill (ds/index.tsx). The JSX for the two is
//       identical apart from the missing prop.
//   R2  no <Button> or <ConfirmButton> passes `size`. One size for the whole
//       flow: the ds default, which is what `.eui-modal-foot` carries in all
//       twenty other Modal call sites.
//   R3  every eui- class the feature names starts with `eui-publish`. A
//       whitelist rather than a ban list: it covers the classes publish used to
//       borrow (.eui-signin-row, .eui-account-empty-icon, .eui-home-modal), a
//       hand-written className="eui-link" where a component belongs, and every
//       class no feature has invented yet.
//   R4  the skeleton is assembled in one file. Modal and StateBlock are
//       rendered only by PublishModal.tsx, and Button/ConfirmButton only by
//       PublishFooter.tsx — so "which state hand-assembled this?" cannot have
//       an answer.
//
// Scans source TEXT (no rendering), modelled on
// features/worlds/no-whole-world-undeploy.test.ts: same walk, same skip list,
// same comment blanking, same self-exclusion. Executable text only — a ban has
// to be explainable and every explanation names what is banned. The flip side: a
// TRAILING comment may not mention it; put the sentence on its own line.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SELF = fileURLToPath(import.meta.url)
const PUBLISH = path.dirname(SELF)
const ROOT = path.resolve(PUBLISH, '..', '..', '..', '..', '..')

// Dependencies, build output, vendored skill docs, gitignored scratch and the
// nested worktree checkout — none of it is this repo's source.
const SKIP = new Set([
  'node_modules',
  'dist',
  'bin',
  'release',
  'staging',
  'artifacts',
  'size-reports',
  'docs',
  '.git',
  '.claude',
  '.agents',
  'agent',
  '.node-cache',
  '.dclcache',
  '.dev-shim'
])
const CODE = /\.(?:ts|tsx|mjs|cjs|js)$/
const TEST = /\.test\.tsx?$/

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(full)
    return CODE.test(e.name) ? [full] : []
  })
}

const ALL = walk(PUBLISH).filter((f) => f !== SELF)
// The tests spell the violations out in order to check for them; only shipped
// code is judged.
const SHIPPED = ALL.filter((f) => !TEST.test(f))
const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join('/')
const read = (f: string): string => readFileSync(f, 'utf8')

// Blanks comments while keeping line numbers, so a hit reports where it is.
// Block comments become spaces; a line that starts with // or * (jsdoc) drops.
function executable(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*(?:\/\/|\*)/.test(l) ? '' : l))
    .join('\n')
}

// ---- reading a JSX opening tag ----

// A tag, not a line: `<Button` and its `variant` routinely sit on different
// lines once a state passes four props, and a per-line regex reads that as a
// Button with no variant. Walks to the `>` that closes the tag, skipping the
// ones inside prop expressions (`onClick={() => …}`) and string literals.
export interface TagSite {
  tag: string
  line: number
}

export function tagSites(text: string, name: string): TagSite[] {
  const out: TagSite[] = []
  const re = new RegExp(`<${name}\\b`, 'g')
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    let depth = 0
    let quote = ''
    let i = m.index + m[0].length
    for (; i < text.length; i++) {
      const ch = text[i]
      if (quote !== '') {
        if (ch === quote && text[i - 1] !== '\\') quote = ''
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    out.push({ tag: text.slice(m.index, i + 1), line: text.slice(0, m.index).split('\n').length })
  }
  return out
}

export const openTags = (text: string, name: string): string[] => tagSites(text, name).map((s) => s.tag)

export const namesVariant = (tag: string): boolean => /\bvariant\s*=/.test(tag)
export const passesSize = (tag: string): boolean => /\bsize\s*=/.test(tag)
export const namesInlineTone = (tag: string): boolean => /\btone\s*=\s*(?:"inline"|'inline'|\{'inline'\})/.test(tag)

// ---- the classes a feature may name ----

const EUI_CLASS = /\beui-[a-z0-9-]+/g

export function foreignClasses(line: string): string[] {
  return (line.match(EUI_CLASS) ?? []).filter((c) => !c.startsWith('eui-publish'))
}

const at = (file: string, site: TagSite): string =>
  `${rel(file)}:${site.line} — ${site.tag.replace(/\s+/g, ' ').slice(0, 80)}`

describe('no publish state grows a control of its own', () => {
  it('R1 every Button names its variant', () => {
    const hits: string[] = []
    for (const f of SHIPPED) {
      for (const site of tagSites(executable(read(f)), 'Button')) {
        if (!namesVariant(site.tag)) hits.push(at(f, site))
      }
    }
    expect(
      hits,
      "a <Button> with no `variant` gets 'default', which renders .eui-btn — the flat editor-chrome control the toolbar uses, not the design system's pill. Nothing errors and nothing looks broken in the JSX; the action row just stops reading as one. The publish flow has exactly three variants, one per slot, and PublishFooter picks them: ghost (secondary) · danger (destructive) · primary."
    ).toEqual([])
  })

  it('R2 nothing passes a button size', () => {
    const hits: string[] = []
    for (const f of SHIPPED) {
      const text = executable(read(f))
      for (const name of ['Button', 'ConfirmButton']) {
        for (const site of tagSites(text, name)) if (passesSize(site.tag)) hits.push(at(f, site))
      }
    }
    expect(
      hits,
      'one button size for the whole flow: the ds default (sm), which is what .eui-modal-foot carries in every other dialog in the app. A state that sizes its own button is a state saying its decision is bigger than the others — the exact drift that split this dialog into a body row and a footer row in the first place.'
    ).toEqual([])
  })

  it('R3 names no class that is not its own', () => {
    const hits: string[] = []
    for (const f of SHIPPED) {
      executable(read(f))
        .split('\n')
        .forEach((line, i) => {
          for (const cls of foreignClasses(line)) hits.push(`${rel(f)}:${i + 1} — ${cls}`)
        })
    }
    expect(
      hits,
      'publish styles itself with .eui-publish-* and nothing else. A class from another feature (.eui-signin-row, .eui-account-empty-icon, .eui-home-modal) makes this dialog change shape when that feature is restyled — publish\'s body spacing already drifted once that way. A ds class written out by hand (className="eui-link", "eui-modal-foot") is a role being re-rolled: render the component instead — ds/canonical-roles.ts says which.'
    ).toEqual([])
  })

  it('R5 every LinkButton is the hyperlink tone', () => {
    const hits: string[] = []
    for (const f of SHIPPED) {
      for (const site of tagSites(executable(read(f)), 'LinkButton')) {
        if (!namesInlineTone(site.tag)) hits.push(at(f, site))
      }
    }
    expect(
      hits,
      'a <LinkButton> with no `tone` renders the default one: a 10px UPPERCASE MONO caption. Mid-sentence — which is the only place this feature puts one — that is a caption pretending to be a hyperlink, and it is one of the three control vocabularies the rebuild collapsed. The failing location reads "…in spawner.ts:10", so it takes the surrounding type: tone="inline".'
    ).toEqual([])
  })

  it('R4 assembles the skeleton in one place', () => {
    const skeleton: Record<string, string[]> = { Modal: [], StateBlock: [], Button: [], ConfirmButton: [] }
    for (const f of SHIPPED) {
      const text = executable(read(f))
      for (const name of Object.keys(skeleton)) skeleton[name].push(...tagSites(text, name).map(() => path.basename(f)))
    }
    const owner = (name: string, file: string): void => {
      expect(
        skeleton[name],
        `<${name}> is rendered outside ${file}. There is one skeleton — ds Modal + one StateBlock body + one PublishFooter — and a state that assembles a second one is a state whose layout no longer comes from the shared shape. That is what three action-row implementations looked like before they were merged.`
      ).toEqual(skeleton[name].map(() => file))
    }
    owner('Modal', 'PublishModal.tsx')
    owner('StateBlock', 'PublishModal.tsx')
    owner('Button', 'PublishFooter.tsx')
    owner('ConfirmButton', 'PublishFooter.tsx')
    expect(skeleton.Modal, 'the dialog is one Modal').toHaveLength(1)
    expect(skeleton.StateBlock, 'every state shares one body').toHaveLength(1)
  })
})

describe('the guard is not vacuous', () => {
  it('reads the files the rules are about', () => {
    const names = SHIPPED.map((f) => path.basename(f))
    for (const f of ['PublishModal.tsx', 'PublishFooter.tsx', 'publish-view.tsx']) {
      expect(names, `${f} is where these rules are broken, so the scan has to be reading it`).toContain(f)
    }
  })

  it('there are Buttons for R1 and R2 to have judged', () => {
    const tags = SHIPPED.flatMap((f) => openTags(executable(read(f)), 'Button'))
    expect(
      tags.length,
      'R1 and R2 pass for free if the feature renders no Button at all. PublishFooter renders one per filled slot.'
    ).toBeGreaterThan(0)
  })

  it('there is a LinkButton for R5 to have judged', () => {
    const tags = SHIPPED.flatMap((f) => openTags(executable(read(f)), 'LinkButton'))
    expect(tags.length, 'R5 passes for free if the feature renders no LinkButton at all').toBeGreaterThan(0)
  })

  it('there are eui- classes for R3 to have judged', () => {
    const classes = SHIPPED.flatMap((f) => executable(read(f)).match(EUI_CLASS) ?? [])
    expect(classes.length, 'R3 passes for free if the feature names no classes at all').toBeGreaterThan(5)
  })
})

describe('the guard itself', () => {
  it('R1 reads a whole tag, however it is wrapped', () => {
    const wrapped = `
      <Button
        key={slot}
        variant={VARIANT[slot]}
        onClick={() => close(">")}
      >
        {action.label}
      </Button>`
    expect(openTags(wrapped, 'Button')).toHaveLength(1)
    expect(namesVariant(openTags(wrapped, 'Button')[0])).toBe(true)
    expect(namesVariant(openTags('<Button onClick={go}>Publish</Button>', 'Button')[0])).toBe(false)
    expect(namesVariant(openTags('<Button variant="ghost" disabled>Back</Button>', 'Button')[0])).toBe(true)
  })

  it('R1 tells Button from the components whose names contain it', () => {
    expect(openTags('<ConfirmButton label="Cancel publish" onConfirm={stop} />', 'Button')).toEqual([])
    expect(openTags('<IconButton tip="Close" />', 'Button')).toEqual([])
    expect(openTags('<ConfirmButton confirm="Stop publishing?" />', 'ConfirmButton')).toHaveLength(1)
  })

  it('R5 tells the hyperlink tone from every other', () => {
    expect(namesInlineTone(openTags('<LinkButton tone="inline" onClick={go}>x</LinkButton>', 'LinkButton')[0])).toBe(true)
    expect(namesInlineTone(openTags('<LinkButton onClick={go}>x</LinkButton>', 'LinkButton')[0])).toBe(false)
    expect(namesInlineTone(openTags('<LinkButton tone="danger">Delete</LinkButton>', 'LinkButton')[0])).toBe(false)
  })

  it('R2 sees a size wherever it sits in the tag', () => {
    expect(passesSize(openTags('<Button variant="primary" size="md">Publish</Button>', 'Button')[0])).toBe(true)
    expect(passesSize(openTags('<Button size={big ? "md" : "sm"} variant="ghost" />', 'Button')[0])).toBe(true)
    expect(passesSize(openTags('<Button variant="ghost" onClick={resize}>Fit</Button>', 'Button')[0])).toBe(false)
  })

  it('R3 keeps the feature’s own classes and flags everyone else’s', () => {
    expect(foreignClasses('<p className="eui-publish-note">{line}</p>')).toEqual([])
    expect(foreignClasses('<div className={`eui-publish-step ${state}`}>')).toEqual([])
    expect(foreignClasses('<div className="eui-signin-row">')).toEqual(['eui-signin-row'])
    expect(foreignClasses('<button className="eui-link" onClick={open}>')).toEqual(['eui-link'])
    expect(foreignClasses('<div className="eui-account-empty-icon eui-publish-note">')).toEqual(['eui-account-empty-icon'])
  })
})
