import { cmd } from './cmd'
import { log } from './log'
import { state, type ComponentKey } from './state'
import { fieldKey, currentNumber, setFieldProgrammatic, joinPath } from './fields'

// channel layouts for the composite leaves, edited via per-channel widgets
const CHANNELS: Record<string, string[]> = {
  color3: ['r', 'g', 'b'],
  color4: ['r', 'g', 'b', 'a'],
  vector2: ['x', 'y'],
  vector3: ['x', 'y', 'z'],
  quaternion: ['x', 'y', 'z', 'w']
}

// --- schema types (mirror the /component_schema JSON) ---

export type EnumValues = Array<[string, number]>

export type SchemaNode =
  | { name?: string; kind: 'message'; fields: SchemaNode[]; optional?: boolean }
  | { name?: string; kind: 'oneof'; cases: Array<{ name: string; field: SchemaNode }> }
  | { name?: string; kind: 'repeated'; element: SchemaNode; optional?: boolean }
  | {
      name?: string
      kind: 'leaf'
      semantic: string
      enum?: string
      optional?: boolean
      default?: unknown
      range?: { min?: number; max?: number; hard: boolean }
      notes?: string
    }

export type ComponentSchema = {
  name: string
  placement: string
  readOnly: boolean
  requires: Array<{ component: string; locality: string; hard: boolean }>
  root: SchemaNode
  enums: Record<string, EnumValues>
}

export function getSchema(name: string): ComponentSchema | undefined {
  return state.schemas.get(name) as ComponentSchema | undefined
}

// A leaf's effective default, resolving dynamic `@transform.*` tokens against the entity's
// current Transform (so e.g. a Tween's move start/end default to the current placement).
export function effectiveDefault(
  key: ComponentKey,
  node: Extract<SchemaNode, { kind: 'leaf' }>
): unknown {
  const d = node.default
  if (typeof d !== 'string' || !d.startsWith('@transform.')) return d
  const entityId = key.split('/')[0]
  const t = state.snapshot[entityId]?.Transform as
    | { position?: unknown; rotation?: unknown; scale?: unknown }
    | undefined
  switch (d) {
    case '@transform.position':
      return t?.position ?? { x: 0, y: 0, z: 0 }
    case '@transform.rotation':
      return t?.rotation ?? { x: 0, y: 0, z: 0, w: 1 }
    case '@transform.scale':
      return t?.scale ?? { x: 1, y: 1, z: 1 }
    default:
      return undefined
  }
}

// For a leaf seeded from the entity's Transform (`@transform.*` default), the source field
// name (position/rotation/scale), else null — used to offer a "copy from Transform" button.
export function transformDefaultKind(
  node: Extract<SchemaNode, { kind: 'leaf' }>
): string | null {
  const d = node.default
  return typeof d === 'string' && d.startsWith('@transform.')
    ? d.slice('@transform.'.length)
    : null
}

