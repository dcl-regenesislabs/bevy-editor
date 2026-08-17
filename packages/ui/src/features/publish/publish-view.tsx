import type { ReactNode } from 'react'
import { CardPicker, LinkButton, ParcelMap, parcelTone, Spinner, type StateTone } from '../../ds'
import { plural } from '../../lib/format'
import { openCodeAt } from '../../panels/ai-store'
import { baseName } from '../../script/project-files'
import { GlobeIcon, NAME_MARKETPLACE, openExternal, worldCoverSrc } from '../worlds/common'
import { jumpInUrl } from '../worlds/endpoints'
import type { WorldEntry } from '../worlds/inventory'
import { refreshWorlds, worldScenesOf, type WorldsState } from '../worlds/worlds-store'
import { conflictRegions } from './publish-conflict'
import {
  BUILD_LOG,
  BUILDING_NOTE,
  CHECKING_NOTE,
  checkingHeadline,
  CONFLICT_HEADING,
  conflictConsequence,
  conflictRows,
  KEEPS_PUBLISHING,
  moveLine,
  NO_NAME_HEADING,
  NO_NAME_NOTE,
  pickTimeLine,
  publishingHeadline,
  recoveryLine,
  sceneHeadline,
  scopeLine,
  SDK_DOCS_URL,
  SDK_TOO_OLD_HEADING,
  SIGN_IN_NOTE,
  SIGN_IN_TO_PUBLISH,
  STOP_PUBLISHING,
  successFallbackLine,
  successLine,
  UNREADABLE_CONSEQUENCE,
  unreadableWorldHeading,
  UPLOADING_NOTE,
  WORLDS_FAILED_HEADING,
  worldRowLine
} from './publish-copy'
import { publishFailure, type PublishFailure } from './publish-error'
import {
  cancelMove,
  cancelPublish,
  confirmMove,
  confirmPublish,
  previewMove,
  resetPublish,
  startPublish,
  type ConflictReview,
  type PublishState
} from './publish-flow'

export type PublishFamily = 'choose' | 'decide' | 'wait' | 'outcome' | 'blocked'

export const ACTION_SLOTS = ['secondary', 'destructive', 'primary'] as const
export type ActionSlot = (typeof ACTION_SLOTS)[number]

export interface PublishAction {
  label: string
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  confirm?: string
}

export type PublishActions = Partial<Record<ActionSlot, PublishAction>>

/** whether this state puts anything in the footer at all — a state with no
 *  actions renders no bordered footer strip, so the Modal is handed `undefined`
 *  rather than an empty PublishFooter */
export function anyAction(actions: PublishActions): boolean {
  return ACTION_SLOTS.some((slot) => actions[slot] !== undefined)
}

export interface PublishDisclosure {
  title: string
  count: number
  children: ReactNode
}

export type PublishMark = 'none' | 'world' | 'problem' | 'done'

export interface PublishView {
  family: PublishFamily
  tone: StateTone
  icon?: ReactNode
  headline: string
  note?: ReactNode
  align?: 'center' | 'start'
  evidence?: ReactNode
  disclosure: PublishDisclosure | null
  actions: PublishActions
  scrimClose: boolean
  closeTip: string
}

export interface PublishViewInput {
  job: PublishState
  wallet: string | null
  signIn: () => void
  worlds: WorldEntry[]
  worldsStatus: WorldsState['status']
  worldsError: string | null
  dir: string
  sceneTitle: string
  picked: string | null
  localBase: string | null
  /** ref for the build log — a callback, not a RefObject: the log lives inside a
   *  Shelf and mounts only when it is opened, so scrolling it to the newest line
   *  has to happen on attach. Keyed on the log itself it never fired for a
   *  FINISHED job, which is the one case where the last line is the answer. */
  attachLog: (el: HTMLPreElement | null) => void
  onPick: (name: string) => void
  onManageWorld?: (name: string) => void
  close: () => void
}

const HIDE_TIP = 'Hide — publishing continues'
const CLOSE_TIP = 'Close'

// The mark — the tinted disc and what sits in it — is picked from this table and
// never per state. It is the axis the rewrite left free: the success state's own
// 34px icon rule (a third icon treatment) and the red alarm on a decision the
// flow still allows both got in because a state could choose its own. Four
// marks, and the tone travels with the glyph, so no state can pair a
// celebration with an error tint.
export const MARKS: Record<PublishMark, { tone: StateTone; icon?: ReactNode }> = {
  none: { tone: 'neutral' },
  world: { tone: 'neutral', icon: <GlobeIcon size={22} /> },
  problem: { tone: 'error', icon: '!' },
  done: { tone: 'success', icon: '🎉' }
}

