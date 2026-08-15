// Publish-to-world modal: choose a world -> pre-flight -> building (log drawer)
// -> uploading -> live! Closing while busy keeps the job running (module
// singleton store); reopening shows its current state.
import { useEffect, useRef, useState } from 'react'
import { Button, Modal, ParcelMap, parcelTone, Spinner, useLoad } from '../../ds'
import { useAuth } from '../account/auth'
import { jumpInUrl } from '../worlds/endpoints'
import { ensureWorlds, refreshWorlds, useWorlds, worldScenesOf } from '../worlds/worlds-store'
import {
  cancelMove,
  cancelPublish,
  confirmMove,
  confirmPublish,
  previewMove,
  resetPublish,
  startPublish,
  usePublish
} from './publish-flow'
import {
  CONFLICT_HEADING,
  conflictConsequence,
  conflictRows,
  moveLine,
  pickTimeLine,
  recoveryLine,
  scopeLine,
  SDK_DOCS_URL,
  successLine,
  unreadableWorldLine,
  worldRowLine
} from './publish-copy'
import { conflictRegions } from './publish-conflict'
import { plural } from '../../lib/format'
import { openCodeAt } from '../../panels/ai-store'
import { baseName } from '../../script/project-files'
import { publishFailure } from './publish-error'
import { readLocalFootprint } from './publish-preflight'
import { GlobeIcon, NAME_MARKETPLACE, openExternal, WorldCover } from '../worlds/common'

