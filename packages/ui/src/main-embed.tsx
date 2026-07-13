// Host-app entry (editor-app.html): the same editor React app, with the bevy
// engine in a same-origin iframe instead of this window. Runs in the Electron
// shell (which exposes window.editorShell for project management) and in a
// plain browser tab against terminal-run servers. All engine communication
// goes through the console-command RPC seam (`./console`), pointed at
// iframe.contentWindow.
// Inter Variable is registered at document level (@font-face penetrates the
// shadow DOM even though regular selectors don't).
import '@fontsource-variable/inter/index.css'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './ds/styles'
import { collectCss } from './ds/styles/registry'
import { boot } from './boot'
import { useStore } from './store'
import { state } from '../../scene/src/state'
import { consoleCommand, setEngineWindow, engineReady } from './console'
import { cmd } from './cmd'
import { log } from './log'
import { ENGINE_BOOT_WATCHDOG_MS } from './config'
import { setDataLayerRealm } from './datalayer'
import { forwardEngineKeys } from './embed'
import { TooltipLayer } from './panels/Tooltip'
import { AiPanel, AiFab } from './panels/AiPanel'
import { Button, Segmented, Select, SearchField, Spinner, Toast, useOutsideClose } from './ds'
import { AccountBadge, AccountSection } from './features/account/account'
import { WorldsSection } from './features/worlds/WorldsSection'
import { PublishModal } from './features/publish/PublishModal'
// shared cross-process contracts — single source of truth (also used by desktop)
import type { ServersReady, ProjectInfo, HostState, EditorShell, SceneTemplate } from '@dcl-editor/contract'

declare const __EDITOR_UI_BUILD__: string

declare global {
  interface Window {
    editorShell?: EditorShell
  }
}

// Our own engine host page (engine.html), which boots the upstream engine via
// its boot contract (/engine/boot.js + __bevyLaunch). The engine package's root
// index.html is the full Decentraland React HUD now — not loadable as a bare
// engine — so the editor owns the boot page.
// Leave the current scene for the picker. Stops the project's dev server (and
// its auth-server child) first via the shell so it doesn't linger, then
// navigates. Falls back to a plain navigation in-page (no shell).
function backToProjects(): void {
  const shell = window.editorShell
  if (shell?.closeProject !== undefined) {
    void shell.closeProject().finally(() => window.location.assign('/editor-app.html'))
  } else {
    window.location.assign('/editor-app.html')
  }
}

function engineUrl(params: URLSearchParams): string {
  const q = new URLSearchParams()
  q.set('position', params.get('position') ?? '0,0')
  q.set('systemScene', params.get('systemScene') ?? 'http://localhost:8005')
  q.set('realm', params.get('realm') ?? 'http://localhost:8004')
  return `/engine.html?${q}`
}

const TerminalIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="1" y="2.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M4 6l2.5 2L4 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 10.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