// Copy the entity's *current* Transform value into this field (as per-channel edits, with a
// revision bump so the Inputs re-mount), so a rotate/move/scale Tween's start/end can
// capture the entity's current placement on demand.
export function copyFromTransform(
  key: ComponentKey,
  path: string,
  node: Extract<SchemaNode, { kind: 'leaf' }>
): void {
  const v = effectiveDefault(key, node)
  if (v === null || typeof v !== 'object') return
  for (const [ch, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number') setFieldProgrammatic(key, joinPath(path, ch), String(val))
  }
}

// Whether any channel under `path` already has an edit (so a capture won't clobber it).
function hasChannelEdit(key: ComponentKey, path: string): boolean {
  const prefix = `${fieldKey(key, path)}.`
  for (const k of state.fieldEdits.keys()) {
    if (k.startsWith(prefix)) return true
  }
  return false
}

// One-time capture: for every `@transform.*` leaf in the currently-active branches (the
// active oneof case at each level), seed it from the entity's current Transform — unless it
// already has edits. Called when a component is added and when a oneof case is selected, so
// e.g. a rotate Tween's start/end initialise to the current orientation and then stay put
// (instead of live-tracking the transform).
export function captureTransformDefaults(key: ComponentKey): void {
  const [entityId, compName] = key.split('/')
  const schema = getSchema(compName)
  if (schema === undefined) return
  const value = state.snapshot[entityId]?.[compName]

  const walk = (node: SchemaNode, path: string): void => {
    switch (node.kind) {
      case 'message':
        for (const f of node.fields) walk(f, joinPath(path, f.name ?? ''))
        break
      case 'oneof': {
        const active = activeCase(key, path, node, value)
        const c = node.cases.find((x) => x.name === active)
        if (c !== undefined) walk(c.field, joinPath(path, active as string))
        break
      }
      case 'leaf':
        if (transformDefaultKind(node) !== null && !hasChannelEdit(key, path)) {
          copyFromTransform(key, path, node)
        }
        break
      // repeated: skip (no transform-seeded repeated leaves)
    }
  }
  walk(schema.root, '')
}

// Fetch a component's schema and cache it, awaitably (best-effort — leaves it unset on failure,
// in which case the value passes through unchanged). Used by the save path, which must have the
// schema in hand before converting engine-form values.
export async function loadSchema(name: string): Promise<void> {
  if (state.schemas.has(name)) return
  try {
    const reply = await cmd.componentSchema(name)
    state.schemas.set(name, JSON.parse(reply))
  } catch {
    /* leave unset */
  }
}

// Convert an engine-form component value into the SDK form the composite loader expects. The
// engine's snapshot JSON encodes a protobuf `oneof` as `{ caseName: value }` (no discriminator),
// but the SDK/composite needs `{ $case: caseName, caseName: value }` — without it, the instancer
// drops the oneof on load. Walks the value against the schema; only oneof nodes are rewritten,
// everything else (messages, repeated, leaves, incl. harmless null/default fields) passes through.
export function toSdkValue(value: unknown, node: SchemaNode): unknown {
  if (value === null || value === undefined) return value
  switch (node.kind) {
    case 'oneof': {
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const obj = value as Record<string, unknown>
      // already SDK form (e.g. a custom component, or re-run) — recurse the active case
      if (typeof obj.$case === 'string') {
        const active = node.cases.find((c) => c.name === obj.$case)
        return active === undefined
          ? value
          : { $case: obj.$case, [obj.$case]: toSdkValue(obj[obj.$case], active.field) }
      }
      for (const c of node.cases) {
        const cv = obj[c.name]
        if (cv !== null && cv !== undefined) {
          return { $case: c.name, [c.name]: toSdkValue(cv, c.field) }
        }
      }
      return null // unset oneof
    }
    case 'message': {
      if (typeof value !== 'object' || Array.isArray(value)) return value
      const obj = value as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const f of node.fields) {
        const k = f.name as string
        const v = toSdkValue(obj[k], f)
        // Drop unset (null) fields. The engine emits unset optionals as null, but the SDK
        // composite loader (build-time) expects them absent — e.g. it reads `.x` on a null
        // Vector and crashes. Absent fields fall back to defaults, matching the Hub's output.
        if (v !== null && v !== undefined) out[k] = v
      }
      return out
    }
    case 'repeated': {
      if (!Array.isArray(value)) return value
      return value.map((v) => toSdkValue(v, node.element))
    }
    default:
      return value
  }
}

// Fetch (once) the schema for a component, caching it. Best-effort.
export function ensureSchema(name: string): void {
  if (state.schemas.has(name) || state.schemaPending.has(name)) return
  state.schemaPending.add(name)
  cmd.componentSchema(name)
    .then((reply) => {
      try {
        state.schemas.set(name, JSON.parse(reply))
      } catch {
        /* leave unset; editor falls back to value-shape rendering */
      }
    })
    .catch((e) => log.warn('component schema fetch failed', name, e))
    .then(() => {
      state.schemaPending.delete(name)
    })
}