// All a state may say about itself. The tone that travels with the mark, the
// empty action set, the absent disclosure and the plain "Close" tip are filled
// in by `state()` — `scrimClose` is the one every state still has to answer,
// because what is pending behind a screen is not derivable from its family.
interface StateSpec {
  family: PublishFamily
  mark: PublishMark
  headline: string
  note?: ReactNode
  align?: 'start'
  evidence?: ReactNode
  disclosure?: PublishDisclosure | null
  actions?: PublishActions
  scrimClose: boolean
  closeTip?: string
}

function state(spec: StateSpec): PublishView {
  return {
    family: spec.family,
    ...MARKS[spec.mark],
    headline: spec.headline,
    note: spec.note,
    align: spec.align,
    evidence: spec.evidence,
    disclosure: spec.disclosure ?? null,
    actions: spec.actions ?? {},
    scrimClose: spec.scrimClose,
    closeTip: spec.closeTip ?? CLOSE_TIP
  }
}

function chooseAnotherWorld(disabled?: boolean): PublishAction {
  return { label: 'Choose another world', onClick: resetPublish, disabled }
}

function logShelf(job: PublishState, attachLog: (el: HTMLPreElement | null) => void): PublishDisclosure | null {
  if (job.logs.length === 0) return null
  return {
    title: BUILD_LOG,
    count: job.logs.length,
    children: (
      <pre className="eui-publish-logpre" ref={attachLog}>
        {job.logs.slice(-200).join('\n')}
      </pre>
    )
  }
}

function problemList(failure: PublishFailure): ReactNode {
  const canOpen = typeof window !== 'undefined' && window.editorShell !== undefined
  return failure.problems.map((p) => (
    <p key={`${p.path}:${p.line}:${p.message}`} className="eui-publish-problem">
      {p.message}{' '}
      {canOpen ? (
        <LinkButton tone="inline" onClick={() => openCodeAt(p.path, p.line)}>
          {baseName(p.path)}:{p.line}
        </LinkButton>
      ) : (
        <span className="where">
          {baseName(p.path)}:{p.line}
        </span>
      )}
    </p>
  ))
}

// One job, three steps, in the order they happen: a step is done once the job
// is past it, so nothing but the phase decides what the list shows.
const WAIT_STEPS = ['checking', 'building', 'uploading'] as const
type WaitStep = (typeof WAIT_STEPS)[number]
type StepState = 'done' | 'active' | 'todo'

const WAIT_NOTE: Record<WaitStep, string> = {
  checking: CHECKING_NOTE,
  building: BUILDING_NOTE,
  uploading: UPLOADING_NOTE
}

const STEP_MARK: Record<StepState, ReactNode> = { done: '✓', active: <Spinner size="sm" />, todo: '·' }

function stepState(step: WaitStep, at: WaitStep): StepState {
  if (step === at) return 'active'
  return WAIT_STEPS.indexOf(step) < WAIT_STEPS.indexOf(at) ? 'done' : 'todo'
}

function waitEvidence(at: WaitStep, world: string, caption: boolean): ReactNode {
  const label: Record<WaitStep, string> = {
    checking: checkingHeadline(world),
    building: 'Building your scene',
    uploading: `Uploading to ${world}`
  }
  return (
    <>
      <div className="eui-publish-steps">
        {WAIT_STEPS.map((step) => {
          const progress = stepState(step, at)
          return (
            <div key={step} className={`eui-publish-step ${progress}`}>
              <span className="ic">{STEP_MARK[progress]}</span>
              {label[step]}
            </div>
          )
        })}
      </div>
      {caption && <p className="eui-publish-caption">{KEEPS_PUBLISHING}</p>}
    </>
  )
}

