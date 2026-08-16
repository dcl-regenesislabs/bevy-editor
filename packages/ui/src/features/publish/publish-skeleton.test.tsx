// The dialog every publish state actually RENDERS, asserted on the DOM.
//
// publish-controls.test.ts scans the source for shapes that were deleted, and
// publish-view.test.tsx asserts the descriptor a state produces. Neither can
// answer the questions that made five rounds of fixes regress, because the
// answers depend on what the components DO with the props they are handed:
//
//   P1  a <Button> with no `variant` is not a syntax error — it renders
//       `.eui-btn`, the quiet editor-chrome control, instead of the design
//       system's pill. The two look nothing alike and the JSX looks identical.
//   P2  a size is a class, and "one size for the whole flow" is a statement
//       about ALL the states at once — no single file can be scanned for it.
//   P3  how many controls a state puts on screen is the rendered count, not the
//       number of `<Button>`s written down: slots are conditional.
//   P4  a borrowed layout class only matters once it is in the tree.
//   P5  whether a control dismisses the dialog is what its handler DOES.
//   P6  "hand-assembled its own layout" means a pill outside the one footer, or
//       a second body beside the one StateBlock.
//
// So this mounts the real PublishModal in each enumerated state
// (publish-states.ts) and reads the tree back. The STORES are mocked, never the
// components: PublishModal, publishView, PublishFooter, Modal, StateBlock, Shelf
// and CardPicker are all the shipped ones, so a state that re-rolls a row shows
// up here as a pill that is not inside `.eui-modal-foot`.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { PublishState } from './publish-flow'
import type { WorldEntry } from '../worlds/inventory'
import { caseState, FAMILY_CAP, PUBLISH_CASES, SCENE_DIR, SCENE_TITLE, type PublishCase, type WorldsStatus } from './publish-states'
import { mount, type Mounted } from '../../test/render'
import { PublishModal } from './PublishModal'

// The flow's state, and every side effect a control can have, in one place the
// mock factories (hoisted above the imports) can reach.
const store = vi.hoisted(() => {
  // What the real flow would have done. Nothing here drives the assertions —
  // it exists so a press has somewhere to land, and so the guard can prove its
  // own clicks reach the handlers (see "the guard is not vacuous").
  const fired: string[] = []
  return {
    job: null as PublishState | null,
    wallet: null as string | null,
    worlds: [] as WorldEntry[],
    status: 'ready' as WorldsStatus,
    error: null as string | null,
    fired,
    fire:
      (name: string) =>
      (): void => {
        fired.push(name)
      }
  }
})

vi.mock('./publish-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./publish-flow')>()),
  usePublish: () => store.job,
  resetPublish: store.fire('resetPublish'),
  startPublish: store.fire('startPublish'),
  cancelPublish: store.fire('cancelPublish'),
  confirmPublish: store.fire('confirmPublish'),
  previewMove: store.fire('previewMove'),
  confirmMove: store.fire('confirmMove'),
  cancelMove: store.fire('cancelMove')
}))

vi.mock('../worlds/worlds-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worlds/worlds-store')>()),
  ensureWorlds: () => undefined,
  refreshWorlds: store.fire('refreshWorlds'),
  useWorlds: () => ({ worlds: store.worlds, status: store.status, error: store.error })
}))

// The dialog asks whether the identity is still valid as well as who it is —
// `wallet` is computed once at module init and never clears on expiry. Here the
// two agree: a case with a wallet is a case that is signed in.
vi.mock('../account/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../account/auth')>()),
  hasValidIdentity: () => store.wallet !== null,
  useAuth: () => ({ wallet: store.wallet, profile: null, signIn: store.fire('signIn'), signOut: store.fire('signOut') })
}))

// Never settles: the real one resolves after the mount and would write state
// outside act(). Nothing asserted here depends on the local footprint.
vi.mock('./publish-preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./publish-preflight')>()),
  readLocalFootprint: () => new Promise<null>(() => undefined)
}))

// ---- what "another feature's class" means, read off the stylesheets ----
//
// Derived rather than listed, so a class added to another feature tomorrow is
// already banned here. ds/ is subtracted: those classes are the shared
// vocabulary every dialog renders. publish.css's own are what publish may style,
// and publish-controls.test.ts G5 pins that half.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKIP = new Set(['node_modules', 'dist', 'bin', 'release', 'staging', 'artifacts', 'size-reports', 'docs', '.git'])

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : cssFiles(full)
    return e.name.endsWith('.css') ? [full] : []
  })
}

