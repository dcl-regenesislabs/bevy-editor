// Every state of the publish dialog, as a descriptor.
//
// The dialog's shape is now data: one total function turns the flow's state into
// a family, a headline, evidence, at most one disclosure and at most one action
// per slot. That is what makes these assertions possible at all — before it,
// "does this state have two dismissals?" could only be answered by looking at a
// screenshot, which is exactly how five rounds of fixes kept regressing.
//
// A .tsx rather than a .ts because the descriptor carries React nodes (the
// picker, the map, the log), so it belongs to the ui-dom project: publish-flow
// reads localStorage at module scope and cannot be imported in the node project.
import { describe, expect, it, vi } from 'vitest'
import {
  MARKS,
  publishView,
  type ActionSlot,
  type PublishFamily,
  type PublishView,
  type PublishViewInput
} from './publish-view'
import type { PublishBlock, PublishPhase, PublishReview } from './publish-flow'
import {
  caseState,
  CONFLICT,
  FAMILY_CAP,
  FAMILY_MARKS,
  IDLE_JOB,
  JOB_WORLD,
  job,
  MOVED,
  PICKED_WORLD,
  PUBLISH_CASES,
  SCENE_DIR,
  SCENE_TITLE,
  UNREADABLE,
  WALLET,
  worldEntry
} from './publish-states'

const close = vi.fn()

// Only what a control CALLS is mocked: the descriptor is the real one.
const started = vi.hoisted(() => [] as Array<[string, string]>)
vi.mock('./publish-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./publish-flow')>()),
  startPublish: (dir: string, world: string) => {
    started.push([dir, world])
  }
}))

function view(over: Partial<PublishViewInput> = {}): PublishView {
  return publishView({
    job: IDLE_JOB,
    wallet: WALLET,
    signIn: () => undefined,
    worlds: [worldEntry(PICKED_WORLD)],
    worldsStatus: 'ready',
    worldsError: null,
    dir: SCENE_DIR,
    sceneTitle: SCENE_TITLE,
    picked: PICKED_WORLD,
    localBase: '0,0',
    attachLog: () => undefined,
    onPick: () => undefined,
    onManageWorld: () => undefined,
    close,
    ...over
  })
}

// The enumeration lives in publish-states.ts so the render guard walks the same
// states this one does.
const VIEWS: Record<string, PublishView> = Object.fromEntries(PUBLISH_CASES.map((c) => [c.id, view(caseState(c))]))

const ALL = Object.entries(VIEWS)

const CAP: Record<PublishFamily, { max: number; slots: ActionSlot[] }> = {
  choose: { max: FAMILY_CAP.choose, slots: ['primary'] },
  decide: { max: FAMILY_CAP.decide, slots: ['secondary', 'destructive', 'primary'] },
  wait: { max: FAMILY_CAP.wait, slots: ['destructive'] },
  outcome: { max: FAMILY_CAP.outcome, slots: ['secondary', 'primary'] },
  blocked: { max: FAMILY_CAP.blocked, slots: ['secondary', 'primary'] }
}

const slotsOf = (v: PublishView): ActionSlot[] => Object.keys(v.actions) as ActionSlot[]

