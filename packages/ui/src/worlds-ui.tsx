// Worlds UI: the Home "Worlds" tab (live inventory + per-world management) and
// the publish flow. Worlds are the source of truth — fetched from the servers,
// so scenes deployed with the CLI (outside this editor) show up too. Local
// scenes associate to a world through scene.json's worldConfiguration.name
// (ProjectInfo.world); the link is shown on both sides but a missing local
// scene never hides a world.
import { useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '@dcl-editor/contract'
import { Button, Segmented, Spinner } from './ds'
import { useAuth } from './auth'
import {
  addSceneAdmin,
  cancelPublish,
  clearPlayerStorage,
  deleteStorageItem,
  ensureWorlds,
  fetchWorldPermissions,
  formatAgo,
  formatBytes,
  getStreamAccess,
  jumpInUrl,
  listEnvKeys,
  listSceneAdmins,
  listSceneBans,
  listStoragePlayers,
  listStorageValues,
  mutateStreamAccess,
  putEnvKey,
  refreshWorlds,
  removeSceneAdmin,
  resetPublish,
  sceneScopeOf,
  setSceneBan,
  setWorldPermission,
  startPublish,
  usePublish,
  useWorlds,
  type SceneScope,
  type WorldDeployment,
  type WorldEntry,
  type WorldPermissionKind,
  type WorldPermissions
} from './worlds'

const NAME_MARKETPLACE = 'https://decentraland.org/marketplace/names/claim'
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/

function openExternal(url: string): void {
  void window.editorShell?.openExternal?.(url)
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
  // ensureWorlds resets on sign-out/account-switch and fetches when stale
  useEffect(ensureWorlds, [auth.wallet])

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
  const scope = d !== null ? sceneScopeOf(w.name, d) : null
  const [tab, setTab] = useState<'access' | 'streaming' | 'moderation' | 'storage'>('access')
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

        <div className="eui-world-tabs">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'access', label: 'Permissions' },
              { value: 'streaming', label: 'Streaming' },
              { value: 'moderation', label: 'Moderation' },
              { value: 'storage', label: 'Storage' }
            ]}
          />
        </div>
        {tab === 'access' && <AccessPanel world={w.name} wallet={props.wallet} />}
        {tab === 'streaming' && <StreamingPanel scope={scope} />}
        {tab === 'moderation' && <ModerationPanel scope={scope} />}
        {tab === 'storage' && <StoragePanel realm={w.name} d={d} />}
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

// tiny load-with-retry hook shared by the gatekeeper/storage panels
function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; err: string | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    setData(undefined)
    setErr(null)
    fn().then(
      (d) => live && setData(d),
      (e: unknown) => live && setErr(e instanceof Error ? e.message : String(e))
    )
    return () => {
      live = false
    }
  }, [...deps, tick])
  return { data, err, reload: () => setTick((t) => t + 1) }
}

function PanelState(props: { err: string | null; onRetry: () => void; loading: boolean }): JSX.Element | null {
  if (props.err !== null) {
    return (
      <p className="eui-world-hint">
        {props.err} <button className="eui-link" onClick={props.onRetry}>Retry</button>
      </p>
    )
  }
  if (props.loading) {
    return <div className="eui-world-hint"><Spinner size={16} /> Loading…</div>
  }
  return null
}

function PublishFirst(props: { what: string }): JSX.Element {
  return (
    <section className="eui-world-block">
      <p className="eui-world-hint">{props.what} is scoped to the live scene — publish something to this world first.</p>
    </section>
  )
}