// Bottom-docked log drawer: the inspected scene's own console output (what the
// scene prints while running), plus the local stack's server output when the
// electron shell is present. Open/close is owned by Editor and toggled from the
// topbar — no floating button.
function LogsDrawer(props: { open: boolean; onClose: () => void }): JSX.Element | null {
  const shell = window.editorShell
  const { open, onClose } = props
  const [tab, setTab] = useState<'scene' | 'server'>(shell !== undefined ? 'server' : 'scene')
  const [serverLogs, setServerLogs] = useState<string[]>([])
  const [sceneLogs, setSceneLogs] = useState('(no scene logs yet)')
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (shell === undefined) return
    void shell.getState().then((s) => setServerLogs(s.logs))
    shell.onStackLog((line) => setServerLogs((prev) => [...prev.slice(-400), line]))
  }, [])
  useEffect(() => {
    if (!open || tab !== 'scene') return
    let live = true
    const poll = async (): Promise<void> => {
      try {
        const reply = await cmd.sceneLogs(200)
        if (live) setSceneLogs(reply)
      } catch {
        /* engine not ready yet */
      }
    }
    void poll()
    const t = setInterval(() => void poll(), 2000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [open, tab])
  useEffect(() => {
    if (pre.current !== null) pre.current.scrollTop = pre.current.scrollHeight
  }, [serverLogs, sceneLogs, open, tab])
  if (!open) return null
  return (
    <div className="eui-logs-drawer">
      <div className="eui-logs-tabs">
        {shell !== undefined && (
          <button className={tab === 'server' ? 'on' : ''} onClick={() => setTab('server')}>
            Build / Server
          </button>
        )}
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')}>
          Scene console
        </button>
        <span className="eui-logs-spacer" />
        <button onClick={onClose} data-tip="Hide logs">
          ✕
        </button>
      </div>
      <pre ref={pre} className="eui-logs-body">
        {tab === 'scene'
          ? sceneLogs
          : serverLogs.length > 0
            ? serverLogs.join('\n')
            : '(waiting for sdk-commands server output…)'}
      </pre>
    </div>
  )
}

function Editor(props: { params: URLSearchParams }): JSX.Element {
  const status = useStore(() => state.status)
  const scene = useStore(() => state.scene)
  const booted = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const recovered = useRef(false)
  const attach = (iframe: HTMLIFrameElement | null): void => {
    iframeRef.current = iframe
    if (iframe === null || booted.current) return
    booted.current = true
    const wire = (): void => {
      if (iframe.contentWindow === null) {
        setTimeout(wire, 100)
        return
      }
      setEngineWindow(iframe.contentWindow)
      forwardEngineKeys(iframe.contentWindow) // viewport-focused keystrokes → host shortcuts
      void boot()
    }
    wire()
  }

  // Engine boot watchdog. A corrupt IndexedDB makes the engine's indexedDB.open
  // fail, so it never registers its console command and boot() spins forever at
  // "logging-in". If the engine isn't ready in 40s, ask the shell to clear the
  // bad storage, then reload the iframe and re-point the console at the fresh
  // contentWindow — the still-running boot() loop then completes. Runs once.
  useEffect(() => {
    const t = setTimeout(() => {
      if (engineReady() || recovered.current) return
      recovered.current = true
      const shell = window.editorShell
      const iframe = iframeRef.current
      if (shell?.recoverEngineStorage === undefined || iframe === null) return
      void shell.recoverEngineStorage().then((cleared) => {
        if (!cleared || iframe.contentWindow === null) return
        const onLoad = (): void => {
          iframe.removeEventListener('load', onLoad)
          if (iframe.contentWindow !== null) {
            setEngineWindow(iframe.contentWindow)
            forwardEngineKeys(iframe.contentWindow)
          }
        }
        iframe.addEventListener('load', onLoad)
        iframe.src = engineUrl(props.params)
      })
    }, ENGINE_BOOT_WATCHDOG_MS)
    return () => clearTimeout(t)
  }, [props.params])
  // The iframe mounts immediately but stays hidden behind the engine-init
  // overlay until the editor reports the scene is fully ready — so the user
  // never stares at a half-rendered viewport or a silent stall.
  const ready = status === 'ready' && scene !== undefined
  const [logsOpen, setLogsOpen] = useState(false)
  return (
    <>
      <iframe
        ref={attach}
        src={engineUrl(props.params)}
        title="bevy engine"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          border: 0,
          zIndex: 0,
          // .eui-root is pointer-events:none (panels opt back in); the engine
          // viewport must receive real input — clicks focus the iframe so
          // WASD/mouse reach winit directly
          pointerEvents: 'auto'
        }}
      />
      {!ready && <EngineInitOverlay />}
      <SceneTopbar
        logsOpen={logsOpen}
        onToggleLogs={() => setLogsOpen((v) => !v)}
        project={props.params.get('project')}
      />
      <App />
      <AiPanel />
      <AiFab />
      <LogsDrawer open={logsOpen} onClose={() => setLogsOpen(false)} />
    </>
  )
}

