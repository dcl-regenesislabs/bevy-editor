import { useEffect, useRef, useState } from 'react'
import { cmd } from '../../engine/cmd'
import { BUILD_TAB_EMPTY, GAME_TAB_EMPTY, GAME_TAB_TIP, gameTabLines, lastSeconds, type RelayedLine } from './log-roles'
import { stripAnsi } from './scene-health'

// Bottom-docked log drawer: the inspected scene's own console output (what the
// scene prints while running) and the shared copy's lines lifted out of the
// build stream, plus the local stack's server output when the electron shell is
// present. Open/close is owned by Editor and toggled from the topbar — no
// floating button.
//
// The scene tab is called Game because that is what its lines are about, and
// each one shows which copy of the scene printed it (log-roles.ts). `initialTab`
// is where an opening lands — the Game strip's Logs button asks for Game; an
// opening that asks for nothing keeps the tab the creator last chose. `openKey`
// counts the openings, so asking for the same tab twice still lands there: the
// creator who clicks Logs, browses Build, then clicks Logs again means it.
export type LogsTab = 'scene' | 'server'

// One line per relayed entry, so this is a line count — it used to be a chunk
// count, which made the visible backlog a fraction of what it reads as. Matches
// the shell's own cap (main.ts) so the drawer never throws away history the
// shell still holds. See log-roles.ts for why each entry keeps its arrival time.
const MAX_SHELL_LINES = 4000

interface ShellLine {
  text: string
  /** wall-clock arrival, or null for the backlog that predates this drawer */
  ms: number | null
}

export function LogsDrawer(props: {
  open: boolean
  onClose: () => void
  initialTab?: LogsTab
  openKey?: number
}): JSX.Element | null {
  const shell = window.editorShell
  const { open, onClose, initialTab, openKey } = props
  const [tab, setTab] = useState<LogsTab>(initialTab ?? (shell !== undefined ? 'server' : 'scene'))
  const [serverLogs, setServerLogs] = useState<ShellLine[]>([])
  const [sceneLogs, setSceneLogs] = useState('')
  const pre = useRef<HTMLPreElement>(null)
  const sceneEpochMs = useRef<number | null>(null)
  useEffect(() => {
    if (shell === undefined) return
    void shell.getState().then((s) => setServerLogs(s.logs.map((text) => ({ text, ms: null }))))
    shell.onStackLog((line) =>
      setServerLogs((prev) => [...prev.slice(-MAX_SHELL_LINES), { text: line, ms: Date.now() }])
    )
  }, [])
  useEffect(() => {
    if (open && initialTab !== undefined) setTab(initialTab)
  }, [open, openKey, initialTab])
  useEffect(() => {
    if (!open || tab !== 'scene') return
    let live = true
    const poll = async (): Promise<void> => {
      try {
        const reply = await cmd.sceneLogs(200)
        if (!live) return
        const seconds = lastSeconds(reply)
        if (seconds !== null) sceneEpochMs.current = Date.now() - seconds * 1000
        setSceneLogs(reply)
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
  const epoch = sceneEpochMs.current
  const relayed: RelayedLine[] = serverLogs.map((line) => ({
    text: line.text,
    at: line.ms === null || epoch === null ? null : (line.ms - epoch) / 1000
  }))
  const rows = tab === 'scene' ? gameTabLines(sceneLogs, relayed) : []
  const quiet = !rows.some((row) => row.role !== null || row.text.trim() !== '')
  return (
    <div className="eui-logs-drawer">
      <div className="eui-logs-tabs">
        {shell !== undefined && (
          <button className={tab === 'server' ? 'on' : ''} onClick={() => setTab('server')}>
            Build
          </button>
        )}
        <button className={tab === 'scene' ? 'on' : ''} onClick={() => setTab('scene')} data-tip={GAME_TAB_TIP}>
          Game
        </button>
        <span className="eui-logs-spacer" />
        <button onClick={onClose} data-tip="Hide logs">
          ✕
        </button>
      </div>
      <pre ref={pre} className="eui-logs-body">
        {tab === 'scene' ? (
          quiet ? (
            GAME_TAB_EMPTY
          ) : (
            <>
              {rows.map((line, i) => (
                <span key={i} className={line.error ? 'eui-logs-line error' : 'eui-logs-line'}>
                  {line.role !== null && <span className={`eui-logs-role ${line.role}`}>[{line.role}]</span>}
                  {line.text}
                  {'\n'}
                </span>
              ))}
            </>
          )
        ) : serverLogs.length > 0 ? (
          serverLogs.map((line) => stripAnsi(line.text)).join('\n')
        ) : (
          BUILD_TAB_EMPTY
        )}
      </pre>
    </div>
  )
}
