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
import { CSS } from './styles'
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
import { AiPanel, AI_CSS } from './panels/AiPanel'
import { aiStore, toggleAssistant } from './panels/ai-store'
// shared cross-process contracts — single source of truth (also used by desktop)
import type { ServersReady, ProjectInfo, HostState, EditorShell } from '@dcl-editor/contract'

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

const SparkleIcon = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M8 1.5l1.5 4L13.5 7 9.5 8.5 8 12.5 6.5 8.5 2.5 7l4-1.5L8 1.5Z" fill="currentColor" />
    <path d="M12.6 10.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" fill="currentColor" opacity="0.65" />
  </svg>
)

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
      <SceneTopbar logsOpen={logsOpen} onToggleLogs={() => setLogsOpen((v) => !v)} />
      <App />
      <AiPanel />
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
        <div className="eui-loading-spinner" />
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
function SceneTopbar(props: { logsOpen: boolean; onToggleLogs: () => void }): JSX.Element {
  const scene = useStore(() => state.scene)
  const aiOpen = useStore(() => aiStore.open)
  const [menuOpen, setMenuOpen] = useState(false)
  const title = scene?.title ?? scene?.hash ?? 'Loading scene…'
  const home = backToProjects
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
      {/* Assistant toggle — only in the Electron shell, which drives the AI CLI */}
      {window.editorShell?.aiSend !== undefined && (
        <button
          className={`eui-topbar-btn ${aiOpen ? 'on' : ''}`}
          data-tip={aiOpen ? 'Hide assistant' : 'AI assistant'}
          onClick={toggleAssistant}
        >
          <SparkleIcon />
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
              <div className="eui-topbar-menu">
                <button onClick={home}>Back to projects</button>
                <button onClick={() => window.location.reload()}>Reload editor</button>
              </div>
            </>
          )}
        </div>
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

type HomeSection = 'scenes' | 'settings' | 'account'

const folderName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? p

const NAV: Array<[HomeSection, string]> = [
  ['scenes', 'Scenes'],
  ['settings', 'Settings'],
  ['account', 'Account']
]

function SceneCard(props: { p: ProjectInfo; onOpen: () => void }): JSX.Element {
  const { p } = props
  const sub = p.world !== null ? p.world : `${p.parcels} parcel${p.parcels === 1 ? '' : 's'}`
  return (
    <button className="eui-scene-card" onClick={props.onOpen} data-tip={p.path}>
      <div className="eui-scene-thumb">
        {p.thumbnail !== null ? (
          <img src={p.thumbnail} alt="" />
        ) : (
          <div className="eui-scene-thumb-fallback">
            <FolderIcon />
          </div>
        )}
      </div>
      <div className="eui-scene-meta">
        <span className="eui-scene-name">{p.title}</span>
        <span className="eui-scene-sub">{sub}</span>
      </div>
    </button>
  )
}

// Roblox/creator-hub-style home: a left rail (Scenes / Settings / Account) and a
// content area. No logs here — those live in the in-scene Build/Server drawer.
function Picker(): JSX.Element {
  const shell = window.editorShell
  const [cfg, setCfg] = useState<HostState | null>(null)
  const [section, setSection] = useState<HomeSection>('scenes')
  useEffect(() => {
    if (shell === undefined) return
    void shell.getState().then(setCfg)
  }, [])
  if (shell === undefined) {
    return (
      <div className="eui-boot">
        Editor host — pass ?realm=…&systemScene=… to attach to a running stack
      </div>
    )
  }
  const projects = cfg?.projects ?? []
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
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="eui-home-main">
        {section === 'scenes' && (
          <>
            <header className="eui-home-head">
              <div>
                <h1>Your scenes</h1>
                <p>Edit a Decentraland scene in-world — models, gizmos, undo, autosave.</p>
              </div>
              <button className="eui-btn primary" onClick={() => void shell.pickProject()}>
                Open scene folder
              </button>
            </header>
            <div className="eui-scene-grid">
              <button className="eui-scene-card new" onClick={() => void shell.pickProject()}>
                <FolderIcon />
                <span>Open a scene folder…</span>
              </button>
              {projects.map((p) => (
                <SceneCard key={p.path} p={p} onOpen={() => void shell.openProject(p.path)} />
              ))}
            </div>
            {projects.length === 0 && (
              <p className="eui-home-empty">No recent scenes yet — open a folder to start.</p>
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

        {section === 'account' && (
          <>
            <header className="eui-home-head">
              <div>
                <h1>Account</h1>
                <p>Sign-in and wallet for publishing — coming soon.</p>
              </div>
            </header>
            <div className="eui-home-empty">
              Account connection isn't wired up yet. Scenes are edited and saved locally.
            </div>
          </>
        )}
      </main>
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
        {error === null ? <div className="eui-loading-spinner" /> : <div className="eui-loading-x">✖</div>}
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

const PICKER_CSS = `
/* In the host app a 46px topbar sits at the top, so push the editor panels and
   toolbar down to clear it (the in-page editor has no topbar and isn't affected
   — these overrides only ship in the editor-app bundle). */
.eui-left, .eui-right { top: 58px; }
.eui-toolbar { top: 54px; }

/* ---- scene loading / engine-init overlay ---- */
.eui-loading {
  pointer-events: auto;
  position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center;
  background: var(--paper); color: var(--text); font-family: var(--font-family);
}
.eui-loading-card {
  width: min(560px, 86vw); display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 30px; text-align: center;
}
.eui-loading-spinner {
  width: 30px; height: 30px; border-radius: 50%;
  border: 3px solid var(--divider); border-top-color: var(--primary);
  animation: eui-spin 0.85s linear infinite;
}
.eui-loading-x { font-size: 28px; color: var(--error); }
@keyframes eui-spin { to { transform: rotate(360deg); } }
.eui-loading-title { font-size: 17px; font-weight: 600; }
.eui-loading-sub { font-size: 13px; color: var(--text-3); margin-top: -6px; max-width: 440px; }
.eui-loading-log {
  width: 100%; height: 200px; overflow: auto; margin: 6px 0 0; text-align: left;
  background: var(--input); border: 1px solid var(--divider-soft); border-radius: 10px; padding: 10px 12px;
  font: 10.5px/1.5 var(--font-mono, ui-monospace), monospace; color: var(--text-2);
  white-space: pre-wrap; word-break: break-all;
}
.eui-loading .eui-btn {
  background: var(--paper-hi); border: 1px solid var(--divider); color: var(--text-2);
  padding: 8px 16px; border-radius: 8px; cursor: pointer; font: 13px/1 var(--font-family);
}
.eui-loading .eui-btn:hover { color: var(--text); }

/* ---- in-scene topbar ---- */
.eui-topbar {
  pointer-events: auto;
  position: fixed; top: 0; left: 0; right: 0; height: 46px; z-index: 80;
  display: flex; align-items: center; gap: 10px; padding: 0 10px;
  background: linear-gradient(180deg, rgba(20,19,23,0.96), rgba(20,19,23,0.82) 70%, transparent);
  font-family: var(--font-family);
}
.eui-topbar-home, .eui-topbar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--divider);
  background: var(--paper); color: var(--text-2); cursor: pointer;
}
.eui-topbar-home:hover, .eui-topbar-btn:hover { color: var(--text); background: var(--paper-hi); }
.eui-topbar-btn.on { color: var(--primary); border-color: var(--primary-border); background: var(--primary-selected); }
.eui-topbar-title { display: flex; flex-direction: column; line-height: 1.15; }
.eui-topbar-title .eui-overline { font-size: 9px; letter-spacing: .16em; text-transform: uppercase; color: var(--text-3); }
.eui-topbar-title .eui-title { font-size: 14px; font-weight: 600; color: var(--text); }
.eui-topbar-menu-wrap { position: relative; }
.eui-topbar-scrim { position: fixed; inset: 0; z-index: 80; }
.eui-topbar-menu {
  position: absolute; right: 0; top: 38px; z-index: 81; min-width: 180px;
  background: var(--paper-hi); border: 1px solid var(--divider); border-radius: 10px;
  padding: 6px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column;
}
.eui-topbar-menu button {
  text-align: left; background: none; border: 0; color: var(--text-2);
  padding: 8px 10px; border-radius: 7px; cursor: pointer; font: 13px/1 var(--font-family);
}
.eui-topbar-menu button:hover { background: var(--hover); color: var(--text); }

/* ---- home (project picker) ---- */
.eui-home {
  pointer-events: auto;
  position: fixed; inset: 0; display: flex;
  background: var(--paper); color: var(--text);
  font-family: var(--font-family);
}
.eui-home-rail {
  width: 216px; flex: none; display: flex; flex-direction: column; gap: 3px;
  padding: 22px 14px; background: var(--input); border-right: 1px solid var(--divider-soft);
}
.eui-home-brand {
  display: flex; align-items: center; gap: 10px; padding: 4px 10px 22px;
  font-size: 15px; font-weight: 700; letter-spacing: -0.01em; color: var(--text);
}
.eui-home-logo { color: var(--primary); font-size: 15px; }
.eui-home-navitem {
  position: relative; text-align: left; background: none; border: 0; color: var(--text-2);
  padding: 10px 14px; border-radius: 9px; cursor: pointer; font: 600 13.5px/1 var(--font-family);
  transition: background 0.12s, color 0.12s;
}
.eui-home-navitem:hover { background: var(--hover); color: var(--text); }
.eui-home-navitem.on { background: var(--primary-selected); color: var(--text); }
.eui-home-main { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 44px 48px 56px; }
.eui-home-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
.eui-home-head h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 6px; }
.eui-home-head p { color: var(--text-3); margin: 0; font-size: 13.5px; }
.eui-home .eui-btn.primary {
  background: var(--brand); border: 0; color: #fff;
  font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 12px 24px; border-radius: var(--r-pill); cursor: pointer; font-size: var(--fs-sm); white-space: nowrap;
  transition: background-color var(--dur-fast) ease, transform var(--dur-fast) ease;
}
.eui-home .eui-btn.primary:hover { background: var(--brand-hover); }
.eui-home .eui-btn.primary:active { transform: translateY(1px); }
.eui-scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }
.eui-scene-card {
  display: flex; flex-direction: column; text-align: left; padding: 0; gap: 0;
  background: var(--paper-hi); border: 1px solid var(--divider-soft); border-radius: 14px;
  overflow: hidden; cursor: pointer; color: var(--text);
  transition: border-color 0.14s, box-shadow 0.14s, transform 0.08s;
}
.eui-scene-card:hover { border-color: var(--primary-border); box-shadow: 0 10px 30px rgba(0,0,0,0.45); transform: translateY(-2px); }
.eui-scene-card:active { transform: translateY(0); }
.eui-scene-thumb { width: 100%; aspect-ratio: 16 / 10; overflow: hidden; background: var(--input); }
.eui-scene-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.eui-scene-thumb-fallback {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 38%, var(--paper-hi), var(--input)); color: var(--text-3);
}
.eui-scene-meta { padding: 13px 15px 15px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.eui-scene-name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-scene-sub { font-size: 11.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-scene-card.new {
  align-items: center; justify-content: center; gap: 12px;
  border-style: dashed; border-color: var(--divider); color: var(--text-2); background: transparent;
  font-size: 13.5px; font-weight: 500;
}
.eui-scene-card.new:hover { color: var(--text); border-color: var(--primary-border); background: var(--hover); transform: none; box-shadow: none; }
.eui-home-empty { color: var(--text-3); font-size: 13.5px; margin-top: 22px; }
.eui-settings { max-width: 680px; display: flex; flex-direction: column; gap: 1px; background: var(--divider-soft); border: 1px solid var(--divider-soft); border-radius: 12px; overflow: hidden; }
.eui-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 16px; background: var(--paper-hi); }
.eui-settings-key { color: var(--text-2); font-size: 13px; flex: none; }
.eui-settings-val { color: var(--text); font-size: 12px; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eui-logs-toggle { left: 14px; bottom: 14px; position: fixed; z-index: 80; width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--divider); background: var(--paper); color: var(--text-2); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.eui-logs-toggle:hover { color: var(--text); background: var(--paper-hi); }
.eui-logs-drawer {
  pointer-events: auto;
  position: fixed; left: 0; right: 0; bottom: 0; height: 240px;
  display: flex; flex-direction: column; z-index: 79;
  background: hsl(240 6% 8% / 0.97); border-top: 1px solid hsl(240 6% 22%);
}
.eui-logs-tabs {
  display: flex; align-items: center; gap: 4px; padding: 6px 10px;
  border-bottom: 1px solid hsl(240 6% 16%);
}
.eui-logs-tabs button {
  background: none; border: 0; color: hsl(240 5% 55%); cursor: pointer;
  font: 600 11px/1 ui-sans-serif, system-ui, sans-serif;
  padding: 5px 10px; border-radius: 6px;
}
.eui-logs-tabs button.on { background: hsl(240 6% 16%); color: hsl(240 6% 88%); }
.eui-logs-tabs button:hover { color: hsl(240 6% 88%); }
.eui-logs-spacer { flex: 1; }
.eui-logs-body {
  flex: 1; margin: 0; padding: 8px 12px; overflow: auto;
  font: 10.5px/1.5 ui-monospace, monospace;
  color: hsl(240 5% 65%); white-space: pre-wrap; word-break: break-all;
}
`

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
  style.textContent = CSS + PICKER_CSS + AI_CSS
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