// Covers the viewport while the engine compiles/loads the scene. Shows live
// build/scene logs so a stall or error is visible, never a frozen screen.
function EngineInitOverlay(): JSX.Element {
  const status = useStore(() => state.status)
  const [logs, setLogs] = useState<string[]>([])
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const shell = window.editorShell
    let live = true
    if (shell !== undefined) {
      void shell.getState().then((s) => live && setLogs(s.logs.slice(-60)))
      shell.onStackLog((line) => setLogs((prev) => [...prev.slice(-60), line]))
    }
    // also surface the engine's own scene console as it boots
    const poll = setInterval(() => {
      cmd.sceneLogs(40)
        .then((r) => {
          if (live && r && !r.includes('no logs')) setLogs((prev) => [...prev.slice(-40), ...r.split('\n').slice(-6)])
        })
        .catch((e) => log.debug('sceneLogs poll failed', e))
    }, 2500)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [])
  useEffect(() => {
    if (pre.current !== null) pre.current.scrollTop = pre.current.scrollHeight
  }, [logs])
  // Logs are noise during a normal boot — show only the spinner + status. Reveal
  // the log drawer when the scene actually errors, so a failure is still diagnosable.
  const showLogs = status === 'error'
  return (
    <div className="eui-loading">
      <div className="eui-loading-card">
        <Spinner size={30} />
        <div className="eui-loading-title">{statusLabel()}</div>
        {showLogs && (
          <pre ref={pre} className="eui-loading-log">
            {logs.length > 0 ? logs.join('\n') : '…'}
          </pre>
        )}
      </div>
    </div>
  )
}

function statusLabel(): string {
  switch (state.status) {
    case 'logging-in':
      return 'Connecting to scene…'
    case 'loading-snapshot':
      return 'Loading scene…'
    case 'error':
      return 'Scene error — see logs'
    default:
      return 'Starting engine…'
  }
}

// Slim top bar over the viewport: scene name on the left, settings + back-to-
// home on the right. Replaces the old floating ⌂ button.
function SceneTopbar(props: { logsOpen: boolean; onToggleLogs: () => void; project?: string | null }): JSX.Element {
  const scene = useStore(() => state.scene)
  const [menuOpen, setMenuOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [world, setWorld] = useState<string | null>(null)
  const title = scene?.title ?? scene?.hash ?? 'Loading scene…'
  const home = backToProjects
  const project = props.project ?? null
  // the scene's current target world (for pre-selecting in the publish modal)
  useEffect(() => {
    if (project === null || window.editorShell === undefined) return
    void window.editorShell.getState().then((s) => {
      setWorld(s.projects.find((p) => p.path === project)?.world ?? null)
    })
  }, [project, publishing])
  return (
    <div className="eui-topbar">
      <button className="eui-topbar-home" data-tip="Back to projects" onClick={home}>
        <ArrowLeftIcon />
      </button>
      <div className="eui-topbar-title">
        <span className="eui-overline">Editing</span>
        <span className="eui-title">{title}</span>
      </div>
      <span style={{ flex: 1 }} />
      {window.editorShell !== undefined && project !== null && (
        <button className="eui-topbar-publish" onClick={() => setPublishing(true)}>
          Publish
        </button>
      )}
      <button
        className={`eui-topbar-btn ${props.logsOpen ? 'on' : ''}`}
        data-tip={props.logsOpen ? 'Hide logs' : 'Show build / server logs'}
        onClick={props.onToggleLogs}
      >
        <TerminalIcon />
      </button>
      {window.editorShell !== undefined && (
        <div className="eui-topbar-menu-wrap">
          <button
            className="eui-topbar-btn"
            data-tip="Settings"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <GearIcon />
          </button>
          {menuOpen && (
            <>
              <div className="eui-topbar-scrim" onClick={() => setMenuOpen(false)} />
              <div className="eui-ctx eui-topbar-menu">
                <button className="eui-menu-item" onClick={home}>Back to projects</button>
                <button className="eui-menu-item" onClick={() => window.location.reload()}>Reload editor</button>
              </div>
            </>
          )}
        </div>
      )}
      {window.editorShell !== undefined && <AccountBadge />}
      {publishing && project !== null && (
        <PublishModal
          dir={project}
          sceneTitle={typeof title === 'string' ? title : 'this scene'}
          currentWorld={world}
          onClose={() => setPublishing(false)}
        />
      )}
    </div>
  )
}

const ArrowLeftIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M10 3.5 5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const GearIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)
const FolderIcon = (): JSX.Element => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
)

