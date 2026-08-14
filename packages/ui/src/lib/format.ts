// Small cross-feature formatting helpers.

export const folderName = (p: string): string => p.replace(/\/+$/, '').split('/').pop() ?? p

// "opened 2h ago" style relative time.
export function relTime(ms?: number): string {
  if (ms === undefined) return ''
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  return new Date(ms).toLocaleDateString()
}

export function formatBytes(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Locale pinned: the app is English-only, and a machine set to de-DE would
// otherwise print "2.772" for two thousand visitors.
const GROUPED = new Intl.NumberFormat('en-US')

// Never compact ("2.77K") — a creator quotes the exact number.
export function formatCount(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return GROUPED.format(n)
}

// Takes a ratio 0–1, as the metrics service reports it. One decimal, not two:
// a small audience cannot support the second.
export function formatPercent1(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

export function formatMinutes(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  return `${(seconds / 60).toFixed(1)} min`
}

export function formatAgo(ts: number | null): string {
  if (ts === null) return ''
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}