function CopyField(props: { label: string; value: string; secret?: boolean }): JSX.Element {
  const [reveal, setReveal] = useState(false)
  const [copied, setCopied] = useState(false)
  const masked = props.secret === true && !reveal
  const copy = (): void => {
    void navigator.clipboard?.writeText(props.value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <div className="eui-copyfield">
      <span className="k">{props.label}</span>
      <span className="v">{masked ? '••••••••••••••••' : props.value}</span>
      {props.secret === true && (
        <button className="eui-link" onClick={() => setReveal((v) => !v)}>{reveal ? 'Hide' : 'Reveal'}</button>
      )}
      <button className="eui-link" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
    </div>
  )
}

// ---- streaming keys (OBS / RTMP) ----
function StreamingPanel(props: { scope: SceneScope | null }): JSX.Element {
  const { scope } = props
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(
    () => (scope === null ? Promise.resolve(null) : getStreamAccess(scope)),
    [scope?.sceneId]
  )
  if (scope === null) return <PublishFirst what="Streaming" />
  const run = (action: 'create' | 'reset' | 'revoke'): void => {
    setBusy(true)
    setActErr(null)
    mutateStreamAccess(scope, action)
      .then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <section className="eui-world-block">
      <h2>Live streaming</h2>
      <p className="eui-world-hint">
        Stream video into your world with OBS or any RTMP tool: generate a key, paste the URL and key into your
        streaming app, and go live. Keys expire after 4 days.
      </p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data === null && err === null && (
        <Button variant="primary" size="sm" disabled={busy} onClick={() => run('create')}>
          {busy ? 'Generating…' : 'Generate streaming key'}
        </Button>
      )}
      {data !== undefined && data !== null && (
        <>
          <CopyField label="Server URL" value={data.url} />
          <CopyField label="Stream key" value={data.key} secret />
          {data.endsAt !== null && (
            <p className="eui-world-hint">Expires {new Date(data.endsAt).toLocaleString()}.</p>
          )}
          <div className="eui-signin-row">
            <Button size="sm" disabled={busy} onClick={() => run('reset')}>Reset key</Button>
            <button className="eui-link danger" disabled={busy} onClick={() => run('revoke')}>Revoke</button>
          </div>
        </>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </section>
  )
}

// ---- moderation (scene admins + bans) ----
function ModerationPanel(props: { scope: SceneScope | null }): JSX.Element {
  const [sub, setSub] = useState<'admins' | 'bans'>('admins')
  if (props.scope === null) return <PublishFirst what="Moderation" />
  return (
    <section className="eui-world-block">
      <div className="eui-world-subtabs">
        <h2>Moderation</h2>
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: 'admins', label: 'Admins' },
            { value: 'bans', label: 'Bans' }
          ]}
        />
      </div>
      {sub === 'admins' ? <AdminsList scope={props.scope} /> : <BansList scope={props.scope} />}
    </section>
  )
}

// shared add-row: a wallet address or a DCL name, Enter or button to submit
function AddByAddressOrName(props: { placeholder: string; busy: boolean; onAdd: (v: string) => void }): JSX.Element {
  const [v, setV] = useState('')
  const submit = (): void => {
    const t = v.trim()
    if (t === '') return
    props.onAdd(t)
    setV('')
  }
  return (
    <div className="eui-perm-add">
      <input
        className="eui-input"
        placeholder={props.placeholder}
        value={v}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <Button size="sm" disabled={props.busy || v.trim() === ''} onClick={submit}>
        {props.busy ? '…' : 'Add'}
      </Button>
    </div>
  )
}

function AdminsList(props: { scope: SceneScope }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listSceneAdmins(props.scope), [props.scope.sceneId])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="eui-world-hint">Admins can moderate the world in-game: kick and ban visitors, manage streams.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.map((a) => (
        <div key={a.admin} className="eui-perm-row">
          <span className="nm">{a.name !== '' ? a.name : shortAddr(a.admin)}</span>
          <span className="wa">{a.admin}</span>
          <span style={{ flex: 1 }} />
          {a.canBeRemoved ? (
            <button className="eui-link" disabled={busy} onClick={() => run(removeSceneAdmin(props.scope, a.admin))}>
              Remove
            </button>
          ) : (
            <span className="eui-world-chip">Owner</span>
          )}
        </div>
      ))}
      {data !== undefined && data.length === 0 && <p className="eui-world-hint">No extra admins yet.</p>}
      <AddByAddressOrName
        placeholder="0x address or DCL name"
        busy={busy}
        onAdd={(v) => run(addSceneAdmin(props.scope, ADDRESS_RE.test(v) ? { admin: v } : { name: v }))}
      />
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

function BansList(props: { scope: SceneScope }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listSceneBans(props.scope), [props.scope.sceneId])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="eui-world-hint">People banned from entering this world.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.bans.map((b) => (
        <div key={b.bannedAddress !== '' ? b.bannedAddress : b.name} className="eui-perm-row">
          <span className="nm">{b.name !== '' ? b.name : shortAddr(b.bannedAddress)}</span>
          <span className="wa">{b.bannedAddress}</span>
          <span style={{ flex: 1 }} />
          <button
            className="eui-link"
            disabled={busy}
            onClick={() =>
              run(setSceneBan(props.scope, b.bannedAddress !== '' ? { address: b.bannedAddress } : { name: b.name }, false))
            }
          >
            Unban
          </button>
        </div>
      ))}
      {data !== undefined && data.bans.length === 0 && <p className="eui-world-hint">Nobody is banned.</p>}
      {data !== undefined && data.total > data.bans.length && (
        <p className="eui-world-hint">Showing the first {data.bans.length} of {data.total}.</p>
      )}
      <AddByAddressOrName
        placeholder="0x address or DCL name to ban"
        busy={busy}
        onAdd={(v) => run(setSceneBan(props.scope, ADDRESS_RE.test(v) ? { address: v } : { name: v }, true))}
      />
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

