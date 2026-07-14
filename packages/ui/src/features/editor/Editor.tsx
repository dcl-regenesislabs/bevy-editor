// The in-scene editor shell: engine iframe + host chrome (topbar, panels, AI,
// logs). All engine communication goes through the console-command RPC seam.
import { useEffect, useRef, useState } from 'react'
import { App } from '../../App'
import { boot } from '../../boot'
import { useStore } from '../../store'
import { state } from '../../../../scene/src/state'
import { setEngineWindow, engineReady } from '../../console'
import { cmd } from '../../cmd'
import { log } from '../../log'
import { ENGINE_BOOT_WATCHDOG_MS } from '../../config'
import { forwardEngineKeys } from '../../embed'
import { Spinner } from '../../ds'
import { AiPanel, AiFab } from '../../panels/AiPanel'
import { SceneTopbar } from './SceneTopbar'
import { LogsDrawer } from './LogsDrawer'

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