// The entity's parent id (Transform.parent, defaulting to the scene root 0), or null at/above the
// root. Guards self-parent so a malformed snapshot can't loop the ancestor walk.
function parentOf(entityId: string): string | null {
  if (entityId === '0') return null
  const t = state.snapshot[entityId]?.Transform as { parent?: number } | undefined
  const p = String(t?.parent ?? 0)
  return p === entityId ? null : p
}

function hasComponentAt(entityId: string, component: string, locality: string): boolean {
  const has = (eid: string): boolean => component in (state.snapshot[eid] ?? {})
  switch (locality) {
    case 'same':
      return has(entityId)
    case 'parent': {
      const p = parentOf(entityId)
      return p !== null && has(p)
    }
    case 'ancestor': {
      const seen = new Set<string>([entityId])
      for (let p = parentOf(entityId); p !== null && !seen.has(p); p = parentOf(p)) {
        if (has(p)) return true
        seen.add(p)
      }
      return false
    }
    default:
      return true // unknown locality — don't block
  }
}

// A component's unmet *hard* restriction for a target entity, as a short reason, or null if it can
// be added. Checks placement (root-only) and hard requires (a component must be present at the
// given locality); soft requires are recommendations and never block. Returns null when the schema
// isn't loaded yet — restrictions can only be enforced once known (callers should ensureSchema).
export function restrictionUnmet(name: string, entityId: string): string | null {
  const schema = getSchema(name)
  if (schema === undefined) return null

  if (schema.placement === 'root' && entityId !== '0') return 'scene root only'

  for (const req of schema.requires) {
    if (req.hard && !hasComponentAt(entityId, req.component, req.locality)) {
      return `needs ${req.component}`
    }
  }
  return null
}

// --- value access by dotted path (oneof cases nest under the oneof field name) ---

export function valueAt(root: unknown, path: string): unknown {
  if (path === '') return root
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

// The oneof case currently active at `path`: a pending switch edit, else the case
// present in the snapshot value, else null.
export function activeCase(
  key: ComponentKey,
  path: string,
  node: Extract<SchemaNode, { kind: 'oneof' }>,
  value: unknown
): string | null {
  const edit = state.fieldEdits.get(`${fieldKey(key, path)}#case`)
  if (typeof edit === 'string') return edit
  const v = valueAt(value, path)
  if (v !== null && typeof v === 'object') {
    for (const c of node.cases) {
      if (c.name in (v as Record<string, unknown>)) return c.name
    }
  }
  // Nothing set → default to the first case (a usable default beats an inert null).
  return node.cases[0]?.name ?? null
}

export function setCase(key: ComponentKey, path: string, caseName: string): void {
  state.fieldEdits.set(`${fieldKey(key, path)}#case`, caseName)
  state.editStatus.delete(key)
  // seed any `@transform.*` fields in the newly-active case from the current Transform
  captureTransformDefaults(key)
}

// Whether the subtree at `path` has any pending edit (used to decide null vs object
// for untouched optional messages).
function hasEditUnder(key: ComponentKey, path: string): boolean {
  const prefix = `${key}::${path}`
  for (const k of state.fieldEdits.keys()) {
    if (k === prefix || k.startsWith(`${prefix}.`) || k.startsWith(`${prefix}#`)) return true
  }
  return false
}

// --- build the full component JSON from the schema + snapshot value + edits ---

export type BuildResult = { ok: true; json: string } | { ok: false; error: string }

export function buildFromSchema(
  key: ComponentKey,
  schema: ComponentSchema,
  value: unknown
): BuildResult {
  try {
    return { ok: true, json: JSON.stringify(buildNode(key, schema.root, '', value)) }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }
  }
}

