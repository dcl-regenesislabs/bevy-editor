// Worlds UI: the Home "Worlds" tab (live inventory + per-world management) and
// the publish flow. Worlds are the source of truth — fetched from the servers,
// so scenes deployed with the CLI (outside this editor) show up too. Local
// scenes associate to a world through scene.json's worldConfiguration.name
// (ProjectInfo.world); the link is shown on both sides but a missing local
// scene never hides a world.
import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '@dcl-editor/contract'
import { Button, Spinner } from './ds'
import { useAuth } from './auth'
import {
  cancelPublish,
  fetchWorldPermissions,
  formatAgo,
  formatBytes,
  refreshWorlds,
  resetPublish,
  setWorldPermission,
  startPublish,
  usePublish,
  useWorlds,
  type WorldEntry,
  type WorldPermissionKind,
  type WorldPermissions
} from './worlds'

const NAME_MARKETPLACE = 'https://decentraland.org/marketplace/names/claim'
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

function openExternal(url: string): void {
  void window.editorShell?.openExternal?.(url)
}
function jumpInUrl(name: string): string {
  return `https://play.decentraland.org/?realm=${encodeURIComponent(name)}`
}
const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

const GlobeIcon = (props: { size?: number }): JSX.Element => (
  <svg width={props.size ?? 15} height={props.size ?? 15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.8 8h12.4M8 1.8c-4.4 4.1-4.4 8.3 0 12.4 4.4-4.1 4.4-8.3 0-12.4Z" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

// world "cover": places image, else deployment thumb, else a monogram tile
function WorldCover(props: { w: WorldEntry }): JSX.Element {
  const src = props.w.image ?? props.w.deployment?.thumbnail ?? null
  return src !== null ? (
    <img className="eui-world-cover" src={src} alt="" loading="lazy" />
  ) : (
    <div className="eui-world-cover fallback">
      <GlobeIcon size={26} />
    </div>
  )
}

function linkedScenes(projects: ProjectInfo[], world: string): ProjectInfo[] {
  return projects.filter((p) => p.world !== null && p.world.toLowerCase() === world && p.missing !== true)
}

// ---- Worlds tab ----
export function WorldsSection(props: {
  projects: ProjectInfo[]
  initialWorld?: string | null
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const auth = useAuth()
  const { worlds, status, error } = useWorlds()
  const [selected, setSelected] = useState<string | null>(props.initialWorld ?? null)
  useEffect(() => {
    if (auth.wallet !== null && status === 'idle') refreshWorlds()
  }, [auth.wallet, status])

  if (auth.wallet === null) {
    return (
      <>
        <WorldsHead />
        <div className="eui-account-card">
          <div className="eui-signin">
            <div className="eui-account-empty-icon"><GlobeIcon size={22} /></div>
            <p className="t">Sign in to see your worlds</p>
            <p className="s">Your Decentraland NAMEs are worlds you can publish scenes to.</p>
            <Button variant="primary" size="md" onClick={auth.signIn}>Sign in with Decentraland</Button>
          </div>
        </div>
      </>
    )
  }

  const detail = selected !== null ? worlds.find((w) => w.name === selected) : undefined
  if (detail !== undefined) {
    return (
      <WorldDetail
        w={detail}
        projects={props.projects}
        wallet={auth.wallet}
        onBack={() => setSelected(null)}
        onOpenScene={props.onOpenScene}
        onPublishScene={props.onPublishScene}
      />
    )
  }

  return (
    <>
      <WorldsHead onRefresh={status === 'loading' ? undefined : refreshWorlds} />
      {status === 'loading' && worlds.length === 0 && (
        <div className="eui-world-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="eui-world-card skeleton" />
          ))}
        </div>
      )}
      {status === 'error' && (
        <div className="eui-home-first">
          <p className="t">Couldn't load your worlds</p>
          <p className="s">{error}</p>
          <Button variant="primary" size="md" onClick={refreshWorlds}>Try again</Button>
        </div>
      )}
      {status === 'ready' && worlds.length === 0 && (
        <div className="eui-home-first">
          <GlobeIcon size={22} />
          <p className="t">No worlds yet</p>
          <p className="s">
            A Decentraland NAME gives you a world of your own — a place with its own URL where you can publish any scene.
          </p>
          <div className="eui-home-cta">
            <Button variant="primary" size="md" onClick={() => openExternal(NAME_MARKETPLACE)}>Get a NAME</Button>
            <Button variant="ghost" size="md" onClick={refreshWorlds}>Refresh</Button>
          </div>
        </div>
      )}
      {worlds.length > 0 && (
        <div className="eui-world-grid">
          {worlds.map((w) => (
            <WorldCard key={w.name} w={w} projects={props.projects} onOpen={() => setSelected(w.name)} />
          ))}
        </div>
      )}
    </>
  )
}

