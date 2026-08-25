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

export interface SceneStatsEntry {
  sceneId: string
  active: boolean
  world?: string
  position?: string
  participants?: number
  latest: {
    receivedAt: string
    windowSeconds?: number
    stats: Partial<Record<string, Record<string, number>>>
  } | null
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

function num(groups: SceneStatsEntry['latest'], group: string, field: string): number {
  const value = groups?.stats[group]?.[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function toRow(entry: SceneStatsEntry): SceneRow {
  const w = entry.latest?.windowSeconds ?? DEFAULT_WINDOW_S
  const rate = (group: string, field: string): number => num(entry.latest, group, field) / w
  return {
    sceneId: entry.sceneId,
    name: entry.world ?? entry.position ?? entry.sceneId,
    active: entry.active,
    participants: entry.participants ?? 0,
    cpuMsPerSec: rate('cpu', 'run_ms'),
    ticksPerSec: rate('cpu', 'ticks'),
    crdtBytesPerSec: rate('crdt', 'bytes'),
    commsMsgsPerSec: rate('comms', 'msgs_out'),
    fetchPerSec: rate('fetch', 'started'),
    fetchFailed: num(entry.latest, 'fetch', 'failed'),
    storagePerSec: rate('storage', 'requests'),
    storageUnauthorized: num(entry.latest, 'storage', 'unauthorized'),
    logLinesPerSec: rate('logs', 'lines'),
    heapUsedBytes: num(entry.latest, 'mem', 'heap_used')
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
