// Live tail of the world's server-side runtime output — the multiplayer-server
// process running the scene's server code. In-app counterpart of
// `sdk-commands sdk-server-logs`; the stream opens only on an explicit Connect
// so we never hold an SSE connection the user isn't watching.
import { memo, useEffect, useRef, useState } from 'react'
import { Button, Spinner } from '../../ds'
import { streamServerLogs, type ServerLogLine } from './logs'
import { type WorldDeployment } from './inventory'
import { PublishFirst } from './common'

const MAX_LINES = 500

type StreamStatus = 'connecting' | 'streaming' | 'error'

// Owns the stream lifecycle: opens while mounted, tears down on unmount,
// accumulates a bounded buffer. Lines are batched per animation frame so a
// chatty server doesn't trigger a setState per line.
function useServerLogs(world: string, parcel: string): {
  status: StreamStatus
  error: string | null
  lines: ServerLogLine[]
  clear: () => void
  reconnect: () => void
} {
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<ServerLogLine[]>([])
  const [attempt, setAttempt] = useState(0)
  const pending = useRef<ServerLogLine[]>([])
  const flushFrame = useRef<number | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let live = true
    setStatus('connecting')
    setError(null)
    const flush = (): void => {
      flushFrame.current = null
      if (pending.current.length === 0) return
      const incoming = pending.current
      pending.current = []
      setLines((prev) => {
        const next = prev.concat(incoming)
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
    }
    streamServerLogs({
      world,
      parcel,
      signal: controller.signal,
      onOpen: () => {
        if (live) setStatus('streaming')
      },
      onLine: (line) => {
        pending.current.push(line)
        if (flushFrame.current === null) flushFrame.current = requestAnimationFrame(flush)
      }
    })
      .then(() => {
        // natural end (server closed / retention expired) → reconnectable state
        if (live) setStatus('error')
      })
      .catch((e: unknown) => {
        if (!live || controller.signal.aborted) return
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      live = false
      controller.abort()
      if (flushFrame.current !== null) cancelAnimationFrame(flushFrame.current)
      flushFrame.current = null
      pending.current = []
    }
  }, [world, parcel, attempt])
  return {
    status,
    error,
    lines,
    clear: () => setLines([]),
    reconnect: () => setAttempt((v) => v + 1)
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false })
}

function statusLabel(status: StreamStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting…'
    case 'streaming':
      return 'Live'
    case 'error':
      return 'Disconnected'
  }
}

// What the console shows before the first line arrives.
function EmptyConsole(props: { status: StreamStatus; error: string | null }): JSX.Element {
  switch (props.status) {
    case 'connecting':
      return (
        <div className="eui-srvlog-center">
          <Spinner size={20} />
          <span>Connecting to the server…</span>
        </div>
      )
    case 'streaming':
      return (
        <div className="eui-srvlog-center">
          <span>Waiting for output — logs appear when the server prints something.</span>
        </div>
      )
    case 'error':
      return (
        <div className="eui-srvlog-center">
          <span>{props.error ?? 'The stream ended — reconnect to keep watching.'}</span>
        </div>
      )
  }
}

const LogRow = memo(function LogRow(props: { line: ServerLogLine }): JSX.Element {
  const { line } = props
  return (
    <div className="eui-srvlog-row">
      <span className="tm">{formatTime(line.timestamp)}</span>
      <span className={`lv ${line.level}`}>{line.level}</span>
      <span className="msg">
        {line.message}
        {line.extra !== undefined && <span className="ex"> {line.extra}</span>}
      </span>
    </div>
  )
})

function LogConsole(props: { world: string; parcel: string; onStop: () => void }): JSX.Element {
  const { status, error, lines, clear, reconnect } = useServerLogs(props.world, props.parcel)
  const pre = useRef<HTMLDivElement>(null)
  // pin to the bottom as new lines arrive (a live tail)
  useEffect(() => {
    if (pre.current !== null) pre.current.scrollTop = pre.current.scrollHeight
  }, [lines])
  return (
    <>
      <div className="eui-srvlog-bar">
        <span className={`eui-srvlog-chip ${status}`}>{statusLabel(status)}</span>
        <span style={{ flex: 1 }} />
        {status === 'error' && (
          <Button variant="ghost" size="sm" onClick={reconnect}>Reconnect</Button>
        )}
        <Button variant="ghost" size="sm" disabled={lines.length === 0} onClick={clear}>Clear</Button>
        <Button variant="ghost" size="sm" onClick={props.onStop}>Stop</Button>
      </div>
      <div ref={pre} className="eui-srvlog-console">
        {lines.length === 0 ? (
          <EmptyConsole status={status} error={error} />
        ) : (
          lines.map((line) => <LogRow key={line.id} line={line} />)
        )}
      </div>
      {lines.length > 0 && error !== null && <p className="eui-perm-err">{error}</p>}
    </>
  )
}

export function LogsTab(props: { realm: string; d: WorldDeployment | null }): JSX.Element {
  const [started, setStarted] = useState(false)
  if (props.d === null) return <PublishFirst what="Server logs" />
  if (!props.d.authoritativeMultiplayer) {
    return (
      <section className="eui-world-block">
        <h2>Server logs</h2>
        <p className="eui-world-hint">
          Server logs are available for scenes running server-authoritative multiplayer — set
          {' '}<code>"authoritativeMultiplayer": true</code> in the scene's scene.json and publish again.
        </p>
      </section>
    )
  }
  return (
    <section className="eui-world-block eui-srvlog">
      <div className="eui-world-subtabs">
        <h2>Server logs</h2>
      </div>
      <p className="eui-world-hint">
        Real-time output of the server process running this scene's code. The process only runs while
        players are in the world.
      </p>
      {started ? (
        <LogConsole world={props.realm} parcel={props.d.base ?? '0,0'} onStop={() => setStarted(false)} />
      ) : (
        <div className="eui-srvlog-console">
          <div className="eui-srvlog-center">
            <span>Not connected.</span>
            <Button size="sm" onClick={() => setStarted(true)}>Connect</Button>
          </div>
        </div>
      )}
    </section>
  )
}
