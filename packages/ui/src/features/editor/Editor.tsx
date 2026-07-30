// The in-scene editor shell: engine iframe + host chrome (topbar, panels, AI,
// logs). All engine communication goes through the console-command RPC seam.
import { useEffect, useRef, useState } from 'react'
import { App } from '../../App'
import { boot } from '../../boot'
import { setLaunchParams } from '../../launch-params'
import { useStore } from '../../store'
import { state } from '../../../../scene/src/state'
import { setEngineWindow, engineReady } from '../../console'
import { cmd } from '../../cmd'
import { log } from '../../log'
import { ENGINE_BOOT_WATCHDOG_MS, INSPECTOR_STALL_MS, SLOW_BOOT_HINT_MS } from '../../config'
import { forwardEngineKeys } from '../../embed'
import { Spinner } from '../../ds'
import { AiPanel, AiFab } from '../../panels/AiPanel'
import { backToProjects } from './nav'
import { SceneTopbar } from './SceneTopbar'
import { LogsDrawer } from './LogsDrawer'
import { stripAnsi, useSceneHealth, errorLocation, type SceneHealth } from './scene-health'
import { openCodeAt } from '../../panels/ai-store'
import { baseName } from '../../script/project-files'
import { chrome, toggleUiHidden } from '../../chrome'

export function engineUrl(params: URLSearchParams): string {
  const q = new URLSearchParams()
  q.set('position', params.get('position') ?? '0,0')
  q.set('systemScene', params.get('systemScene') ?? 'http://localhost:8005')
  q.set('realm', params.get('realm') ?? 'http://localhost:8004')
  return `/engine.html?${q}`
}

export function Editor(props: { params: URLSearchParams }): JSX.Element {
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
      // the host page URL carries only ?project — hand the launch params over
      // explicitly so boot can find the scene's parcel and spawn point
      setLaunchParams(props.params)
      void boot()
    }
    wire()
    // The iframe REPLACES its contentWindow when it navigates to engine.html, so
    // the listeners wired above end up on a window nobody types into — which is
    // why viewport-focused shortcuts silently did nothing and the toolbar had to
    // be clicked first. Re-wire on every load; both calls are idempotent.
    iframe.addEventListener('load', () => {
      if (iframe.contentWindow === null) return
      setEngineWindow(iframe.contentWindow)
      forwardEngineKeys(iframe.contentWindow)
    })
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
  // Fallback: some scenes never let the INSPECTOR reach ready (a very heavy
  // scene, or one whose engine CRDT channel wedges so /crdt_snapshot hangs). The
  // engine itself is still rendering underneath, so after a grace period reveal
  // the live view instead of a permanent "Loading scene…" — with a notice that
  // the entity tools couldn't load for this scene.
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (ready) {
      setStalled(false)
      return
    }
    const t = setTimeout(() => setStalled(true), INSPECTOR_STALL_MS)
    return () => clearTimeout(t)
  }, [ready])
  // A known code error trumps every generic loading state: the spinner would
  // promise progress that can't happen, and the stall notice blames the wrong
  // thing ("engine channel") when the creator's own file is what's broken.
  const health = useSceneHealth()
  // The editor scene's attach sequence (login → resolve → snapshot) is one-shot
  // and its deadlines burn away while the creator's code is broken — once the
  // fix compiles, the scene comes back but the editor tools never re-attach.
  // A clean fixed-it transition while not attached gets one full editor reload:
  // a fresh boot against a healthy scene, the path that always works. Ready
  // editors are exempt (never yank a working session), and a reload can only
  // repeat if the creator breaks and fixes the code again.
  const prevHealth = useRef<SceneHealth | null>(health)
  useEffect(() => {
    const wasBroken = prevHealth.current !== null
    prevHealth.current = health
    if (!wasBroken || health !== null || ready) return
    const t = setTimeout(() => window.location.reload(), 2000) // let the rebuilt scene spin up first
    return () => clearTimeout(t)
  }, [health, ready])
  // Has this session ever been up? A crash at RUNTIME (a typo that compiles but
  // throws) flips `ready` back to false, which used to drop a working session
  // into the full-screen error page — taking away the editor the creator needs
  // to fix the typo. The overlay is for a scene that never opened; once you've
  // been editing, a code error is a banner over the editor you already have.
  const [everReady, setEverReady] = useState(false)
  useEffect(() => {
    if (ready) setEverReady(true)
  }, [ready])
  const uiHidden = useStore(() => chrome.uiHidden)
  const booting = !ready && !everReady
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
      {booting && health !== null ? (
        <SceneCodeErrorOverlay health={health} project={props.params.get('project')} />
      ) : (
        <>
          {booting && !stalled && <EngineInitOverlay />}
          {booting && stalled && <InspectorStallNotice onLogs={() => setLogsOpen(true)} />}
        </>
      )}
      {everReady && health !== null && <SceneHealthBanner health={health} onLogs={() => setLogsOpen(true)} />}
      {!uiHidden && (
        <>
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
      )}
      {uiHidden && (
        <button className="eui-ui-restore" onClick={toggleUiHidden}>
          Press <kbd>.</kbd> to show the editor
        </button>
      )}
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
  // them once the scene errors, and also after a few quiet seconds: a scene whose
  // code crashed looks exactly like a slow one until the inspector's 90s deadline,
  // and the logs are what say which it is.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_BOOT_HINT_MS)
    return () => clearTimeout(t)
  }, [])
  const showLogs = status === 'error' || status === 'scene-broken' || slow
  return (
    <div className="eui-loading">
      <div className="eui-loading-card">
        <Spinner size={30} />
        <div className="eui-loading-title">{statusLabel()}</div>
        {showLogs && (
          <pre ref={pre} className="eui-loading-log">
            {logs.length > 0 ? logs.map(stripAnsi).join('\n') : '…'}
          </pre>
        )}
        {/* This overlay covers the topbar, so without its own exit a scene that
            never finishes loading can only be escaped by quitting the app. */}
        <button className="eui-btn" onClick={backToProjects}>
          Back to projects
        </button>
      </div>
    </div>
  )
}

