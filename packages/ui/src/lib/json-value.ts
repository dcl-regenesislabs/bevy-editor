// Pure helpers for the server-storage value manager: rendering a value's shape
// and parsing creator input. Kept dependency-free so the display/parse rules
// are unit-tested (StorageTab.tsx, a .tsx, can't run in the node test env).

export const prettyJson = (v: unknown): string => JSON.stringify(v, null, 2) ?? ''
export const inlineJson = (v: unknown): string => JSON.stringify(v) ?? ''

// what a value "is", at a glance
export function valueHint(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `array · ${v.length} item${v.length === 1 ? '' : 's'}`
  if (typeof v === 'object') return `object · ${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`
  if (typeof v === 'string') return `text · ${v.length} chars`
  return typeof v
}

// Parse creator input leniently: valid JSON is taken as JSON, anything else is
// stored as a plain string — so `hello` works without quotes but `{"a":1}`
// still becomes an object.
export function parseLoose(input: string): unknown {
  const t = input.trim()
  if (t === '') return ''
  try {
    return JSON.parse(t)
  } catch {
    return input
  }
}
