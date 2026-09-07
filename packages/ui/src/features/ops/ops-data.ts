// Pure data layer for the hidden operator dashboard (?ops): shapes the
// multiplayer-server admin stats API response for rendering (fetching lives in
// OpsDashboard). Metrics only — scene logs are creators-only by policy.
interface ProcessSample {
  cpuPercent: number
  rssBytes: number
}

export interface EngineInfo {
  engine?: ProcessSample
  sidecar?: ProcessSample
  scenes?: number
}

export interface SceneSnapshot {
  receivedAt: string
  windowSeconds?: number
  stats: Partial<Record<string, Record<string, number>>>
}

export interface SceneStatsEntry {
  sceneId: string
  active: boolean
  world?: string
  position?: string
  participants?: number
  latest: SceneSnapshot | null
  // only when the server supports ?history=1; absent on older deploys, so the
  // charts fall back to client-side accumulation alone
  history?: SceneSnapshot[]
}

export interface DebugStats {
  scenes: SceneStatsEntry[]
  engine: EngineInfo | null
}

export interface SceneRow {
  sceneId: string
  name: string
  active: boolean
  participants: number
  // per-second rates over the scene's own reporting window
  cpuMsPerSec: number
  ticksPerSec: number
  crdtBytesPerSec: number
  commsMsgsPerSec: number
  fetchPerSec: number
  fetchFailed: number
  storagePerSec: number
  storageUnauthorized: number
  logLinesPerSec: number
  heapUsedBytes: number
}

const DEFAULT_WINDOW_S = 10

function num(snap: SceneSnapshot | null, group: string, field: string): number {
  const value = snap?.stats[group]?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// The charted metrics. participants is null when the sample came from server
// history (snapshots carry engine stats only, not room membership) — the
// Players chart draws a hole there instead of a fake zero.
export type MetricKey =
  | 'cpuMsPerSec'
  | 'ticksPerSec'
  | 'crdtBytesPerSec'
  | 'commsMsgsPerSec'
  | 'fetchPerSec'
  | 'storagePerSec'
  | 'logLinesPerSec'
  | 'heapUsedBytes'
  | 'participants'

export type SceneMetrics = Record<MetricKey, number | null>

export function snapshotMetrics(snap: SceneSnapshot, participants: number | null): SceneMetrics {
  // a 0 or non-finite window (first/partial aggregation) would divide to Infinity
  const raw = snap.windowSeconds
  const w = raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_WINDOW_S
  const rate = (group: string, field: string): number => num(snap, group, field) / w
  return {
    cpuMsPerSec: rate('cpu', 'run_ms'),
    ticksPerSec: rate('cpu', 'ticks'),
    crdtBytesPerSec: rate('crdt', 'bytes'),
    commsMsgsPerSec: rate('comms', 'msgs_out'),
    fetchPerSec: rate('fetch', 'started'),
    storagePerSec: rate('storage', 'requests'),
    logLinesPerSec: rate('logs', 'lines'),
    heapUsedBytes: num(snap, 'mem', 'heap_used'),
    participants
  }
}

export function toRow(entry: SceneStatsEntry): SceneRow {
  const m = entry.latest === null ? null : snapshotMetrics(entry.latest, null)
  return {
    sceneId: entry.sceneId,
    name: entry.world ?? entry.position ?? entry.sceneId,
    active: entry.active,
    participants: entry.participants ?? 0,
    cpuMsPerSec: m?.cpuMsPerSec ?? 0,
    ticksPerSec: m?.ticksPerSec ?? 0,
    crdtBytesPerSec: m?.crdtBytesPerSec ?? 0,
    commsMsgsPerSec: m?.commsMsgsPerSec ?? 0,
    fetchPerSec: m?.fetchPerSec ?? 0,
    fetchFailed: num(entry.latest, 'fetch', 'failed'),
    storagePerSec: m?.storagePerSec ?? 0,
    storageUnauthorized: num(entry.latest, 'storage', 'unauthorized'),
    logLinesPerSec: m?.logLinesPerSec ?? 0,
    heapUsedBytes: m?.heapUsedBytes ?? 0
  }
}

// busiest scenes first, dead-but-retained ones last. A world that redeploys
// mints a new sceneId while the old one lingers in 24h retention — same name
// twice — so colliding names get their entity-hash tail appended.
export function toRows(stats: DebugStats): SceneRow[] {
  const rows = stats.scenes
    .map(toRow)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.cpuMsPerSec - a.cpuMsPerSec)
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1)
  for (const row of rows) {
    if ((counts.get(row.name) ?? 0) > 1) row.name = `${row.name} · ${row.sceneId.slice(-6)}`
  }
  return rows
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

export function formatRate(value: number): string {
  if (value === 0) return '0'
  if (value >= 100) return String(Math.round(value))
  if (value >= 1) return value.toFixed(1)
  return value.toFixed(2)
}

// The drill-down chart catalog: one chart per metric, in this order.
export const METRIC_CHARTS: ReadonlyArray<{ key: MetricKey; label: string; format: (v: number) => string }> = [
  { key: 'cpuMsPerSec', label: 'CPU ms/s', format: formatRate },
  { key: 'ticksPerSec', label: 'Ticks/s', format: formatRate },
  { key: 'crdtBytesPerSec', label: 'CRDT/s', format: formatBytes },
  { key: 'commsMsgsPerSec', label: 'Comms msgs/s', format: formatRate },
  { key: 'fetchPerSec', label: 'Fetch req/s', format: formatRate },
  { key: 'storagePerSec', label: 'Storage req/s', format: formatRate },
  { key: 'logLinesPerSec', label: 'Log lines/s', format: formatRate },
  { key: 'heapUsedBytes', label: 'Heap', format: formatBytes },
  { key: 'participants', label: 'Players', format: (v) => String(Math.round(v)) }
]