describe('every publish state', () => {
  // The caps below are per family, so a state that lands in the wrong one is
  // judged against the wrong table — and the table is the spec's, not the
  // ladder's, which is why publish-states.ts states it independently.
  it('lands in the family its cap is written for', () => {
    for (const c of PUBLISH_CASES) expect(VIEWS[c.id].family, `${c.id}`).toBe(c.family)
  })

  it('G7 has a headline', () => {
    for (const [id, v] of ALL) expect(v.headline, `${id} has no headline`).not.toBe('')
  })

  it('G8 respects its family’s action cap and legal slots', () => {
    for (const [id, v] of ALL) {
      const slots = slotsOf(v)
      expect(slots.length, `${id} (${v.family}) has too many actions`).toBeLessThanOrEqual(CAP[v.family].max)
      for (const s of slots) expect(CAP[v.family].slots, `${id} (${v.family}) may not fill ${s}`).toContain(s)
    }
  })

  // There is exactly one dismissal control in this dialog and it is the ✕.
  it('G9 binds no action to close', () => {
    for (const [id, v] of ALL) {
      for (const s of slotsOf(v)) expect(v.actions[s]?.onClick, `${id}.${s} duplicates the ✕`).not.toBe(close)
    }
  })

  it('G10 labels no action with a bare dismissal verb', () => {
    for (const [id, v] of ALL) {
      for (const s of slotsOf(v)) {
        expect(/^(close|cancel|done|ok)$/i.test(v.actions[s]?.label ?? ''), `${id}.${s} is a dismissal`).toBe(false)
      }
    }
  })

  // A compiler error is deterministic: the identical build fails identically.
  it('G11 offers Try again only when trying again could work', () => {
    expect(slotsOf(VIEWS.O3)).toEqual([])
    expect(slotsOf(VIEWS.O2)).toEqual(['primary'])
    expect(VIEWS.O2.actions.primary?.label).toBe('Try again')
  })

  // The log states are the only ones that disclose, so the rule has to be read
  // off each case's own fixture: keyed on the id it never judged the states the
  // Build log actually belongs to, and an empty "Build log 0" passed.
  it('G12 discloses nothing when there is nothing to disclose', () => {
    for (const c of PUBLISH_CASES) {
      const v = VIEWS[c.id]
      const logs = caseState(c).job.logs.length
      if (logs === 0) expect(v.disclosure, `${c.id} discloses with no log`).toBe(null)
      if (v.family === 'choose' || v.family === 'decide' || v.family === 'blocked') {
        expect(v.disclosure, `${c.id} is not a state with a log`).toBe(null)
      }
    }
    expect(VIEWS.W1.disclosure).toBe(null)
    expect(VIEWS.W2.disclosure?.title).toBe('Build log')
    // and the rule bites where it matters: a finished error WITH a log discloses it
    const failed = view({ job: job({ phase: 'error', world: JOB_WORLD, error: 'nope', logs: ['a', 'b'] }) })
    expect(failed.disclosure).toEqual({ title: 'Build log', count: 2, children: expect.anything() })
  })

  // A stray backdrop click may not discard an unanswered question or abandon an
  // in-flight scene.json write. Nothing is pending in a state that refuses
  // before the job starts (B1–B3), so those dismiss like the picker does; B4/B5
  // are a pre-flight VERDICT, and a verdict is answered, not swiped away.
  it('G13 lets the backdrop dismiss only what has nothing pending', () => {
    for (const [id, v] of ALL) {
      const verdict = id === 'B4' || id === 'B5'
      const pending = v.family === 'wait' || v.family === 'decide' || verdict
      expect(v.scrimClose, `${id} scrim`).toBe(!pending)
    }
  })

  // The last field a state could still pick for itself. §6's table lives in
  // publish-states.ts, so this compares the dialog against the spec, not against
  // the ladder that produced it.
  it('G18 wears the mark its family allows, and no other', () => {
    for (const c of PUBLISH_CASES) {
      const v = VIEWS[c.id]
      expect(FAMILY_MARKS[c.family], `${c.id} (${c.family}) may not wear the ${c.mark} mark`).toContain(c.mark)
      expect(v.tone, `${c.id} tone`).toBe(MARKS[c.mark].tone)
      expect(v.icon, `${c.id} icon`).toBe(MARKS[c.mark].icon)
      expect(v.align, `${c.id} align`).toBe(c.align)
    }
  })

  // Three states printed their headline and then said it again in the note: the
  // headlines were lifted out of the notes without being lifted OUT of them.
  it('G19 never says in the note what the headline just said', () => {
    for (const [id, v] of ALL) {
      if (typeof v.note !== 'string') continue
      expect(
        v.note.toLowerCase().startsWith(v.headline.toLowerCase()),
        `${id}: “${v.headline}” is repeated by its own note — the note carries what the headline does not`
      ).toBe(false)
    }
  })

  it('G14 warns that closing hides rather than stops, and only then', () => {
    for (const [id, v] of ALL) {
      const hides = id === 'W2' || id === 'W3'
      expect(v.closeTip, `${id} tip`).toBe(hides ? 'Hide — publishing continues' : 'Close')
    }
  })

  it('G15 is total — every reachable combination yields a view', () => {
    const phases: PublishPhase[] = ['idle', 'checking', 'review', 'blocked', 'building', 'uploading', 'success', 'error']
    const reviews: Array<PublishReview | null> = [null, CONFLICT, MOVED, UNREADABLE]
    const blocks: Array<PublishBlock | null> = [null, { kind: 'old-sdk', message: 'old' }, { kind: 'offline', message: 'off' }]
    const statuses = ['idle', 'loading', 'ready', 'error'] as const
    for (const phase of phases) {
      for (const review of reviews) {
        for (const blocked of blocks) {
          for (const worldsStatus of statuses) {
            const v = view({ job: job({ phase, review, blocked }), worldsStatus })
            expect(v.headline, `${phase}/${review?.kind ?? 'none'}/${blocked?.kind ?? 'none'}/${worldsStatus}`).not.toBe('')
          }
        }
      }
    }
  })

  // Confirming a move clears the review and leaves `checking` behind. A picker
  // rendered there looked like the dialog rewound to the start.
  it('G16 keeps checking a wait, never the picker', () => {
    const v = view({ job: job({ phase: 'checking', world: 'w.dcl.eth', review: null }) })
    expect(v.family).toBe('wait')
  })
})

