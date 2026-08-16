import type { ReactNode } from 'react'
import { CardPicker, LinkButton, ParcelMap, parcelTone, Spinner, type StateTone } from '../../ds'
import { plural } from '../../lib/format'
import { openCodeAt } from '../../panels/ai-store'
import { baseName } from '../../script/project-files'
import { GlobeIcon, NAME_MARKETPLACE, openExternal, worldCoverSrc } from '../worlds/common'
import type { WorldEntry } from '../worlds/inventory'
import { refreshWorlds, worldScenesOf } from '../worlds/worlds-store'
import { conflictRegions } from './publish-conflict'
import {
  BUILD_LOG,
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
  type PublishState
} from './publish-flow'
import { jumpInUrl } from '../worlds/endpoints'

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
  worldsStatus: 'idle' | 'loading' | 'ready' | 'error'
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

function waitEvidence(job: PublishState, world: string, caption: boolean): ReactNode {
  const mark = (state: 'done' | 'active' | 'todo'): ReactNode =>
    state === 'done' ? '✓' : state === 'active' ? <Spinner size={14} /> : '·'
  const at = job.phase
  const steps: Array<[string, 'done' | 'active' | 'todo']> = [
    [checkingHeadline(world), at === 'checking' ? 'active' : 'done'],
    ['Building your scene', at === 'building' ? 'active' : at === 'checking' ? 'todo' : 'done'],
    [`Uploading to ${world}`, at === 'uploading' ? 'active' : 'todo']
  ]
  return (
    <>
      <div className="eui-publish-steps">
        {steps.map(([label, state]) => (
          <div key={label} className={`eui-publish-step ${state}`}>
            <span className="ic">{mark(state)}</span>
            {label}
          </div>
        ))}
      </div>
      {caption && <p className="eui-publish-caption">{KEEPS_PUBLISHING}</p>}
    </>
  )
}