function WorldsHead(props: { onRefresh?: () => void }): JSX.Element {
  return (
    <header className="eui-home-head">
      <div>
        <h1>Your worlds</h1>
        <p>What's live on your Decentraland NAMEs — published from here, the CLI, or anywhere else.</p>
      </div>
      {props.onRefresh !== undefined && (
        <div className="eui-home-cta">
          <Button variant="ghost" size="md" onClick={props.onRefresh}>Refresh</Button>
        </div>
      )}
    </header>
  )
}

function WorldCard(props: { w: WorldEntry; projects: ProjectInfo[]; onOpen: () => void }): JSX.Element {
  const { w } = props
  const linked = linkedScenes(props.projects, w.name)
  const live = w.deployment !== null
  return (
    <div className="eui-world-card" role="button" tabIndex={0} onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onOpen()
        }
      }}
    >
      <WorldCover w={w} />
      <div className="eui-world-meta">
        <span className="nm">{w.name}</span>
        <span className={`eui-world-status ${live ? 'live' : ''}`}>
          {live ? (
            <>
              <span className="dot" />
              {w.deployment!.title} · {formatAgo(w.deployment!.timestamp)}
            </>
          ) : (
            'Nothing published yet'
          )}
        </span>
        {linked.length > 0 && (
          <span className="eui-world-linked" data-tip={linked.map((p) => p.title).join(', ')}>
            ⛶ {linked.length === 1 ? linked[0].title : `${linked.length} local scenes`}
          </span>
        )}
      </div>
      <div className="eui-world-tags">
        {w.role === 'collaborator' && <span className="eui-world-chip">Collaborator</span>}
        {w.userCount !== null && w.userCount > 0 && <span className="eui-world-chip live">{w.userCount} online</span>}
      </div>
    </div>
  )
}

