import { useEffect, useRef, useState } from 'react'
import { cmd } from '../../cmd'

// Bottom-docked log drawer: the inspected scene's own console output (what the
// scene prints while running), plus the local stack's server output when the
// electron shell is present. Open/close is owned by Editor and toggled from the
// topbar — no floating button.
export function LogsDrawer(props: { open: boolean; onClose: () => void }): JSX.Element | null {
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