/** the first class of each selector — the one the rule belongs to */
export function ruleOwners(css: string): Set<string> {
  const owners = new Set<string>()
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const selector of rule[1].split(',')) {
      const first = /\.([A-Za-z0-9_-]+)/.exec(selector)
      if (first !== null && first[1].startsWith('eui-')) owners.add(first[1])
    }
  }
  return owners
}

function classesOwnedElsewhere(): Set<string> {
  const ds = new Set<string>()
  const other = new Set<string>()
  for (const file of cssFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/')
    if (rel.startsWith('features/publish/')) continue
    const into = rel.startsWith('ds/') ? ds : other
    for (const owner of ruleOwners(readFileSync(file, 'utf8'))) into.add(owner)
  }
  for (const shared of ds) other.delete(shared)
  return other
}

// ---- the tree, as the guards read it ----

// Both spellings a design-system Button can render: `.eui-ds-btn` is the pill,
// `.eui-btn` is what a MISSING variant falls back to. P1 is the assertion that
// the second one never appears, so it has to be in the selector.
const PILL = '.eui-ds-btn, .eui-btn'
const VARIANTS = ['primary', 'secondary', 'ghost', 'danger']
const SIZES = ['xs', 'sm', 'md', 'lg', 'xl']
const DISMISSAL = /^(close|cancel|done|ok|dismiss)$/i

// Every kind of <button> a design-system component renders inside this dialog:
// the footer pill, the Modal's ✕, a Shelf's disclosure header, a CardPicker
// card, and an inline hyperlink in prose. P7 is the assertion that the dialog
// renders NOTHING else — the guards above all look for pills, so a hand-rolled
// <button className="eui-publish-…"> in the body was invisible to every one of
// them, which is exactly what "Show details" was.
const DS_CONTROLS = [
  'eui-ds-btn',
  'eui-modal-x',
  'eui-shelf-head',
  'eui-ds-pick',
  'eui-ds-map-cell',
  'eui-link',
  'eui-ds-toggle'
]

interface Opened {
  view: Mounted
  onClose: Mock
  onManageWorld: Mock
}

function open(c: PublishCase): Opened {
  const s = caseState(c)
  store.job = s.job
  store.wallet = s.wallet
  store.worlds = s.worlds
  store.status = s.worldsStatus
  store.error = s.worldsError
  store.fired.length = 0
  const onClose = vi.fn()
  const onManageWorld = vi.fn()
  const view = mount(
    <PublishModal
      dir={SCENE_DIR}
      sceneTitle={SCENE_TITLE}
      currentWorld={s.picked}
      onClose={onClose}
      onManageWorld={onManageWorld}
    />
  )
  return { view, onClose, onManageWorld }
}

const label = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function caseById(id: string): PublishCase {
  const found = PUBLISH_CASES.find((c) => c.id === id)
  if (found === undefined) throw new Error(`publish-states.ts no longer enumerates ${id}`)
  return found
}

/** every state, mounted one at a time, handed to `check`, then unmounted */
function eachState(check: (c: PublishCase, o: Opened) => void): void {
  for (const c of PUBLISH_CASES) {
    const o = open(c)
    try {
      check(c, o)
    } finally {
      o.view.unmount()
    }
  }
}