// ---- server storage (env keys / shared data / per-player data) ----
function StoragePanel(props: { realm: string; d: WorldDeployment | null }): JSX.Element {
  const [sub, setSub] = useState<'env' | 'values' | 'players'>('env')
  if (props.d === null) return <PublishFirst what="Server storage" />
  if (!props.d.authoritativeMultiplayer) {
    return (
      <section className="eui-world-block">
        <h2>Server storage</h2>
        <p className="eui-world-hint">
          Server storage is available for scenes running server-authoritative multiplayer — set
          {' '}<code>"authoritativeMultiplayer": true</code> in the scene's scene.json and publish again.
        </p>
      </section>
    )
  }
  return (
    <section className="eui-world-block">
      <div className="eui-world-subtabs">
        <h2>Server storage</h2>
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: 'env', label: 'Env keys' },
            { value: 'values', label: 'Data' },
            { value: 'players', label: 'Players' }
          ]}
        />
      </div>
      {sub === 'env' && <EnvList realm={props.realm} />}
      {sub === 'values' && <ValuesList realm={props.realm} />}
      {sub === 'players' && <PlayersList realm={props.realm} />}
    </section>
  )
}

function EnvList(props: { realm: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const { data, err, reload } = useLoad(() => listEnvKeys(props.realm), [props.realm])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <>
      <p className="eui-world-hint">Secrets your scene's server code reads at runtime — values are never shown back.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.items.map((key) => (
        <div key={key} className="eui-perm-row">
          <span className="wa">{key}</span>
          <span style={{ flex: 1 }} />
          <button className="eui-link" disabled={busy} onClick={() => run(deleteStorageItem(props.realm, 'env', key))}>
            Delete
          </button>
        </div>
      ))}
      {data !== undefined && data.items.length === 0 && <p className="eui-world-hint">No env keys yet.</p>}
      <div className="eui-perm-add">
        <input className="eui-input" placeholder="KEY" value={k} spellCheck={false} onChange={(e) => setK(e.target.value)} />
        <input className="eui-input" placeholder="value" value={v} spellCheck={false} onChange={(e) => setV(e.target.value)} />
        <Button
          size="sm"
          disabled={busy || k.trim() === '' || v === ''}
          onClick={() => {
            run(putEnvKey(props.realm, k.trim(), v))
            setK('')
            setV('')
          }}
        >
          {busy ? '…' : 'Set'}
        </Button>
      </div>
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

function ValuesList(props: { realm: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listStorageValues(props.realm), [props.realm])
  const run = (fn: Promise<void>): void => {
    setBusy(true)
    setActErr(null)
    fn.then(reload)
      .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  const preview = (val: unknown): string => {
    const s = JSON.stringify(val) ?? ''
    return s.length > 80 ? `${s.slice(0, 80)}…` : s
  }
  return (
    <>
      <p className="eui-world-hint">Shared key-value data your scene stores on the server.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.items.map((it) => (
        <div key={it.key} className="eui-perm-row">
          <span className="wa">{it.key}</span>
          <span className="vp">{preview(it.value)}</span>
          <span style={{ flex: 1 }} />
          <button className="eui-link" disabled={busy} onClick={() => run(deleteStorageItem(props.realm, 'values', it.key))}>
            Delete
          </button>
        </div>
      ))}
      {data !== undefined && data.items.length === 0 && <p className="eui-world-hint">No data stored yet.</p>}
      {data !== undefined && data.total > data.items.length && (
        <p className="eui-world-hint">Showing the first {data.items.length} of {data.total}.</p>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
  )
}

function PlayersList(props: { realm: string }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [actErr, setActErr] = useState<string | null>(null)
  const { data, err, reload } = useLoad(() => listStoragePlayers(props.realm), [props.realm])
  return (
    <>
      <p className="eui-world-hint">Players with per-player data stored by your scene.</p>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data?.items.map((addr) => (
        <div key={addr} className="eui-perm-row">
          <span className="wa">{addr}</span>
          <span style={{ flex: 1 }} />
          <button
            className="eui-link danger"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setActErr(null)
              clearPlayerStorage(props.realm, addr)
                .then(reload)
                .catch((e: unknown) => setActErr(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false))
            }}
          >
            Clear data
          </button>
        </div>
      ))}
      {data !== undefined && data.items.length === 0 && <p className="eui-world-hint">No player data stored yet.</p>}
      {data !== undefined && data.total > data.items.length && (
        <p className="eui-world-hint">Showing the first {data.items.length} of {data.total}.</p>
      )}
      {actErr !== null && <p className="eui-perm-err">{actErr}</p>}
    </>
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
