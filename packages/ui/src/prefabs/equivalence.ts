// One answer to "is this the same authored value written two ways?"
//
// The engine echoes components back NORMALIZED: unset optional fields filled
// with explicit nulls, repeated fields as empty lists, runtime state mutated
// (Animator playing/weight while clips blend). Authored composites hold the
// minimal hand-written form. Anything that captures, saves, heals or compares
// component values meets both forms, so the tolerance lives here — in one
// module — instead of as a point fix per consumer per component.
//
// Two tables, deliberately small:
//   * RUNTIME_FIELDS  — fields the engine mutates at run time; ignored when
//     comparing, kept when capturing (the authored initial state matters at
//     spawn, and there is no honest way to un-mutate an echoed value).
//   * NULL_ECHO_COMPONENTS — components whose echo fills unset optional fields
//     with nulls; capture strips those so a folder baked after Play holds the
//     same bytes as one baked from fresh authoring.
//
// This is NOT protobuf-schema normalization. `valueEquivalent` treats
// null / undefined / empty-list as "field not set" (proto3-JSON's own reading)
// and numbers modulo f32 rounding; `{}` stays meaningful (a set-but-empty
// message — oneof arms like `mesh.box: {}` depend on it), and filled-in scalar
// defaults (metallic: 0.5 …) stay out of scope: equating those needs the whole
// schema, and the folder side is written by our own capture, which is already
// echo-shaped or null-stripped.
import { isRecord } from './format'

// '*' walks every element of an array.
const RUNTIME_FIELDS: Record<string, ReadonlyArray<readonly string[]>> = {
  Animator: [
    ['states', '*', 'playing'],
    ['states', '*', 'weight']
  ]
}

const NULL_ECHO_COMPONENTS: readonly string[] = [
  'Material',
  'MeshRenderer',
  'VisibilityComponent',
  'PointerEvents'
]

// Both sides of a compare may speak composite ('core::Animator') or snapshot
// ('Animator') names; the tables are keyed by the short form.
function shortName(componentName: string): string {
  return componentName.startsWith('core::') ? componentName.slice('core::'.length) : componentName
}

function unset(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

/**
 * Structural equality across the authored-minimal / engine-normalized divide:
 * null == undefined == absent == empty list, numbers modulo f32.
 */
export function valueEquivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (unset(a) || unset(b)) return unset(a) && unset(b)
  if (typeof a === 'number' && typeof b === 'number') return Math.fround(a) === Math.fround(b)
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => valueEquivalent(v, b[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  for (const key of keys) {
    if (!valueEquivalent(ao[key], bo[key])) return false
  }
  return true
}

function stripAt(value: unknown, path: readonly string[]): unknown {
  const [head, ...rest] = path
  if (head === '*') {
    return Array.isArray(value) ? value.map((item) => stripAt(item, rest)) : value
  }
  if (!isRecord(value) || !(head in value)) return value
  if (rest.length === 0) {
    const { [head]: _dropped, ...kept } = value
    return kept
  }
  return { ...value, [head]: stripAt(value[head], rest) }
}

/** The value with the engine's runtime-mutated fields removed. Compare-side only. */
export function stripRuntimeFields(componentName: string, value: unknown): unknown {
  const paths = RUNTIME_FIELDS[shortName(componentName)]
  if (paths === undefined) return value
  return paths.reduce((current, path) => stripAt(current, path), value)
}

/** The one comparison drift-style consumers should use for a component value pair. */
export function componentValueEquivalent(componentName: string, a: unknown, b: unknown): boolean {
  return valueEquivalent(
    stripRuntimeFields(componentName, a),
    stripRuntimeFields(componentName, b)
  )
}

function stripUnsetFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsetFields)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (unset(item)) continue
    out[key] = stripUnsetFields(item)
  }
  return out
}

/**
 * What capture bakes for a component: the echo's explicit nulls and empty
 * repeated lists stripped for the components known to carry them, so two
 * folders for the same prefab — one saved over after Play, one from fresh
 * authoring — hold the same bytes. Only the allowlist is touched: a null can
 * be meaningful elsewhere (a cleared Triggers reference is stored as null).
 */
export function normalizeCapturedComponent(componentName: string, value: unknown): unknown {
  if (!NULL_ECHO_COMPONENTS.includes(shortName(componentName))) return value
  return stripUnsetFields(value)
}