describe('the publish dialog, rendered', () => {
  it('P1 every control is the design system’s pill, with a variant it named', () => {
    eachState((c, o) => {
      for (const pill of o.view.all(PILL)) {
        expect(
          pill.classList.contains('eui-ds-btn'),
          `${c.id}: “${label(pill)}” rendered .eui-btn — the flat editor-chrome button. A <Button> with no \`variant\` falls back to it, which is how an action row stops looking like an action row. Name the variant: ghost / danger / primary, one per slot, in PublishFooter.`
        ).toBe(true)
        expect(
          VARIANTS.filter((v) => pill.classList.contains(v)),
          `${c.id}: “${label(pill)}” carries no single variant class`
        ).toHaveLength(1)
      }
    })
  })

  it('P2 the whole flow is one button size', () => {
    const sizes = new Set<string>()
    eachState((_c, o) => {
      for (const pill of o.view.all(PILL)) for (const s of SIZES) if (pill.classList.contains(s)) sizes.add(s)
    })
    expect(
      [...sizes],
      'the publish flow uses the ds default (sm) everywhere. A second size means a state passed `size=` — and the states then disagree about how big a decision is, which is the drift the one-footer rewrite removed.'
    ).toEqual(['sm'])
  })

  it('P3 no state offers more than its family allows, and the primary is last', () => {
    eachState((c, o) => {
      const pills = o.view.all(PILL)
      expect(
        pills.length,
        `${c.id} (${c.family}) shows ${pills.map(label).join(' · ')} — a ${c.family} state may offer at most ${FAMILY_CAP[c.family]} (§3 R-A1). Every extra control is a decision the creator did not come here to make.`
      ).toBeLessThanOrEqual(FAMILY_CAP[c.family])
      const primaries = pills.filter((p) => p.classList.contains('primary'))
      expect(primaries.length, `${c.id} has ${primaries.length} primary actions — a dialog has one Enter default`).toBeLessThanOrEqual(1)
      if (primaries.length === 1) {
        expect(pills[pills.length - 1], `${c.id}: the primary is not the trailing control`).toBe(primaries[0])
      }
      expect(
        c.family === 'wait' && primaries.length > 0,
        `${c.id}: a running job has no forward action — its only lever is stopping it`
      ).toBe(false)
      expect(new Set(pills.map(label)).size, `${c.id} shows the same label twice`).toBe(pills.length)
    })
  })

  it('P4 borrows no other feature’s layout class, and hand-writes no link into the action row', () => {
    const foreign = classesOwnedElsewhere()
    eachState((c, o) => {
      const borrowed = new Set<string>()
      for (const el of o.view.all('*')) for (const cls of Array.from(el.classList)) if (foreign.has(cls)) borrowed.add(cls)
      expect(
        [...borrowed],
        `${c.id} renders a class another feature's stylesheet owns. Publish is styled by publish.css alone: a borrowed class makes this dialog change shape when that feature is restyled, and it is how .eui-signin-row and .eui-account-empty-icon ended up here. Render the canonical component (ds/canonical-roles.ts), or add an .eui-publish-* rule.`
      ).toEqual([])
      expect(
        o.view.all('.eui-modal-foot .eui-link').map(label),
        `${c.id} puts a link in the action row. An action is a pill; LinkButton tone="inline" belongs INSIDE body prose, never beside the buttons.`
      ).toEqual([])
      expect(
        o.view.all('.eui-modal-body .eui-link:not(.inline)').map(label),
        `${c.id} renders a LinkButton in the body without tone="inline" — that tone is a 10px uppercase mono CAPTION, and a caption in the middle of a sentence is the mixed control vocabulary this dialog was rebuilt to end. The failing location is a hyperlink inside its sentence.`
      ).toEqual([])
    })
  })

  it('P5 the ✕ is the only control whose job is dismissal', () => {
    for (const c of PUBLISH_CASES) {
      const probe = open(c)
      const labels = probe.view.all(PILL).map(label)
      expect(probe.view.all('.eui-modal-x'), `${c.id} does not have exactly one ✕`).toHaveLength(1)
      probe.view.unmount()

      for (const l of labels) {
        expect(
          DISMISSAL.test(l),
          `${c.id}: “${l}” is a bare dismissal and the ✕ already is one. A control that stays in the dialog says where it goes (“Choose another world”, “Back”); a control that leaves is the ✕ — §3 R-A2.`
        ).toBe(false)
      }

      // Pressed one at a time, each on its own mount: the question is what THIS
      // control does, and an earlier press can change the state underneath.
      for (let i = 0; i < labels.length; i++) {
        const o = open(c)
        o.view.click(o.view.all(PILL)[i])
        if (o.onClose.mock.calls.length > 0) {
          expect(
            o.onManageWorld.mock.calls.length,
            `${c.id}: “${labels[i]}” closes the dialog and does nothing else — that is the ✕ with a label on it. Only a control that also takes the creator somewhere (Manage world) may close.`
          ).toBeGreaterThan(0)
        }
        o.view.unmount()
      }

      const x = open(c)
      x.view.click(x.view.find('.eui-modal-x'))
      expect(x.onClose, `${c.id}: the ✕ does not close`).toHaveBeenCalled()
      x.view.unmount()
    }
  })

  it('P6 renders one body and one action row, and assembles neither by hand', () => {
    eachState((c, o) => {
      expect(
        o.view.all('.eui-ds-state'),
        `${c.id} does not render exactly one StateBlock — that component IS the body of every state, and a second one is a state hand-assembling its own`
      ).toHaveLength(1)
      expect(o.view.find('.eui-ds-state-t')?.textContent ?? '', `${c.id} has no headline`).not.toBe('')

      const pills = o.view.all(PILL)
      for (const pill of pills) {
        expect(
          pill.closest('.eui-modal-foot') !== null,
          `${c.id}: “${label(pill)}” sits outside the Modal footer. Actions live in ONE place — the footer PublishFooter fills. A button in the body is a state re-rolling an action row, which is how this dialog ended up with three of them.`
        ).toBe(true)
      }
      expect(
        o.view.all('.eui-modal-foot'),
        `${c.id}: a state with no actions renders no footer strip at all (PublishFooter returns undefined), and a state with actions renders exactly one`
      ).toHaveLength(pills.length === 0 ? 0 : 1)

      const shelves = o.view.all('.eui-shelf')
      expect(shelves.length, `${c.id} discloses more than once`).toBeLessThanOrEqual(1)
      for (const s of shelves) {
        expect(s.closest('.eui-modal-body') !== null, `${c.id}: the disclosure is not in the body`).toBe(true)
      }
    })
  })

  it('P7 clicks nothing the design system did not build', () => {
    eachState((c, o) => {
      const strays = o.view
        .all('button')
        .filter((b) => !DS_CONTROLS.some((cls) => b.classList.contains(cls)))
        .map(label)
      expect(
        strays,
        `${c.id} renders a control that is not a ds component: ${strays.join(' · ')}. Every other guard here looks for pills, so a hand-rolled <button> in the body is invisible to all of them — which is how "Show details" sat in an action row in a third control vocabulary. Render Button (footer only), LinkButton tone="inline" (inside prose) or Shelf (a disclosure).`
      ).toEqual([])
    })
  })

  it('P8 says a state’s headline once', () => {
    eachState((c, o) => {
      const headline = o.view.find('.eui-ds-state-t')?.textContent ?? ''
      const body = (o.view.find('.eui-modal-body')?.textContent ?? '').replace(/\s+/g, ' ')
      expect(
        body.split(headline).length - 1,
        `${c.id}: “${headline}” appears more than once in the body. The headline slot and the note (or the step list) were fed the same sentence — a refusal stated twice in two type sizes, one line apart.`
      ).toBe(1)
    })
  })
})