type HomeSection = 'scenes' | 'worlds' | 'settings' | 'account'
type SortKey = 'recent' | 'name' | 'parcels'

const folderName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? p

const NAV: Array<[HomeSection, string]> = [
  ['scenes', 'Scenes'],
  ['worlds', 'Worlds'],
  ['settings', 'Settings'],
  ['account', 'Account']
]

const SORTERS: Record<SortKey, (a: ProjectInfo, b: ProjectInfo) => number> = {
  recent: (a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0),
  name: (a, b) => a.title.localeCompare(b.title),
  parcels: (a, b) => b.parcels - a.parcels
}

// "opened 2h ago" style relative time.
function relTime(ms?: number): string {
  if (ms === undefined) return ''
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  return new Date(ms).toLocaleDateString()
}

function sceneSub(p: ProjectInfo): string {
  if (p.missing === true) return 'Folder not found'
  return p.world !== null ? p.world : `${p.parcels} parcel${p.parcels === 1 ? '' : 's'}`
}

function SceneCard(props: {
  p: ProjectInfo
  shell: EditorShell
  onOpen: () => void
  onChanged: () => void
  onRemove: (p: ProjectInfo) => void
  onPublish: () => void
}): JSX.Element {
  const { p, shell } = props
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(menu, ref, () => setMenu(false))

  const after = (op?: Promise<unknown>): void => {
    setMenu(false)
    void Promise.resolve(op).then(() => props.onChanged())
  }
  const open = (): void => {
    if (!menu && !renaming && p.missing !== true) props.onOpen()
  }

  return (
    <div
      ref={ref}
      className={`eui-scene-card ${p.missing === true ? 'missing' : ''}`}
      role="button"
      tabIndex={0}
      data-tip={p.path}
      onClick={open}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !renaming) {
          e.preventDefault()
          open()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu(true)
      }}
    >
      <div className="eui-scene-thumb">
        {p.thumbnail !== null ? <img src={p.thumbnail} alt="" /> : <div className="eui-scene-thumb-fallback"><FolderIcon /></div>}
      </div>
      {p.favourite === true && <span className="eui-scene-pin" data-tip="Favourite">★</span>}
      <div className="eui-scene-meta">
        {renaming ? (
          <input
            className="eui-scene-rename"
            autoFocus
            defaultValue={p.title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setRenaming(false)
              const v = e.target.value.trim()
              if (v !== '' && v !== p.title) after(shell.renameProject?.(p.path, v))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="eui-scene-name">{p.title}</span>
        )}
        {p.world !== null && p.missing !== true ? (
          <span className="eui-scene-sub">
            <span className="eui-world-chip on-card" data-tip="This scene publishes to your world">◆ {p.world}</span>
          </span>
        ) : (
          <span className="eui-scene-sub">{sceneSub(p)}</span>
        )}
        {p.lastOpened !== undefined && p.missing !== true && (
          <span className="eui-scene-ago">opened {relTime(p.lastOpened)}</span>
        )}
      </div>

      <div className="eui-scene-actions">
        {p.missing !== true && (
          <button
            className={`eui-scene-iact ${p.favourite === true ? 'on' : ''}`}
            data-tip={p.favourite === true ? 'Unfavourite' : 'Favourite'}
            onClick={(e) => {
              e.stopPropagation()
              after(shell.toggleFavourite?.(p.path))
            }}
          >
            {p.favourite === true ? '★' : '☆'}
          </button>
        )}
        <button
          className="eui-scene-iact"
          data-tip="More"
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
        >
          ⋯
        </button>
      </div>

      {menu && (
        <div className="eui-ctx eui-scene-menu" onClick={(e) => e.stopPropagation()}>
          {p.missing !== true && (
            <>
              <button className="eui-menu-item" onClick={props.onOpen}>Open<span className="hint">↵</span></button>
              <button className="eui-menu-item" onClick={() => after(shell.toggleFavourite?.(p.path))}>
                {p.favourite === true ? 'Unfavourite' : 'Favourite'}
              </button>
              <button className="eui-menu-item" onClick={() => after(shell.revealInFinder?.(p.path))}>Reveal in Finder</button>
              <button
                className="eui-menu-item"
                onClick={() => {
                  setMenu(false)
                  setRenaming(true)
                }}
              >
                Rename
              </button>
              <button className="eui-menu-item" onClick={() => after(shell.duplicateProject?.(p.path))}>Duplicate</button>
              <div className="eui-menu-sep" />
              <button
                className="eui-menu-item"
                onClick={() => {
                  setMenu(false)
                  props.onPublish()
                }}
              >
                {p.world !== null ? `Publish to ${p.world}…` : 'Publish to a world…'}
              </button>
              <div className="eui-menu-sep" />
            </>
          )}
          <button
            className="eui-menu-item"
            onClick={() => {
              setMenu(false)
              props.onRemove(p)
            }}
          >
            Remove from list
          </button>
          {p.missing !== true && (
            <button
              className="eui-menu-item danger"
              onClick={() =>
                after(
                  shell.deleteProject?.(p.path).then((ok) => {
                    if (ok !== true) return
                  })
                )
              }
            >
              Delete from disk…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// New-scene modal: pick a template + name + location, then scaffold from a
// bundled template folder and open it.
function NewSceneModal(props: { shell: EditorShell; onClose: () => void; onCreated: (dir: string) => void }): JSX.Element {
  const { shell } = props
  const [templates, setTemplates] = useState<SceneTemplate[]>([])
  const [template, setTemplate] = useState('blank')
  const [name, setName] = useState('My Scene')
  const [parent, setParent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void shell.sceneTemplates?.().then((t) => {
      setTemplates(t)
      if (t[0] !== undefined) setTemplate(t[0].id)
    })
  }, [])
  const create = async (): Promise<void> => {
    if (parent === null || name.trim() === '') return
    setBusy(true)
    setErr(null)
    try {
      const dir = await shell.createScene?.(parent, name, template)
      if (dir === null || dir === undefined) throw new Error('could not create the scene')
      props.onCreated(dir)
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }
  return (
    <div className="eui-modal-backdrop" onClick={props.onClose}>
      <div className="eui-modal eui-home-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eui-modal-head">New scene</div>
        <div className="eui-modal-body">
          <div className="eui-home-field">
            <label className="eui-home-flabel">Template</label>
            <div className="eui-tpl-grid">
              {templates.map((t) => (
                <button key={t.id} className={`eui-tpl-card ${t.id === template ? 'on' : ''}`} onClick={() => setTemplate(t.id)}>
                  <span className="nm">{t.name}</span>
                  <span className="ds">{t.description}</span>
                </button>
              ))}
              {templates.length === 0 && <div className="eui-home-empty">No templates bundled.</div>}
            </div>
          </div>
          <div className="eui-home-field">
            <label className="eui-home-flabel">Name</label>
            <input className="eui-input" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </div>
          <div className="eui-home-field">
            <label className="eui-home-flabel">Location</label>
            <div className="eui-home-loc">
              <span className="path">{parent ?? 'Choose a folder…'}</span>
              <Button onClick={() => void shell.pickFolder?.().then((d) => d !== null && d !== undefined && setParent(d))}>
                {parent === null ? 'Choose…' : 'Change…'}
              </Button>
            </div>
          </div>
          {err !== null && <div className="eui-script-err">{err}</div>}
        </div>
        <div className="eui-modal-foot">
          <Button onClick={props.onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || parent === null || name.trim() === '' || templates.length === 0}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create scene'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Roblox/creator-hub-style home: a left rail (Scenes / Settings / Account) and a
// content area. No logs here — those live in the in-scene Build/Server drawer.
function Picker(): JSX.Element {
  const shell = window.editorShell
  const [cfg, setCfg] = useState<HostState | null>(null)
  const [section, setSection] = useState<HomeSection>('scenes')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState<{ path: string; name: string } | null>(null)
  const [publish, setPublish] = useState<{ dir: string; title: string; world: string | null } | null>(null)
  const [worldsFocus, setWorldsFocus] = useState<string | null>(null) // deep-link into a world's detail
  const removeTimer = useRef<ReturnType<typeof setTimeout>>()
  const refresh = (): void => {
    void shell?.getState().then(setCfg)
  }
  useEffect(() => {
    if (shell === undefined) return
    void shell.getState().then((s) => {
      setCfg(s)
      setView(s.viewMode ?? 'grid')
    })
  }, [])
  if (shell === undefined) {
    return <div className="eui-boot">Editor host — pass ?realm=…&systemScene=… to attach to a running stack</div>
  }

  const setViewMode = (v: 'grid' | 'list'): void => {
    setView(v)
    void shell.setViewMode?.(v)
  }
  // Undo-able remove: hide the card, commit the removal after a grace period.
  const requestRemove = (p: ProjectInfo): void => {
    setPending({ path: p.path, name: p.title })
    clearTimeout(removeTimer.current)
    removeTimer.current = setTimeout(() => {
      void shell.removeFromRecents?.(p.path).then(refresh)
      setPending(null)
    }, 4500)
  }
  const undoRemove = (): void => {
    clearTimeout(removeTimer.current)
    setPending(null)
  }

  const all = (cfg?.projects ?? []).filter((p) => p.path !== pending?.path)
  const q = search.trim().toLowerCase()
  const filtered =
    q === '' ? all : all.filter((p) => `${p.title} ${p.world ?? ''} ${p.path}`.toLowerCase().includes(q))
  const sorted = [...filtered].sort(SORTERS[sort])
  const favs = sorted.filter((p) => p.favourite === true)
  const recents = sorted.filter((p) => p.favourite !== true)

  const card = (p: ProjectInfo): JSX.Element => (
    <SceneCard
      key={p.path}
      p={p}
      shell={shell}
      onOpen={() => void shell.openProject(p.path)}
      onChanged={refresh}
      onRemove={requestRemove}
      onPublish={() => setPublish({ dir: p.path, title: p.title, world: p.world })}
    />
  )

  return (
    <div className="eui-home">
      <nav className="eui-home-rail">
        <div className="eui-home-brand">
          <span className="eui-home-logo">◆</span>
          <span>Creator Hub</span>
        </div>
        {NAV.map(([key, label]) => (
          <button
            key={key}
            className={`eui-home-navitem ${section === key ? 'on' : ''}`}
            onClick={() => {
              setWorldsFocus(null) // manual nav always lands on the worlds grid
              setSection(key)
            }}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <AccountBadge variant="rail" onAccount={() => setSection('account')} />
      </nav>

      <main className="eui-home-main">
        {section === 'scenes' && (
          <>
            <header className="eui-home-head">
              <div>
                <h1>Your scenes</h1>
                <p>Create, open and manage your Decentraland scenes.</p>
              </div>
              <div className="eui-home-cta">
                <Button variant="ghost" size="md" onClick={() => void shell.pickProject()}>Open existing…</Button>
                <Button variant="primary" size="md" onClick={() => setCreating(true)}>+ New scene</Button>
              </div>
            </header>

            {all.length > 0 && (
              <div className="eui-home-toolbar">
                <SearchField value={search} onChange={setSearch} placeholder="Search scenes…" />
                <span style={{ flex: 1 }} />
                <Select
                  value={sort}
                  onChange={(v) => setSort(v as SortKey)}
                  options={[
                    { value: 'recent', label: 'Last opened' },
                    { value: 'name', label: 'Name' },
                    { value: 'parcels', label: 'Parcels' }
                  ]}
                  aria-label="Sort"
                />
                <Segmented
                  value={view}
                  onChange={(v) => setViewMode(v)}
                  options={[
                    { value: 'grid', label: '▦' },
                    { value: 'list', label: '☰' }
                  ]}
                />
              </div>
            )}

            {favs.length > 0 && (
              <>
                <div className="eui-home-shelf">★ Favourites</div>
                <div className={`eui-scene-grid ${view}`}>{favs.map(card)}</div>
              </>
            )}

            {all.length > 0 && <div className="eui-home-shelf">{favs.length > 0 ? 'Recent' : ''}</div>}
            <div className={`eui-scene-grid ${view}`}>
              <button className="eui-scene-card new" onClick={() => setCreating(true)}>
                <FolderIcon />
                <span>New scene…</span>
              </button>
              {recents.map(card)}
            </div>

            {all.length === 0 && (
              <div className="eui-home-first">
                <FolderIcon />
                <p className="t">Create your first scene</p>
                <p className="s">Start from a template, or open an existing scene folder.</p>
                <div className="eui-home-cta">
                  <Button variant="primary" size="md" onClick={() => setCreating(true)}>+ New scene</Button>
                  <Button variant="ghost" size="md" onClick={() => void shell.pickProject()}>Open existing…</Button>
                </div>
              </div>
            )}
            {q !== '' && sorted.length === 0 && all.length > 0 && (
              <p className="eui-home-empty">No scenes match “{search}”.</p>
            )}
          </>
        )}

        {section === 'settings' && cfg !== null && (
          <>
            <header className="eui-home-head">
              <div>
                <h1>Settings</h1>
                <p>Local stack the app runs for you.</p>
              </div>
            </header>
            <div className="eui-settings">
              {(
                [
                  ['Editor scene', cfg.editorSceneDir],
                  ['Bevy web build', cfg.bevyWebDir],
                  ['Web port', String(cfg.webPort)],
                  ['Scene server port', String(cfg.scenePort)],
                  ['Editor scene port', String(cfg.editorScenePort)]
                ] as Array<[string, string]>
              ).map(([k, v]) => (
                <div key={k} className="eui-settings-row">
                  <span className="eui-settings-key">{k}</span>
                  <span className="eui-settings-val">{v}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'worlds' && (
          <WorldsSection
            key={worldsFocus ?? 'all'}
            projects={cfg?.projects ?? []}
            initialWorld={worldsFocus}
            onOpenScene={(dir) => void shell.openProject(dir)}
            onPublishScene={(p, world) => setPublish({ dir: p.path, title: p.title, world })}
          />
        )}

        {section === 'account' && <AccountSection />}
      </main>

      {creating && (
        <NewSceneModal
          shell={shell}
          onClose={() => setCreating(false)}
          onCreated={(dir) => {
            setCreating(false)
            void shell.openProject(dir)
          }}
        />
      )}
      {publish !== null && (
        <PublishModal
          dir={publish.dir}
          sceneTitle={publish.title}
          currentWorld={publish.world}
          onClose={() => {
            setPublish(null)
            refresh() // the publish wrote worldConfiguration.name — refresh badges
          }}
          onManageWorld={(name) => {
            setPublish(null)
            refresh()
            setWorldsFocus(name)
            setSection('worlds')
          }}
        />
      )}
      {pending !== null && (
        <Toast>
          Removed “{pending.name}”
          <button className="eui-link" onClick={undoRemove}>Undo</button>
        </Toast>
      )}
    </div>
  )
}

// Scene-loading lifecycle: the page lands here (with ?project, no realm) while
// main starts the scene servers. Streams build logs; on servers-ready it mounts
// the editor (iframe in background, engine-init overlay until ready); on error
// it shows the failure + logs instead of a frozen screen.
function SceneLoader(props: { project: string }): JSX.Element {
  const shell = window.editorShell
  const [ready, setReady] = useState<ServersReady | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const pre = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (shell === undefined) return
    const apply = (info: ServersReady): void => {
      // the host page URL has no ?realm — give the data-layer the realm so model
      // import/upload (which write files over the data-layer) can connect
      setDataLayerRealm(info.realm)
      setReady(info)
    }
    void shell.getState().then((s) => setLogs(s.logs.slice(-80)))
    shell.onStackLog((line) => setLogs((prev) => [...prev.slice(-200), line]))
    shell.onServersReady?.(apply)
    shell.onServersError?.((msg) => setError(msg))
    // On a reload the servers are already up but the push won't re-fire — pull
    // the cached payload. Null on first load; the push above delivers it then.
    void shell.requestReady?.().then((info) => {
      if (info !== null && info !== undefined) apply(info)
    })
  }, [])
  useEffect(() => {
    if (pre.current !== null) pre.current.scrollTop = pre.current.scrollHeight
  }, [logs])

  if (ready !== null) {
    const p = new URLSearchParams()
    p.set('realm', ready.realm)
    p.set('systemScene', ready.systemScene)
    p.set('position', ready.position)
    p.set('project', props.project)
    return <Editor params={p} />
  }
  return (
    <div className="eui-loading">
      <div className="eui-loading-card">
        {error === null ? <Spinner size={30} /> : <div className="eui-loading-x">✖</div>}
        <div className="eui-loading-title">
          {error === null ? `Starting ${folderName(props.project)}…` : 'Failed to start the scene'}
        </div>
        <div className="eui-loading-sub">
          {error ?? 'Building the scene and launching the local servers.'}
        </div>
        {error !== null && (
          <pre ref={pre} className="eui-loading-log">
            {logs.length > 0 ? logs.join('\n') : '…'}
          </pre>
        )}
        <button className="eui-btn" onClick={backToProjects}>
          Back to projects
        </button>
      </div>
    </div>
  )
}


function start(): void {
  console.log(`[editor-app] build ${__EDITOR_UI_BUILD__}`)
  ;(window as unknown as Record<string, unknown>).__editorAppBuild = __EDITOR_UI_BUILD__
  // debugging / validation hooks (same contract as the in-page editor)
  ;(window as unknown as Record<string, unknown>).__eui = state
  ;(window as unknown as Record<string, unknown>).__euiCmd = consoleCommand

  const host = document.createElement('div')
  host.id = 'editor-ui-host'
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = collectCss()
  shadow.appendChild(style)

  const rootEl = document.createElement('div')
  rootEl.className = 'eui-root'
  shadow.appendChild(rootEl)

  const params = new URLSearchParams(window.location.search)
  // routing:
  //  ?realm=…      → attach straight to a running stack (browser tab / harness)
  //  ?project=…    → scene-loading lifecycle (electron started the servers)
  //  (none)        → home / project picker
  const root = createRoot(rootEl)
  const view =
    params.has('realm') || params.has('attach') ? (
      <Editor params={params} />
    ) : params.has('project') ? (
      <SceneLoader project={params.get('project') as string} />
    ) : (
      <Picker />
    )
  // TooltipLayer is app-wide: one delegated listener styles every [data-tip] hover.
  root.render(
    <>
      {view}
      <TooltipLayer />
    </>
  )
}

start()