function buildNode(
  key: ComponentKey,
  node: SchemaNode,
  path: string,
  value: unknown,
  // when true, an optional message is instantiated (with defaults) even if absent — used
  // for a oneof's selected case, which must be a struct, never null.
  forceObject = false
): unknown {
  switch (node.kind) {
    case 'message': {
      const cur = valueAt(value, path)
      // An untouched, absent, optional sub-message stays null (don't fabricate it).
      if (!forceObject && node.optional && cur === undefined && !hasEditUnder(key, path)) {
        return null
      }
      const out: Record<string, unknown> = {}
      for (const f of node.fields) {
        out[f.name as string] = buildNode(key, f, join(path, f.name as string), value)
      }
      return out
    }
    case 'oneof': {
      const active = activeCase(key, path, node, value)
      if (active === null) return null // unset oneof = None (an empty {} fails to deserialize)
      const c = node.cases.find((x) => x.name === active)
      if (c === undefined) return null
      return { [active]: buildNode(key, c.field, join(path, active), value, true) }
    }
    case 'repeated': {
      const cur = valueAt(value, path)
      const arr = Array.isArray(cur) ? cur : []
      return arr.map((el, i) => buildNode(key, node.element, join(path, String(i)), el))
    }
    case 'leaf':
      return buildLeaf(key, node, path, value)
  }
}

function buildLeaf(
  key: ComponentKey,
  node: Extract<SchemaNode, { kind: 'leaf' }>,
  path: string,
  value: unknown
): unknown {
  const edit = state.fieldEdits.get(fieldKey(key, path))
  const cur = valueAt(value, path)
  // A present-but-null value (the proto default shape is all-null) defers to the schema's
  // curated default (with `@transform.*` tokens resolved) — so what the editor shows is
  // what Apply writes.
  const def = effectiveDefault(key, node)
  const base = cur !== undefined && cur !== null ? cur : def
  const sem0 = node.semantic.split(':')[0]

  // color/vector/quaternion: rebuilt from per-channel edits over the base object
  const channels = CHANNELS[sem0]
  if (channels !== undefined) {
    const baseObj =
      base !== null && typeof base === 'object' ? (base as Record<string, unknown>) : undefined
    if (node.optional && baseObj === undefined && !hasEditUnder(key, path)) return null
    const out: Record<string, number> = {}
    for (const ch of channels) {
      const fallback = typeof baseObj?.[ch] === 'number' ? (baseObj[ch] as number) : 0
      out[ch] = currentNumber(key, join(path, ch), fallback)
    }
    return out
  }

  // textureUnion / borderRect: edited as raw JSON text (PoC; no dedicated widget yet)
  if (sem0 === 'textureUnion' || sem0 === 'borderRect') {
    if (typeof edit === 'string') return parseJson(edit, path)
    if (base !== undefined) return base
    return null
  }

  switch (sem0) {
    case 'bool': {
      if (typeof edit === 'boolean') return edit
      if (typeof base === 'boolean') return base
      return node.optional ? null : false
    }
    case 'string':
    case 'url':
    case 'urlOrContent':
    case 'contentFile':
    case 'urn':
    case 'userRef':
    case 'gltfNodePath':
    case 'gltfAnimationName': {
      if (typeof edit === 'string') return edit
      if (typeof base === 'string') return base
      return node.optional ? null : ''
    }
    default: {
      // numeric: number/int/uint/enum/bitmask/entityRef/cameraLayerId/uvArray-elements
      if (typeof edit === 'string') {
        if (edit === '' && node.optional) return null
        return parseNum(edit, path)
      }
      if (typeof base === 'number') return base
      return node.optional ? null : 0
    }
  }
}

function parseNum(text: string, path: string): number {
  const n = parseFloat(text)
  if (Number.isNaN(n)) throw new Error(`invalid number at ${path || 'value'}: "${text}"`)
  return n
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`invalid JSON at ${path || 'value'}`)
  }
}

function join(path: string, seg: string): string {
  return path === '' ? seg : `${path}.${seg}`
}
