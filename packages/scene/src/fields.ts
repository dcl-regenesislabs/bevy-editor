import { state, type ComponentKey } from './state'

// A leaf's edit key: `${componentKey}::${dotPath}`. Root value has path ''.
export function fieldKey(componentKey: ComponentKey, path: string): string {
  return `${componentKey}::${path}`
}

export function joinPath(path: string, seg: string | number): string {
  return path === '' ? String(seg) : `${path}.${seg}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keysSubsetOf(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(value)
  return (
    keys.length > 0 &&
    keys.every((k) => allowed.includes(k) && typeof value[k] === 'number')
  )
}

// { r, g, b } or { r, g, b, a } of numbers.
export function isColor(value: unknown): value is { r: number; g: number; b: number; a?: number } {
  return (
    isRecord(value) &&
    'r' in value &&
    'g' in value &&
    'b' in value &&
    keysSubsetOf(value, ['r', 'g', 'b', 'a'])
  )
}

// { x, y }, { x, y, z } or { x, y, z, w } of numbers.
export function isVector(value: unknown): boolean {
  return (
    isRecord(value) &&
    'x' in value &&
    'y' in value &&
    keysSubsetOf(value, ['x', 'y', 'z', 'w'])
  )
}

// Current edited values, falling back to the snapshot leaf when untouched.
export function currentNumberText(
  componentKey: ComponentKey,
  path: string,
  fallback: number
): string {
  const edit = state.fieldEdits.get(fieldKey(componentKey, path))
  return typeof edit === 'string' ? edit : String(fallback)
}

export function currentNumber(
  componentKey: ComponentKey,
  path: string,
  fallback: number
): number {
  const parsed = parseFloat(currentNumberText(componentKey, path, fallback))
  return Number.isNaN(parsed) ? fallback : parsed
}

export function currentBool(
  componentKey: ComponentKey,
  path: string,
  fallback: boolean
): boolean {
  const edit = state.fieldEdits.get(fieldKey(componentKey, path))
  return typeof edit === 'boolean' ? edit : fallback
}

export function currentString(
  componentKey: ComponentKey,
  path: string,
  fallback: string
): string {
  const edit = state.fieldEdits.get(fieldKey(componentKey, path))
  return typeof edit === 'string' ? edit : fallback
}

export function setField(
  componentKey: ComponentKey,
  path: string,
  value: string | boolean
): void {
  state.fieldEdits.set(fieldKey(componentKey, path), value)
  state.editStatus.delete(componentKey)
}

// The leaf's re-mount revision (see state.fieldRev). Part of the Input's key so a
// programmatic edit forces a fresh mount; typing leaves it untouched.
export function fieldRev(componentKey: ComponentKey, path: string): number {
  return state.fieldRev.get(fieldKey(componentKey, path)) ?? 0
}

// Set a leaf programmatically (copy/capture) and bump its revision so the Input re-mounts.
export function setFieldProgrammatic(
  componentKey: ComponentKey,
  path: string,
  value: string | boolean
): void {
  const k = fieldKey(componentKey, path)
  state.fieldEdits.set(k, value)
  state.fieldRev.set(k, (state.fieldRev.get(k) ?? 0) + 1)
  state.editStatus.delete(componentKey)
}

export type BuildResult =
  | { ok: true; json: string }
  | { ok: false; error: string }

// Reconstruct the component's JSON by walking the snapshot `value` shape and
// substituting edited leaves. Structure is preserved exactly (no keys added or
// removed), so the result always round-trips against /set_component.
export function buildEditedJson(
  componentKey: ComponentKey,
  value: unknown
): BuildResult {
  try {
    return { ok: true, json: JSON.stringify(rebuild(componentKey, '', value)) }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}

function rebuild(componentKey: ComponentKey, path: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => rebuild(componentKey, joinPath(path, i), v))
  }
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
      out[k] = rebuild(componentKey, joinPath(path, k), value[k])
    }
    return out
  }
  if (typeof value === 'number') {
    const edit = state.fieldEdits.get(fieldKey(componentKey, path))
    if (typeof edit !== 'string') return value
    const n = parseFloat(edit)
    if (Number.isNaN(n)) {
      throw new Error(`invalid number at ${path || 'value'}: "${edit}"`)
    }
    return n
  }
  if (typeof value === 'boolean') {
    const edit = state.fieldEdits.get(fieldKey(componentKey, path))
    return typeof edit === 'boolean' ? edit : value
  }
  if (typeof value === 'string') {
    const edit = state.fieldEdits.get(fieldKey(componentKey, path))
    return typeof edit === 'string' ? edit : value
  }
  return value
}