describe('the states themselves', () => {
  it('names the refusals instead of leaving a stray sentence', () => {
    expect(VIEWS.B4.headline).toBe("This scene's Decentraland SDK can't publish next to other scenes")
    expect(VIEWS.B5.headline).toBe(VIEWS.B4.headline)
    expect(VIEWS.B2.headline).toBe("You don't own a Decentraland NAME yet")
    expect(VIEWS.B3.headline).toBe("Couldn't load your worlds")
    expect(VIEWS.D6.headline).toBe("Couldn't check what's in w.dcl.eth")
  })

  it('offers a way out of both SDK blocks, and a retry only for the offline one', () => {
    expect(VIEWS.B4.actions.secondary?.label).toBe('Choose another world')
    expect(VIEWS.B4.actions.primary?.label).toBe('Update the Decentraland SDK in this scene')
    expect(VIEWS.B5.actions.primary?.label).toBe('Try again')
  })

  it('asks before discarding a running job, and never as the primary', () => {
    expect(VIEWS.W2.actions.destructive?.label).toBe('Cancel publish')
    expect(VIEWS.W2.actions.destructive?.confirm).toBe('Stop publishing?')
    expect(VIEWS.W2.actions.primary).toBeUndefined()
  })

  // Nothing the creator does moves W1 → W2. A wait that changes headline, note
  // and controls on its own — growing an action row halfway through — is the
  // dialog jumping while they watch.
  it('is one wait from the first step to the last', () => {
    for (const id of ['W1', 'W2', 'W3']) {
      expect(VIEWS[id].headline, `${id} headline`).toBe('Publishing to w.dcl.eth')
      expect(VIEWS[id].actions.destructive?.label, `${id} lever`).toBe('Cancel publish')
      expect(Object.keys(VIEWS[id].actions), `${id} slots`).toEqual(['destructive'])
    }
  })

  it('disables every action of a re-checking decision and spins the one that caused it', () => {
    for (const id of ['D2', 'D3', 'D5', 'D7']) {
      const v = VIEWS[id]
      for (const s of slotsOf(v)) expect(v.actions[s]?.disabled, `${id}.${s}`).toBe(true)
      expect(slotsOf(v).some((s) => v.actions[s]?.busy === true), `${id} shows no progress`).toBe(true)
    }
    expect(VIEWS.D2.actions.destructive?.busy).toBe(true)
    expect(VIEWS.D3.actions.primary?.busy).toBe(true)
  })

  it('keeps the conflict’s three forward paths, one per slot', () => {
    expect(VIEWS.D1.actions.secondary?.label).toBe('Choose another world')
    expect(VIEWS.D1.actions.destructive?.label).toBe('Replace and publish')
    expect(VIEWS.D1.actions.primary?.label).toBe('Move my scene to free parcels')
    expect(VIEWS.D1.actions.destructive?.confirm, 'the dialog IS the confirmation').toBeUndefined()
  })

  // "Try again" that rewinds to the picker costs two presses to do what the word
  // promises once — and the same word one state over retried immediately.
  it('retries the job Try again is offered on', () => {
    const failed = view({ job: job({ phase: 'error', dir: SCENE_DIR, world: JOB_WORLD, error: 'The linker refused the upload' }) })
    failed.actions.primary?.onClick()
    expect(started).toEqual([[SCENE_DIR, JOB_WORLD]])
  })

  // A refresh can fail while the store still holds the worlds the picker just
  // rendered. Refusing to publish then is a dead end for the session.
  it('keeps the picker when a refresh fails over worlds it already has', () => {
    const v = view({ worldsStatus: 'error', worldsError: 'Network unreachable', worlds: [worldEntry(PICKED_WORLD)] })
    expect(v.family).toBe('choose')
    expect(v.actions.primary?.label).toBe('Publish')
  })

  // useAuth().wallet is computed once at module init and never clears on expiry;
  // the flow's own refusal is the only signal that the identity ran out.
  it('offers sign-in when the flow refused for want of one', () => {
    const v = view({ job: job({ phase: 'error', error: 'Sign in to publish' }) })
    expect(v.headline).toBe('Sign in to publish')
    expect(v.actions.primary?.label).toBe('Sign in with Decentraland')
  })

  // The job is a module singleton: it may belong to a different scene folder
  // than the one that opened this dialog, and must not borrow its name.
  it('does not name this scene in another scene’s job', () => {
    const mine = view({ job: job({ phase: 'success', dir: '/scene', world: 'w.dcl.eth', at: '0,0', total: 3 }) })
    const other = view({ job: job({ phase: 'success', dir: '/elsewhere', world: 'w.dcl.eth', at: '0,0', total: 3 }) })
    expect(mine.note).toBe('“My Scene” is live at 0,0. w.dcl.eth now has 3 scenes.')
    expect(other.note).toBe('Your scene is live at 0,0. w.dcl.eth now has 3 scenes.')
  })
})
