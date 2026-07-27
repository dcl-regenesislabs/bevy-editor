// Parsing for the multiplayer server's /logs SSE stream (see worlds.ts for the
// transport). Pure so it stays unit-testable — worlds.ts pulls in auth, which
// touches localStorage at import.

export type ServerLogLevel = 'error' | 'warn' | 'debug' | 'info'
export interface ServerLogLine {
  id: number // monotonic per stream — a stable list key
  timestamp: number // epoch ms; receive time when the line carries none
  level: ServerLogLevel
  message: string
  extra?: string // non-standard JSON fields the server attached, serialized
}

const LOG_STANDARD_FIELDS = ['timestamp', 'time', 'level', 'severity', 'message', 'msg']

function normalizeLogLevel(raw: unknown): ServerLogLevel {
  switch (String(raw ?? '').toLowerCase()) {
    case 'error':
      return 'error'
    case 'warn':
    case 'warning':
      return 'warn'
    case 'debug':
      return 'debug'
    default:
      return 'info' // includes 'trace' and anything the server invents
  }
}

// One raw stream line → a ServerLogLine (mirrors the CLI's formatAndPrintLog):
// strip the SSE `data:` framing, JSON-parse, pull timestamp/level/message and
// keep the rest. Non-JSON lines become a plain info message; SSE comments
// (heartbeats) and blanks are dropped.
export function parseServerLogLine(raw: string, id: number, now: number): ServerLogLine | null {
  let line = raw.trim()
  if (line === '' || line.startsWith(':')) return null
  if (line.startsWith('data:')) line = line.slice(5).trim()
  if (line === '') return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line) as Record<string, unknown>
  } catch {
    return { id, timestamp: now, level: 'info', message: line }
  }
  const rawTs = obj.timestamp ?? obj.time
  const parsedTs = typeof rawTs === 'string' || typeof rawTs === 'number' ? new Date(rawTs).getTime() : NaN
  const extra = Object.entries(obj).filter(([key]) => !LOG_STANDARD_FIELDS.includes(key))
  return {
    id,
    timestamp: Number.isNaN(parsedTs) ? now : parsedTs,
    level: normalizeLogLevel(obj.level ?? obj.severity),
    message: String(obj.message ?? obj.msg ?? JSON.stringify(obj)),
    extra: extra.length > 0 ? JSON.stringify(Object.fromEntries(extra)) : undefined
  }
}