function conflictEvidence(conflict: ConflictReview, world: string, wallet: string | null): ReactNode {
  const regions = conflictRegions(conflict.mine, conflict.scenes, worldScenesOf(world))
  const staying = regions.filter((r) => r.tone === 'staying').length
  return (
    <>
      <div className="eui-publish-conflict-scenes">
        {conflictRows(conflict.scenes, wallet).map((r) => (
          <div key={r.key} className="eui-publish-conflict-scene">
            <span className="nm">{r.line}</span>
            {r.by !== null && <span className="by">{r.by}</span>}
          </div>
        ))}
      </div>
      <ParcelMap regions={regions} fit={{ width: 460, height: 260 }} />
      <div className="eui-publish-legend">
        <span>
          <i style={parcelTone('mine')} />
          Your scene
        </span>
        <span>
          <i style={parcelTone('replaced')} />
          Replaced
        </span>
        {staying > 0 && (
          <span>
            <i style={parcelTone('staying')} />
            {plural(staying, 'scene')} staying
          </span>
        )}
      </div>
      <p className="eui-publish-conflict-note">{scopeLine(world)}</p>
      <p className="eui-publish-conflict-note">{recoveryLine(conflict.scenes)}</p>
      {conflict.moveNote !== null && <p className="eui-publish-note">{conflict.moveNote}</p>}
    </>
  )
}

function pickerEvidence(input: PublishViewInput): ReactNode {
  const { worlds, picked } = input
  if (worlds.length === 0 && input.worldsStatus !== 'ready') return <Spinner size="md" />
  const count = worlds.find((w) => w.name === picked)?.sceneCount
  const total = count?.known === true ? count.total : 0
  return (
    <>
      <CardPicker
        mode="one"
        ariaLabel="World"
        selected={picked === null ? [] : [picked]}
        onSelect={input.onPick}
        items={worlds.map((w) => ({
          key: w.name,
          label: w.name,
          note: worldRowLine(w),
          image: worldCoverSrc(w)
        }))}
      />
      {picked !== null && total > 0 && <p className="eui-publish-note">{pickTimeLine(picked, total, input.localBase)}</p>}
    </>
  )
}

