// Publish-to-world modal: choose a world -> building (log drawer) -> uploading
// -> live! Closing while busy keeps the job running (module-singleton store);
// reopening shows its current state.
import { useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../../ds'
import { useAuth } from '../../auth'
import {
  cancelPublish,
  ensureWorlds,
  formatAgo,
  jumpInUrl,
  refreshWorlds,
  resetPublish,
  startPublish,
  usePublish,
  useWorlds
} from '../../worlds'
import { GlobeIcon, NAME_MARKETPLACE, openExternal, WorldCover } from '../worlds/common'

// ---- publish modal ----
// choose a world -> building (log drawer) -> uploading -> live! Recoverable
// errors at every step; closing mid-publish keeps the job running (the store is
// a module singleton) and reopening shows its current state.
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

  const close = (): void => {
    resetPublish()
    props.onClose()
  }

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
          <p className="s">“{props.sceneTitle}” is now what visitors see at your world.</p>
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
          <p className="s eui-publish-errmsg">{job.error}</p>
          <div className="eui-signin-row">
            <Button variant="primary" size="md" onClick={resetPublish}>Try again</Button>
            <button className="eui-link" onClick={close}>Close</button>
          </div>
          {job.logs.length > 0 && <LogDrawer />}
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
            <button className="eui-link" onClick={close}>Hide — keep publishing</button>
            <button className="eui-link danger" onClick={() => { cancelPublish() }}>Cancel publish</button>
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
                <span className="st">
                  {w.deployment !== null ? `Live: ${w.deployment.title} · ${formatAgo(w.deployment.timestamp)}` : 'Empty'}
                </span>
              </span>
              <span className="pick">{picked === w.name ? '●' : '○'}</span>
            </button>
          ))}
        </div>
        {picked !== null && worlds.find((w) => w.name === picked)?.deployment != null && (
          <p className="eui-publish-note">
            Publishing replaces what's currently live at {picked}. The world keeps its URL and settings.
          </p>
        )}
      </>
    )
  }

  const LogDrawer = (): JSX.Element => (
    <div className="eui-publish-logs">
      <button className="eui-link" onClick={() => setShowLogs((v) => !v)}>
        {showLogs ? 'Hide details' : 'Show details'}
      </button>
      {showLogs && <pre ref={logRef}>{job.logs.slice(-200).join('\n') || '…'}</pre>}
    </div>
  )

  return (
    <div className="eui-modal-backdrop" onClick={busy ? undefined : close}>
      <div className="eui-modal eui-home-modal eui-publish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eui-modal-head">
          <GlobeIcon /> Publish to a world
          <span style={{ flex: 1 }} />
          {/* hide ≠ cancel: the job is a module singleton, it keeps running and
              reopening the modal shows its current state */}
          <button className="eui-publish-x" data-tip={busy ? 'Hide — publishing continues' : 'Close'} onClick={close}>
            ✕
          </button>
        </div>
        <div className="eui-modal-body">{body()}</div>
        {job.phase === 'idle' && auth.wallet !== null && (
          <div className="eui-modal-foot">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={picked === null}
              onClick={() => {
                if (picked !== null) startPublish(props.dir, picked)
              }}
            >
              Publish
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