// ---- world detail (overview + access management) ----
function WorldDetail(props: {
  w: WorldEntry
  projects: ProjectInfo[]
  wallet: string
  onBack: () => void
  onOpenScene: (dir: string) => void
  onPublishScene: (p: ProjectInfo, world: string) => void
}): JSX.Element {
  const { w } = props
  const d = w.deployment
  const linked = linkedScenes(props.projects, w.name)
  return (
    <>
      <header className="eui-home-head eui-world-dhead">
        <div>
          <button className="eui-link eui-world-back" onClick={props.onBack}>← All worlds</button>
          <h1>{w.name}</h1>
          <p>{d !== null ? `Live — “${d.title}”, updated ${formatAgo(d.timestamp)}.` : 'Nothing published here yet.'}</p>
        </div>
        <div className="eui-home-cta">
          {d !== null && (
            <Button variant="primary" size="md" onClick={() => openExternal(jumpInUrl(w.name))}>Jump in</Button>
          )}
        </div>
      </header>

      <div className="eui-world-detail">
        <div className="eui-world-hero">
          <WorldCover w={w} />
          <div className="eui-world-facts">
            {(
              [
                ['Last published', d !== null ? formatAgo(d.timestamp) : '—'],
                ['Published by', d?.deployer !== null && d !== null ? shortAddr(d.deployer!) : '—'],
                ['Size', formatBytes(d?.size ?? w.size)],
                ['Parcels', d !== null ? String(d.parcels) : '—'],
                ['Your role', w.role === 'owner' ? 'Owner' : 'Collaborator']
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k} className="eui-world-fact">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="eui-world-block">
          <h2>Scenes on this computer</h2>
          {linked.length === 0 ? (
            <p className="eui-world-hint">
              No local scene is linked to this world. Publish any scene here and it will link automatically
              {d !== null ? ' — the current content was published from somewhere else (CLI or another computer), and stays live either way.' : '.'}
            </p>
          ) : (
            <div className="eui-world-scenes">
              {linked.map((p) => (
                <div key={p.path} className="eui-world-scene">
                  {p.thumbnail !== null ? <img src={p.thumbnail} alt="" /> : <span className="ph">⛶</span>}
                  <div className="meta">
                    <span className="nm">{p.title}</span>
                    <span className="pt">{p.path}</span>
                  </div>
                  <span style={{ flex: 1 }} />
                  <Button size="sm" onClick={() => props.onOpenScene(p.path)}>Open</Button>
                  <Button size="sm" variant="primary" onClick={() => props.onPublishScene(p, w.name)}>Publish update</Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <AccessPanel world={w.name} wallet={props.wallet} />

        <section className="eui-world-block">
          <h2>More tools</h2>
          <div className="eui-world-soon-row">
            {['Streaming keys', 'Admins & bans', 'Server storage'].map((t) => (
              <span key={t} className="eui-world-chip soon">{t} — soon</span>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

const PERMISSION_COPY: Record<WorldPermissionKind, { title: string; hint: string }> = {
  deployment: { title: 'Who can publish', hint: 'Wallets allowed to publish scenes to this world (the owner always can).' },
  access: { title: 'Who can visit', hint: 'Who can enter the world.' },
  streaming: { title: 'Who can stream', hint: 'Wallets allowed to stream video/audio inside the world.' }
}

function AccessPanel(props: { world: string; wallet: string }): JSX.Element {
  const [perms, setPerms] = useState<WorldPermissions | null | 'loading'>('loading')
  const load = (): void => {
    void fetchWorldPermissions(props.world).then(setPerms)
  }
  useEffect(load, [props.world])

  if (perms === 'loading') {
    return (
      <section className="eui-world-block">
        <h2>Permissions</h2>
        <div className="eui-world-hint"><Spinner size={16} /> Loading…</div>
      </section>
    )
  }
  if (perms === null) {
    return (
      <section className="eui-world-block">
        <h2>Permissions</h2>
        <p className="eui-world-hint">Couldn't load this world's permissions. <button className="eui-link" onClick={load}>Retry</button></p>
      </section>
    )
  }
  const isOwner = perms.owner === props.wallet.toLowerCase()
  return (
    <section className="eui-world-block">
      <h2>Permissions</h2>
      {(['deployment', 'access', 'streaming'] as WorldPermissionKind[]).map((kind) => (
        <PermissionList key={kind} kind={kind} world={props.world} entry={perms[kind]} isOwner={isOwner} onChanged={load} />
      ))}
      {!isOwner && <p className="eui-world-hint">Only the world owner can change permissions.</p>}
    </section>
  )
}

function PermissionList(props: {
  kind: WorldPermissionKind
  world: string
  entry: { type: string; wallets: string[] }
  isOwner: boolean
  onChanged: () => void
}): JSX.Element {
  const { entry, kind } = props
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isList = entry.type === 'allow-list'
  const copy = PERMISSION_COPY[kind]

  const run = (fn: () => Promise<void>): void => {
    setBusy(true)
    setErr(null)
    fn()
      .then(() => {
        setAdding('')
        props.onChanged()
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="eui-perm">
      <div className="eui-perm-head">
        <span className="t">{copy.title}</span>
        <span className="eui-world-chip">
          {isList ? (kind === 'access' ? `Allow list (${entry.wallets.length})` : entry.wallets.length === 0 ? 'Only the owner' : `Allow list (${entry.wallets.length})`) : entry.type === 'unrestricted' ? 'Everyone' : entry.type}
        </span>
      </div>
      <p className="eui-world-hint">{copy.hint}</p>
      {isList && (
        <>
          {entry.wallets.map((a) => (
            <div key={a} className="eui-perm-row">
              <span className="wa">{a}</span>
              {props.isOwner && (
                <button className="eui-link" disabled={busy} onClick={() => run(() => setWorldPermission(props.world, kind, a, false))}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {props.isOwner && (
            <div className="eui-perm-add">
              <input
                className="eui-input"
                placeholder="0x wallet address"
                value={adding}
                spellCheck={false}
                onChange={(e) => {
                  setAdding(e.target.value)
                  setErr(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ADDRESS_RE.test(adding.trim())) {
                    run(() => setWorldPermission(props.world, kind, adding.trim(), true))
                  }
                }}
              />
              <Button
                size="sm"
                disabled={busy || !ADDRESS_RE.test(adding.trim())}
                onClick={() => run(() => setWorldPermission(props.world, kind, adding.trim(), true))}
              >
                {busy ? '…' : 'Add'}
              </Button>
            </div>
          )}
        </>
      )}
      {err !== null && <p className="eui-perm-err">{err}</p>}
    </div>
  )
}

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
  const { worlds, status } = useWorlds()
  const job = usePublish()
  const [picked, setPicked] = useState<string | null>(props.currentWorld?.toLowerCase() ?? null)
  const [showLogs, setShowLogs] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (auth.wallet !== null && status === 'idle') refreshWorlds()
  }, [auth.wallet, status])
  useEffect(() => {
    if (logRef.current !== null) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job.logs, showLogs])

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
          <button className="eui-link" onClick={() => { cancelPublish() }}>Cancel</button>
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