export function PublishModal(props: {
  dir: string
  sceneTitle: string
  currentWorld: string | null
  onClose: () => void
  onManageWorld?: (name: string) => void
}): JSX.Element {
  const auth = useAuth()
  const { worlds, status, error: worldsError } = useWorlds()
  const job = usePublish()
  const [picked, setPicked] = useState<string | null>(props.currentWorld?.toLowerCase() ?? null)
  const [showLogs, setShowLogs] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const { data: local } = useLoad(() => readLocalFootprint(props.dir), [props.dir])
  useEffect(ensureWorlds, [auth.wallet])
  useEffect(() => {
    if (logRef.current !== null) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job.logs, showLogs])
  // a pre-seeded world (scene.json) the wallet can't deploy to isn't offerable
  useEffect(() => {
    if (status === 'ready' && picked !== null && !worlds.some((w) => w.name === picked)) setPicked(null)
  }, [status, worlds, picked])

  // this modal reflects a job for ANOTHER scene? show that state anyway — one
  // publish at a time is a hard invariant, better to surface than to hide it
  const busy = job.phase === 'building' || job.phase === 'uploading'
  const checking = job.phase === 'checking'
  const review = job.phase === 'review' || checking ? job.review : null
  const conflict = review !== null && review.kind === 'conflict' ? review : null
  const world = job.world ?? picked ?? ''
  const regions =
    conflict === null ? [] : conflictRegions(conflict.move?.parcels ?? conflict.mine, conflict.scenes, worldScenesOf(world))
  const staying = regions.filter((r) => r.tone === 'staying').length

  const close = (): void => {
    resetPublish()
    props.onClose()
  }

  const pickedCount = worlds.find((w) => w.name === picked)?.sceneCount
  const pickedTotal = pickedCount?.known === true ? pickedCount.total : 0

  const body = (): JSX.Element => {
    if (auth.wallet === null) {
      return (
        <div className="eui-publish-center">
          <div className="eui-account-empty-icon"><GlobeIcon size={22} /></div>
          <p className="t">Sign in to publish</p>
          <p className="s">Publishing proves the world is yours — sign in with Decentraland first.</p>
          <Button variant="primary" size="md" onClick={auth.signIn}>Sign in with Decentraland</Button>
        </div>
      )
    }
    if (job.phase === 'success') {
      return (
        <div className="eui-publish-center">
          <div className="eui-publish-party">🎉</div>
          <p className="t">{job.world} is live!</p>
          <p className="s">
            {job.total !== null && job.total > 1 && job.at !== null
              ? successLine(props.sceneTitle, job.at, job.world ?? '', job.total)
              : `“${props.sceneTitle}” is now what visitors see at your world.`}
          </p>
          <div className="eui-signin-row">
            <Button variant="primary" size="md" onClick={() => openExternal(job.jumpIn ?? jumpInUrl(job.world ?? ''))}>
              Jump in
            </Button>
            {props.onManageWorld !== undefined && job.world !== null && (
              <Button variant="ghost" size="md" onClick={() => {
                const w = job.world!
                close()
                props.onManageWorld!(w)
              }}>
                Manage world
              </Button>
            )}
          </div>
        </div>
      )
    }
    if (job.phase === 'error') {
      return (
        <div className="eui-publish-center">
          <div className="eui-account-empty-icon err">!</div>
          <p className="t">That didn't work</p>
          <PublishError raw={job.error ?? ''} log={job.logs} />
          <div className="eui-signin-row">
            <Button variant="primary" size="md" onClick={resetPublish}>Try again</Button>
            <button className="eui-link" onClick={close}>Close</button>
          </div>
          {job.logs.length > 0 && <LogDrawer />}
        </div>
      )
    }
    if (job.phase === 'blocked' && job.blocked !== null) {
      return (
        <div className="eui-publish-center">
          <div className="eui-account-empty-icon err">!</div>
          <p className="s">{job.blocked.message}</p>
        </div>
      )
    }
    if (conflict !== null && conflict.move !== null) {
      return (
        <div className="eui-publish-move">
          <p className="h">Move my scene to free parcels</p>
          <p className="s">{moveLine(conflict.move)}</p>
        </div>
      )
    }
    if (conflict !== null) {
      return (
        <div className="eui-publish-conflict">
          <p className="h">{CONFLICT_HEADING}</p>
          <p className="c">{conflictConsequence(props.sceneTitle, world, conflict.scenes.length)}</p>
          <div className="eui-publish-conflict-scenes">
            {conflictRows(conflict.scenes, auth.wallet).map((r) => (
              <div key={r.key} className="eui-publish-conflict-scene">
                <span className="nm">{r.line}</span>
                {r.by !== null && <span className="by">{r.by}</span>}
              </div>
            ))}
          </div>
          <ParcelMap regions={regions} fit={{ width: 460, height: 260 }} />
          <div className="eui-publish-legend">
            <span><i style={parcelTone('mine')} />Your scene</span>
            <span><i style={parcelTone('replaced')} />Replaced</span>
            {staying > 0 && (
              <span>
                <i style={parcelTone('staying')} />
                {plural(staying, 'scene')} staying
              </span>
            )}
          </div>
          <p className="s">{scopeLine(world)}</p>
          <p className="s">{recoveryLine(conflict.scenes)}</p>
          {conflict.moveNote !== null && <p className="eui-publish-note">{conflict.moveNote}</p>}
        </div>
      )
    }
    if (review !== null) {
      return (
        <div className="eui-publish-center">
          <p className="s">{unreadableWorldLine(world)}</p>
        </div>
      )
    }
    if (busy) {
      const steps: Array<[string, 'done' | 'active' | 'todo']> = [
        ['Building your scene', job.phase === 'building' ? 'active' : 'done'],
        [`Uploading to ${job.world ?? ''}`, job.phase === 'uploading' ? 'active' : 'todo']
      ]
      return (
        <div className="eui-publish-center">
          <div className="eui-publish-steps">
            {steps.map(([label, st]) => (
              <div key={label} className={`eui-publish-step ${st}`}>
                <span className="ic">{st === 'done' ? '✓' : st === 'active' ? <Spinner size={14} /> : '·'}</span>
                {label}
              </div>
            ))}
          </div>
          <p className="s">
            {job.phase === 'building'
              ? 'Bundling code and assets — this can take a minute the first time.'
              : 'Sending your scene to Decentraland. Almost there…'}
          </p>
          <LogDrawer />
          <div className="eui-signin-row">
            <Button variant="ghost" size="sm" onClick={close}>Hide — keep publishing</Button>
            <Button variant="danger" size="sm" onClick={() => { cancelPublish() }}>Cancel publish</Button>
          </div>
        </div>
      )
    }
    // idle — choose the target world
    return (
      <>
        <div className="eui-publish-scene">
          Publishing <b>{props.sceneTitle}</b>
        </div>
        {status === 'loading' && worlds.length === 0 && (
          <div className="eui-publish-center"><Spinner size={20} /></div>
        )}
        {status === 'error' && (
          <div className="eui-publish-center">
            <p className="s">Couldn't load your worlds{worldsError !== null ? ` — ${worldsError}` : ''}.</p>
            <Button variant="primary" size="md" onClick={refreshWorlds}>Try again</Button>
          </div>
        )}
        {status === 'ready' && worlds.length === 0 && (
          <div className="eui-publish-center">
            <p className="s">You don't own a Decentraland NAME yet — a NAME is the world you publish to.</p>
            <Button variant="primary" size="md" onClick={() => openExternal(NAME_MARKETPLACE)}>Get a NAME</Button>
          </div>
        )}
        <div className="eui-publish-worlds">
          {worlds.map((w) => (
            <button key={w.name} className={`eui-publish-world ${picked === w.name ? 'on' : ''}`} onClick={() => setPicked(w.name)}>
              <WorldCover w={w} />
              <span className="meta">
                <span className="nm">{w.name}</span>
                <span className="st">{worldRowLine(w)}</span>
              </span>
              <span className="pick">{picked === w.name ? '●' : '○'}</span>
            </button>
          ))}
        </div>
        {picked !== null && pickedTotal > 0 && (
          <p className="eui-publish-note">{pickTimeLine(picked, pickedTotal, local?.base ?? null)}</p>
        )}
      </>
    )
  }

  const foot = (): JSX.Element | undefined => {
    if (auth.wallet === null) return undefined
    if (job.phase === 'blocked' && job.blocked !== null) {
      return (
        <>
          {job.blocked.kind === 'old-sdk' && (
            <Button variant="primary" size="sm" onClick={() => openExternal(SDK_DOCS_URL)}>
              Update the Decentraland SDK in this scene
            </Button>
          )}
          <Button onClick={resetPublish}>Choose another world</Button>
        </>
      )
    }
    if (conflict !== null && conflict.move !== null) {
      return (
        <>
          <Button onClick={cancelMove}>Back</Button>
          <Button variant="primary" size="sm" disabled={conflict.working || checking} onClick={confirmMove}>
            Move and publish
          </Button>
        </>
      )
    }
    if (conflict !== null) {
      return (
        <>
          <Button variant="danger" size="sm" disabled={conflict.working || checking} onClick={confirmPublish}>
            Replace and publish
          </Button>
          <span style={{ flex: 1 }} />
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={conflict.working || checking} onClick={previewMove}>
            <span className="eui-publish-btn">
              {conflict.working && <Spinner size={12} />}
              Move my scene to free parcels
            </span>
          </Button>
        </>
      )
    }
    if (review !== null) {
      return (
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" size="sm" disabled={checking} onClick={confirmPublish}>Publish anyway</Button>
        </>
      )
    }
    if (job.phase === 'idle' || checking) {
      return (
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={picked === null || checking}
            onClick={() => {
              if (picked !== null) startPublish(props.dir, picked)
            }}
          >
            <span className="eui-publish-btn">
              {checking && <Spinner size={12} />}
              Publish
            </span>
          </Button>
        </>
      )
    }
    return undefined
  }

  const LogDrawer = (): JSX.Element => (
    <div className="eui-publish-logs">
      <button className="eui-link" onClick={() => setShowLogs((v) => !v)}>
        {showLogs ? 'Hide details' : 'Show details'}
      </button>
      {showLogs && <pre ref={logRef}>{job.logs.slice(-200).join('\n') || '…'}</pre>}
    </div>
  )

  // hide ≠ cancel: the job is a module singleton, it keeps running and
  // reopening the modal shows its current state
  return (
    <Modal
      title={<><GlobeIcon /> Publish to a world</>}
      className="eui-home-modal eui-publish-modal"
      onClose={close}
      scrimClose={!busy}
      closeX
      closeTip={busy ? 'Hide — publishing continues' : 'Close'}
      footer={foot()}
    >
      {body()}
    </Modal>
  )
}

function PublishError(props: { raw: string; log: string[] }): JSX.Element {
  const [headline, ...rest] = props.raw.split('\n')
  const failure = publishFailure(headline, [...rest, ...props.log])
  const canOpen = window.editorShell !== undefined
  return (
    <>
      <p className="s eui-publish-errmsg">{failure.headline}</p>
      {failure.problems.map((p) => (
        <div key={`${p.path}:${p.line}:${p.message}`} className="eui-publish-problem">
          <p className="msg">{p.message}</p>
          {canOpen ? (
            <Button size="sm" onClick={() => openCodeAt(p.path, p.line)}>
              Open {baseName(p.path)}:{p.line}
            </Button>
          ) : (
            <span className="where">{baseName(p.path)}:{p.line}</span>
          )}
        </div>
      ))}
      {failure.detail.length > 0 && <pre className="eui-publish-errlog">{failure.detail.join('\n')}</pre>}
    </>
  )
}