describe('the guard is not vacuous', () => {
  it('mounts the real dialog, in every enumerated state', () => {
    expect(PUBLISH_CASES.length, 'the spec enumerates 19 states (B1–B5, C1, W1–W3, D1–D7, O1–O3)').toBe(19)
    const seen = new Set<string>()
    eachState((c, o) => {
      expect(o.view.find('.eui-modal'), `${c.id} did not mount`).not.toBeNull()
      for (const pill of o.view.all(PILL)) seen.add(label(pill))
    })
    // P1, P2, P3 and P5 all pass for free on a dialog that renders no controls.
    expect(seen.size, 'the states should between them offer most of §6’s actions').toBeGreaterThanOrEqual(10)
    expect([...seen]).toContain('Publish')
    expect([...seen]).toContain('Jump in')
  })

  it('presses reach the flow', () => {
    const o = open(caseById('C1'))
    o.view.click(o.view.byText('Publish', 'button'))
    expect(
      store.fired,
      'pressing Publish never reached the flow — if a click does nothing, every "does this control dismiss the dialog?" assertion in P5 passes for free'
    ).toContain('startPublish')
    o.view.unmount()
  })

  it('derives the P4 ban list from stylesheets that are actually there', () => {
    const foreign = classesOwnedElsewhere()
    expect(foreign.size, 'no other feature CSS was read — the P4 ban list would be empty').toBeGreaterThan(100)
    for (const cls of ['eui-signin-row', 'eui-account-empty-icon', 'eui-home-modal']) {
      expect(foreign, `${cls} is a class publish used to borrow; P4 has to still know it is foreign`).toContain(cls)
    }
    for (const cls of ['eui-modal-foot', 'eui-ds-btn', 'eui-ds-state', 'eui-shelf']) {
      expect(foreign, `${cls} is design-system vocabulary — banning it would fail every state`).not.toContain(cls)
    }
  })
})

describe('the guard itself', () => {
  it('reads the owner of a rule, not every class in the selector', () => {
    expect([...ruleOwners('.eui-home-modal .eui-modal-body { padding: 0 }')]).toEqual(['eui-home-modal'])
    expect([...ruleOwners('.eui-publish-step, .eui-publish-note { margin: 0 }')]).toEqual(['eui-publish-step', 'eui-publish-note'])
    expect([...ruleOwners('/* .eui-ghost is gone */ .eui-publish-btn { gap: 6px }')]).toEqual(['eui-publish-btn'])
    expect([...ruleOwners('.eui-publish-step .ic { width: 18px }')]).toEqual(['eui-publish-step'])
    expect([...ruleOwners('button.plain { border: 0 }')]).toEqual([])
  })
})
