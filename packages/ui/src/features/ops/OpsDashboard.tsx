// Hidden operator dashboard (?ops): live per-scene resource stats for the
// multiplayer-server fleet. Reached only by URL param — no nav entry. Requires
// a wallet in the server's ADMINS list; env follows the account zone/prod switch.
import { useEffect, useState } from 'react'
import { registerCss } from '../../ds/styles/registry'
import { Segmented } from '../../ds'
import { PanelState } from '../../ds/PanelState'
import { multiplayerServerFor } from '../worlds/endpoints'
import { signedFetch } from '../worlds/signed-fetch'
import { DebugStats, formatBytes, formatRate, toRows } from './ops-data'
import css from './ops.css?inline'

registerCss('feature/ops', 'features', css)

const POLL_MS = 10_000

type OpsEnv = 'org' | 'zone'
const ENV_OPTIONS: ReadonlyArray<{ value: OpsEnv; label: string }> = [
  { value: 'org', label: 'org' },
  { value: 'zone', label: 'zone' }
]

async function fetchDebugStats(env: OpsEnv): Promise<DebugStats> {
  const res = await signedFetch(`${multiplayerServerFor(env)}/debug/stats`, { method: 'GET' })
  if (!res.ok) {
    // 403 = signature valid but the wallet isn't in the server's ADMINS (env not
    // deployed yet?); 401 = the signed request itself was rejected
    if (res.status === 403) throw new Error('Wallet not in the server ADMINS list (403)')
    if (res.status === 401) throw new Error('Signed request rejected (401)')
    throw new Error(`HTTP ${res.status}`)
  }
  return (await res.json()) as DebugStats
}

export function OpsDashboard(): JSX.Element {
  const [stats, setStats] = useState<DebugStats | undefined>(undefined)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  // dashboard-local: which fleet to query, independent of the app's auth env
  const [env, setEnv] = useState<OpsEnv>('org')

  useEffect(() => {
    let cancelled = false
    fetchDebugStats(env)
      .then((next) => {
        if (cancelled) return
        setStats(next)
        setErr(null)
      })
      .catch((error: Error) => {
        if (!cancelled) setErr(error.message)
      })
    const timer = setTimeout(() => setTick((t) => t + 1), POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tick, env])

  const rows = stats ? toRows(stats) : []
  const engine = stats?.engine
  const totalParticipants = rows.reduce((sum, row) => sum + row.participants, 0)

  return (
    <div className="eui-ops">
      <header className="eui-ops-header">
        <h1>Scene servers</h1>
        <Segmented
          value={env}
          options={ENV_OPTIONS}
          onChange={(next) => {
            setStats(undefined)
            setErr(null)
            setEnv(next)
          }}
          aria-label="Environment"
        />
        <span className="eui-ops-endpoint">{multiplayerServerFor(env)}</span>
      </header>
      <PanelState err={err} onRetry={() => setTick((t) => t + 1)} loading={stats === undefined && err === null} />
      {stats !== undefined && (
        <>
          <div className="eui-ops-tiles">
            <Tile label="Scenes" value={String(engine?.scenes ?? rows.filter((r) => r.active).length)} />
            <Tile label="Players" value={String(totalParticipants)} />
            <Tile
              label="Engine CPU"
              value={engine?.engine ? `${Math.round(engine.engine.cpuPercent)}%` : '—'}
              hint={engine?.sidecar ? `sidecar ${Math.round(engine.sidecar.cpuPercent)}%` : undefined}
            />
            <Tile
              label="Engine RSS"
              value={engine?.engine ? formatBytes(engine.engine.rssBytes) : '—'}
              hint={engine?.sidecar ? `sidecar ${formatBytes(engine.sidecar.rssBytes)}` : undefined}
            />
          </div>
          <table className="eui-ops-table">
            <thead>
              <tr>
                <th>Scene</th>
                <th>Players</th>
                <th>CPU ms/s</th>
                <th>Ticks/s</th>
                <th>CRDT/s</th>
                <th>Comms/s</th>
                <th>Fetch/s</th>
                <th>Storage/s</th>
                <th>Logs/s</th>
                <th>Heap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sceneId} className={row.active ? '' : 'eui-ops-dead'}>
                  <td title={row.sceneId}>
                    <span className={`eui-ops-dot ${row.active ? 'on' : ''}`} />
                    {row.name}
                  </td>
                  <td>{row.participants}</td>
                  <td>{formatRate(row.cpuMsPerSec)}</td>
                  <td>{formatRate(row.ticksPerSec)}</td>
                  <td>{formatBytes(row.crdtBytesPerSec)}</td>
                  <td>{formatRate(row.commsMsgsPerSec)}</td>
                  <td className={row.fetchFailed > 0 ? 'eui-ops-warn' : ''}>{formatRate(row.fetchPerSec)}</td>
                  <td className={row.storageUnauthorized > 0 ? 'eui-ops-warn' : ''}>{formatRate(row.storagePerSec)}</td>
                  <td>{formatRate(row.logLinesPerSec)}</td>
                  <td>{formatBytes(row.heapUsedBytes)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="eui-ops-empty">
                    No scenes reporting
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function Tile(props: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="eui-ops-tile">
      <span className="eui-ops-tile-label">{props.label}</span>
      <span className="eui-ops-tile-value">{props.value}</span>
      {props.hint !== undefined && <span className="eui-ops-tile-hint">{props.hint}</span>}
    </div>
  )
}