export function publishView(input: PublishViewInput): PublishView {
  const { job, worlds, worldsStatus, picked } = input
  const checking = job.phase === 'checking'
  const review = job.phase === 'review' || checking ? job.review : null
  const conflict = review !== null && review.kind === 'conflict' ? review : null
  const world = job.world ?? picked ?? ''
  const mine = job.dir === input.dir
  const title = mine ? input.sceneTitle : null

  // The flow's own sign-in refusal is the same screen as having no wallet at
  // all: `useAuth().wallet` is computed once at module init and never clears on
  // expiry, so an identity that ran out lands here rather than on a picker whose
  // Publish can only fail.
  const signedOut = input.wallet === null || (job.phase === 'error' && job.error === SIGN_IN_TO_PUBLISH)
  if (signedOut) {
    return state({
      family: 'blocked',
      mark: 'world',
      headline: SIGN_IN_TO_PUBLISH,
      note: SIGN_IN_NOTE,
      actions: { primary: { label: 'Sign in with Decentraland', onClick: input.signIn } },
      scrimClose: true
    })
  }

  if (job.phase === 'success') {
    const manage = input.onManageWorld
    const live = job.world
    const note =
      job.total !== null && job.total > 1 && job.at !== null
        ? successLine(title, job.at, live ?? '', job.total)
        : successFallbackLine(title)
    const manageWorld: PublishAction | undefined =
      manage !== undefined && live !== null
        ? {
            label: 'Manage world',
            onClick: () => {
              input.close()
              manage(live)
            }
          }
        : undefined
    return state({
      family: 'outcome',
      mark: 'done',
      headline: `${live ?? ''} is live!`,
      note,
      actions: {
        ...(manageWorld === undefined ? {} : { secondary: manageWorld }),
        primary: { label: 'Jump in', onClick: () => openExternal(job.jumpIn ?? jumpInUrl(live ?? '')) }
      },
      scrimClose: true
    })
  }

  if (job.phase === 'error') {
    const [headline, ...rest] = (job.error ?? '').split('\n')
    const failure = publishFailure(headline, [...rest, ...job.logs])
    // Try again means try again: rewinding to the picker made the creator press
    // Publish a second time to do what the word promised once. It can only run
    // the job over when the job is this scene's and we know where it was going.
    const retry = mine && world !== '' ? () => startPublish(input.dir, world) : resetPublish
    const detailLog =
      failure.detail.length > 0 ? <pre className="eui-publish-errlog">{failure.detail.join('\n')}</pre> : undefined
    return state({
      family: 'outcome',
      mark: 'problem',
      headline: "That didn't work",
      note: <span className="eui-publish-errmsg">{failure.headline}</span>,
      evidence: failure.retryable ? detailLog : problemList(failure),
      disclosure: logShelf(job, input.attachLog),
      actions: failure.retryable ? { primary: { label: 'Try again', onClick: retry } } : {},
      scrimClose: true
    })
  }

  if (job.phase === 'blocked' && job.blocked !== null) {
    const offline = job.blocked.kind === 'offline'
    return state({
      family: 'blocked',
      mark: 'problem',
      headline: SDK_TOO_OLD_HEADING,
      note: job.blocked.message,
      actions: {
        secondary: chooseAnotherWorld(),
        primary: offline
          ? { label: 'Try again', onClick: () => startPublish(input.dir, world) }
          : { label: 'Update the Decentraland SDK in this scene', onClick: () => openExternal(SDK_DOCS_URL) }
      },
      scrimClose: false
    })
  }

  if (conflict !== null && conflict.move !== null) {
    const working = conflict.working || checking
    return state({
      family: 'decide',
      mark: 'none',
      headline: 'Move my scene to free parcels',
      note: moveLine(conflict.move),
      actions: {
        secondary: { label: 'Back', onClick: cancelMove, disabled: working },
        primary: { label: 'Move and publish', onClick: confirmMove, disabled: working, busy: working }
      },
      scrimClose: false
    })
  }

  if (conflict !== null) {
    const busy = conflict.working || checking
    return state({
      family: 'decide',
      mark: 'none',
      align: 'start',
      headline: CONFLICT_HEADING,
      note: conflictConsequence(title, world, conflict.scenes.length),
      evidence: conflictEvidence(conflict, world, input.wallet),
      actions: {
        secondary: chooseAnotherWorld(busy),
        destructive: { label: 'Replace and publish', onClick: confirmPublish, disabled: busy, busy: checking },
        primary: {
          label: 'Move my scene to free parcels',
          onClick: previewMove,
          disabled: busy,
          busy: conflict.working
        }
      },
      scrimClose: false
    })
  }

  if (review !== null) {
    return state({
      family: 'decide',
      mark: 'none',
      headline: unreadableWorldHeading(world),
      note: UNREADABLE_CONSEQUENCE,
      actions: {
        secondary: chooseAnotherWorld(checking),
        primary: { label: 'Publish anyway', onClick: confirmPublish, disabled: checking, busy: checking }
      },
      scrimClose: false
    })
  }

  // One wait, three steps. The headline names the job rather than the step it is
  // on, so nothing but the step list and its note moves while it runs — and the
  // lever to stop it is there from the first step, not from the second.
  if (job.phase === 'checking' || job.phase === 'building' || job.phase === 'uploading') {
    const spawned = !checking
    return state({
      family: 'wait',
      mark: 'none',
      headline: publishingHeadline(world),
      note: WAIT_NOTE[job.phase],
      evidence: waitEvidence(job.phase, world, spawned),
      disclosure: logShelf(job, input.attachLog),
      actions: {
        destructive: { label: 'Cancel publish', onClick: cancelPublish, confirm: STOP_PUBLISHING }
      },
      scrimClose: false,
      // Closing during the pre-flight abandons it (resetPublish is live for
      // `checking`); closing a spawned job only hides it. The tip says which.
      closeTip: spawned ? HIDE_TIP : CLOSE_TIP
    })
  }

  // A refresh that failed does not empty the store: a world list we already hold
  // is still the answer to "publish where?", and refusing to show it left the
  // picker dead for the session while the Worlds tab listed the same worlds.
  if (worldsStatus === 'error' && worlds.length === 0) {
    return state({
      family: 'blocked',
      mark: 'problem',
      headline: WORLDS_FAILED_HEADING,
      note: input.worldsError ?? undefined,
      actions: { primary: { label: 'Try again', onClick: refreshWorlds } },
      scrimClose: true
    })
  }

  if (worldsStatus === 'ready' && worlds.length === 0) {
    return state({
      family: 'blocked',
      mark: 'world',
      headline: NO_NAME_HEADING,
      note: NO_NAME_NOTE,
      actions: { primary: { label: 'Get a NAME', onClick: () => openExternal(NAME_MARKETPLACE) } },
      scrimClose: true
    })
  }

  return state({
    family: 'choose',
    mark: 'none',
    headline: sceneHeadline(input.sceneTitle),
    evidence: pickerEvidence(input),
    actions: {
      primary: {
        label: 'Publish',
        disabled: picked === null,
        onClick: () => {
          if (picked !== null) startPublish(input.dir, picked)
        }
      }
    },
    scrimClose: true
  })
}
