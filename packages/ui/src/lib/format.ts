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
