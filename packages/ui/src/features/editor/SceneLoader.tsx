import { useEffect, useRef, useState } from 'react'
import type { ServersReady } from '@dcl-editor/contract'
import { Spinner } from '../../ds'
import { setDataLayerRealm } from '../../datalayer'
import { folderName } from '../../lib/format'
import { backToProjects } from './nav'
import { Editor } from './Editor'

// Scene-loading lifecycle: the page lands here (with ?project, no realm) while
// main starts the scene servers. Streams build logs; on servers-ready it mounts
// the editor (iframe in background, engine-init overlay until ready); on error
// it shows the failure + logs instead of a frozen screen.
export function SceneLoader(props: { project: string }): JSX.Element {
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