// The creator's own code is broken (TS error or a crash at load) — the scene
// cannot load until they fix it, so say exactly that, with the compiler's own
// error lines. No spinner: nothing is in progress. The dev server rebuilds and
// the engine hot-reloads on save, so recovery is automatic — scene-health
// clears and the normal loading flow resumes on its own.
function SceneCodeErrorOverlay(props: { health: SceneHealth; project: string | null }): JSX.Element {
  return (
    <div className="eui-loading">
      <div className="eui-loading-card">
        <div className="eui-loading-x">✕</div>
        <div className="eui-loading-title">
          {props.health.kind === 'build' ? 'Your scene has a code error' : 'Your scene’s code crashed'}
        </div>
        <div className="eui-loading-sub">
          Fix the file and save — the scene rebuilds and loads again automatically.
        </div>
        <pre className="eui-loading-log err">{props.health.lines.join('\n')}</pre>
        {/* manual backstop for when the automatic path doesn't fire (older
            scene toolchains whose dev server died with the error) */}
        {props.project !== null && window.editorShell !== undefined && (
          <button className="eui-btn" onClick={() => void window.editorShell?.openProject(props.project as string)}>
            Try again
          </button>
        )}
        <button className="eui-btn" onClick={backToProjects}>
          Back to projects
        </button>
      </div>
    </div>
  )
}

// The scene broke while the editor was open (a save introduced a TS error, or
// the reloaded bundle crashed). Editing still works — the editor operates on
// the frozen snapshot — so this is a banner, not an overlay: say what broke,
// link the logs, and let scene-health clear it when the fix compiles. The
// health object's identity is stable for identical errors, so a dismissal
// naturally holds until a different error appears.
function SceneHealthBanner(props: { health: SceneHealth; onLogs: () => void }): JSX.Element | null {
  const [dismissed, setDismissed] = useState<SceneHealth | null>(null)
  if (dismissed === props.health) return null
  const where = errorLocation(props.health)
  return (
    <div className="eui-stall-notice bottom">
      <span className="ic">✖</span>
      <div className="msg">
        <b>{props.health.kind === 'build' ? 'Your scene has a code error.' : 'Your scene’s code crashed.'}</b>
        <span>
          {props.health.lines[0]}
          {' — '}
          {props.health.kind === 'build'
            ? 'the running scene keeps the last working build until you fix it.'
            : 'fix the file and save — the scene reloads automatically.'}
        </span>
      </div>
      {where !== null && window.editorShell !== undefined && (
        <button className="eui-link" onClick={() => openCodeAt(where.path, where.line)}>
          {baseName(where.path)}:{where.line}
        </button>
      )}
      <button className="eui-link" onClick={props.onLogs}>View logs</button>
      <button className="eui-stall-x" onClick={() => setDismissed(props.health)} data-tip="Dismiss">✕</button>
    </div>
  )
}

// Non-blocking banner shown when the inspector stalled but the engine view was
// revealed anyway — explains the empty panels and links to the logs.
function InspectorStallNotice(props: { onLogs: () => void }): JSX.Element {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return <></>
  return (
    <div className="eui-stall-notice">
      <span className="ic">⚠</span>
      <div className="msg">
        <b>Editor tools couldn’t load for this scene.</b>
        <span>The live view is shown, but the hierarchy and inspector didn’t attach. Reloading the editor usually fixes this.</span>
      </div>
      <button className="eui-link" onClick={() => window.location.reload()}>Reload editor</button>
      <button className="eui-link" onClick={props.onLogs}>View logs</button>
      <button className="eui-stall-x" onClick={() => setDismissed(true)} data-tip="Dismiss">✕</button>
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
    case 'scene-broken':
      return 'This scene’s code crashed — see the logs below'
    default:
      return 'Starting engine…'
  }
}