function conflictEvidence(
  scenes: ReturnType<typeof conflictRows>,
  regions: ReturnType<typeof conflictRegions>,
  world: string,
  occupying: Parameters<typeof recoveryLine>[0],
  moveNote: string | null
): ReactNode {
  const staying = regions.filter((r) => r.tone === 'staying').length
  return (
    <>
      <div className="eui-publish-conflict-scenes">
        {scenes.map((r) => (
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
      <p className="eui-publish-conflict-note">{recoveryLine(occupying)}</p>
      {moveNote !== null && <p className="eui-publish-note">{moveNote}</p>}
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
    return {
      family: 'blocked',
      ...MARKS.world,
      headline: SIGN_IN_TO_PUBLISH,
      note: SIGN_IN_NOTE,
      disclosure: null,
      actions: { primary: { label: 'Sign in with Decentraland', onClick: input.signIn } },
      scrimClose: true,
      closeTip: CLOSE_TIP
    }
  }

  if (job.phase === 'success') {
    const manage = input.onManageWorld
    const live = job.world
    const note =
      job.total !== null && job.total > 1 && job.at !== null
        ? successLine(title, job.at, live ?? '', job.total)
        : successFallbackLine(title)
    return {
      family: 'outcome',
      ...MARKS.done,
      headline: `${live ?? ''} is live!`,
      note,
      disclosure: null,
      actions: {
        ...(manage !== undefined && live !== null
          ? {
              secondary: {
                label: 'Manage world',
                onClick: () => {
                  input.close()
                  manage(live)
                }
              }
            }
          : {}),
        primary: { label: 'Jump in', onClick: () => openExternal(job.jumpIn ?? jumpInUrl(live ?? '')) }
      },
      scrimClose: true,
      closeTip: CLOSE_TIP
    }
  }

  if (job.phase === 'error') {
    const [headline, ...rest] = (job.error ?? '').split('\n')
    const failure = publishFailure(headline, [...rest, ...job.logs])
    // Try again means try again: rewinding to the picker made the creator press
    // Publish a second time to do what the word promised once. It can only run
    // the job over when the job is this scene's and we know where it was going.
    const retry = mine && world !== '' ? () => startPublish(input.dir, world) : resetPublish
    return {
      family: 'outcome',
      ...MARKS.problem,
      headline: "That didn't work",
      note: <span className="eui-publish-errmsg">{failure.headline}</span>,
      evidence: failure.retryable ? (
        failure.detail.length > 0 && <pre className="eui-publish-errlog">{failure.detail.join('\n')}</pre>
      ) : (
        <>{problemList(failure)}</>
      ),
      disclosure: logShelf(job, input.attachLog),
      actions: failure.retryable ? { primary: { label: 'Try again', onClick: retry } } : {},
      scrimClose: true,
      closeTip: CLOSE_TIP
    }
  }

  if (job.phase === 'blocked' && job.blocked !== null) {
    const offline = job.blocked.kind === 'offline'
    return {
      family: 'blocked',
      ...MARKS.problem,
      headline: SDK_TOO_OLD_HEADING,
      note: job.blocked.message,
      disclosure: null,
      actions: {
        secondary: { label: 'Choose another world', onClick: resetPublish },
        primary: offline
          ? { label: 'Try again', onClick: () => startPublish(input.dir, world) }
          : { label: 'Update the Decentraland SDK in this scene', onClick: () => openExternal(SDK_DOCS_URL) }
      },
      scrimClose: false,
      closeTip: CLOSE_TIP
    }
  }

  if (conflict !== null && conflict.move !== null) {
    const working = conflict.working || checking
    return {
      family: 'decide',
      ...MARKS.none,
      headline: 'Move my scene to free parcels',
      note: moveLine(conflict.move),
      disclosure: null,
      actions: {
        secondary: { label: 'Back', onClick: cancelMove, disabled: working },
        primary: { label: 'Move and publish', onClick: confirmMove, disabled: working, busy: working }
      },
      scrimClose: false,
      closeTip: CLOSE_TIP
    }
  }

  if (conflict !== null) {
    const regions = conflictRegions(conflict.mine, conflict.scenes, worldScenesOf(world))
    const busy = conflict.working || checking
    return {
      family: 'decide',
      ...MARKS.none,
      align: 'start',
      headline: CONFLICT_HEADING,
      note: conflictConsequence(title, world, conflict.scenes.length),
      evidence: conflictEvidence(
        conflictRows(conflict.scenes, input.wallet),
        regions,
        world,
        conflict.scenes,
        conflict.moveNote
      ),
      disclosure: null,
      actions: {
        secondary: { label: 'Choose another world', onClick: resetPublish, disabled: busy },
        destructive: { label: 'Replace and publish', onClick: confirmPublish, disabled: busy, busy: checking },
        primary: {
          label: 'Move my scene to free parcels',
          onClick: previewMove,
          disabled: busy,
          busy: conflict.working
        }
      },
      scrimClose: false,
      closeTip: CLOSE_TIP
    }
  }

  if (review !== null) {
    return {
      family: 'decide',
      ...MARKS.none,
      headline: unreadableWorldHeading(world),
      note: UNREADABLE_CONSEQUENCE,
      disclosure: null,
      actions: {
        secondary: { label: 'Choose another world', onClick: resetPublish, disabled: checking },
        primary: { label: 'Publish anyway', onClick: confirmPublish, disabled: checking, busy: checking }
      },
      scrimClose: false,
      closeTip: CLOSE_TIP
    }
  }

  // One wait, three steps. The headline names the job rather than the step it is
  // on, so nothing but the step list and its note moves while it runs — and the
  // lever to stop it is there from the first step, not from the second.
  if (checking || job.phase === 'building' || job.phase === 'uploading') {
    const spawned = !checking
    return {
      family: 'wait',
      ...MARKS.none,
      headline: publishingHeadline(world),
      note: checking
        ? CHECKING_NOTE
        : job.phase === 'building'
          ? 'Bundling code and assets — this can take a minute the first time.'
          : 'Sending your scene to Decentraland. Almost there…',
      evidence: waitEvidence(job, world, spawned),
      disclosure: logShelf(job, input.attachLog),
      actions: {
        destructive: { label: 'Cancel publish', onClick: cancelPublish, confirm: STOP_PUBLISHING }
      },
      scrimClose: false,
      // Closing during the pre-flight abandons it (resetPublish is live for
      // `checking`); closing a spawned job only hides it. The tip says which.
      closeTip: spawned ? HIDE_TIP : CLOSE_TIP
    }
  }

  // A refresh that failed does not empty the store: a world list we already hold
  // is still the answer to "publish where?", and refusing to show it left the
  // picker dead for the session while the Worlds tab listed the same worlds.
  if (worldsStatus === 'error' && worlds.length === 0) {
    return {
      family: 'blocked',
      ...MARKS.problem,
      headline: WORLDS_FAILED_HEADING,
      note: input.worldsError ?? undefined,
      disclosure: null,
      actions: { primary: { label: 'Try again', onClick: refreshWorlds } },
      scrimClose: true,
      closeTip: CLOSE_TIP
    }
  }

  if (worldsStatus === 'ready' && worlds.length === 0) {
    return {
      family: 'blocked',
      ...MARKS.world,
      headline: NO_NAME_HEADING,
      note: NO_NAME_NOTE,
      disclosure: null,
      actions: { primary: { label: 'Get a NAME', onClick: () => openExternal(NAME_MARKETPLACE) } },
      scrimClose: true,
      closeTip: CLOSE_TIP
    }
  }

  const count = worlds.find((w) => w.name === picked)?.sceneCount
  const total = count?.known === true ? count.total : 0
  const loading = worlds.length === 0 && worldsStatus !== 'ready'
  return {
    family: 'choose',
    ...MARKS.none,
    headline: sceneHeadline(input.sceneTitle),
    disclosure: null,
    evidence: loading ? (
      <Spinner size={20} />
    ) : (
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
    ),
    actions: {
      primary: {
        label: 'Publish',
        disabled: picked === null,
        onClick: () => {
          if (picked !== null) startPublish(input.dir, picked)
        }
      }
    },
    scrimClose: true,
    closeTip: CLOSE_TIP
  }
}
