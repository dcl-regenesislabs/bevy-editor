// The on-disk prefab format: the Creator Hub custom-asset folder, verbatim, so a
// prefab this editor writes opens in the Hub and vice versa.
//
//   custom/<slug>/data.json       { id, name, category: "custom", tags, origin?, requiredPermissions? }
//   custom/<slug>/composite.json  { version, components: [{ name, data: { "<localId>": { json } } }] }
//   custom/<slug>/<resources…>    models/scripts/textures, relative structure preserved
//
// Pure helpers only — no data-layer, no engine, no browser globals — so capture,
// instantiate and the unit tests all build on the same primitives.

export const PREFAB_ROOT_DIR = 'custom'
export const ASSET_PATH_TOKEN = '{assetPath}'

// Hub-compatible local entity ids: a single-entity prefab is entity "0"; otherwise
// roots take 512+index and the rest 512+rootCount+n.
export const SINGLE_ENTITY_ID = 0
export const BASE_ENTITY_ID = 512

export const TRANSFORM_COMPONENT = 'Transform'
// composite-side names of the two components the format itself reads
export const COMPOSITE_TRANSFORM = 'core::Transform'
export const COMPOSITE_NAME = 'core-schema::Name'
export const SCRIPT_COMPONENT = 'asset-packs::Script'
export const ACTIONS_COMPONENT = 'asset-packs::Actions'
export const TRIGGERS_COMPONENT = 'asset-packs::Triggers'
export const COUNTER_COMPONENT = 'asset-packs::Counter'
export const CUSTOM_ASSET_COMPONENT = 'inspector::CustomAsset'

// Components carrying a scene-unique numeric `id` other components reference.
export const COMPONENTS_WITH_ID: readonly string[] = [
  ACTIONS_COMPONENT,
  'asset-packs::States',
  COUNTER_COMPONENT
]

// Editor-only state that must never travel with a prefab (same list the Hub uses).
export const EXCLUDED_COMPONENTS: readonly string[] = [
  'inspector::Selection',
  'inspector::Nodes',
  'inspector::TransformConfig',
  'inspector::Hide',
  'inspector::Lock',
  'inspector::Ground',
  'inspector::Tile',
  CUSTOM_ASSET_COMPONENT,
  'core-schema::Network-Entity'
]

export function isExcludedComponent(name: string): boolean {
  return EXCLUDED_COMPONENTS.includes(name)
}

// Action types whose jsonPayload carries a `src` file path.
export const RESOURCE_ACTION_TYPES: readonly string[] = [
  'show_image',
  'play_custom_emote',
  'play_sound'
]

export type PrefabOriginSource = 'builtin' | 'user' | 'import' | 'github'

export interface PrefabOrigin {
  source: PrefabOriginSource
  url?: string
  commit?: string
  author?: string
  importedAt?: string
  project?: string
}

export interface PrefabChangelogEntry {
  version: string
  notes: string
}

export interface PrefabData {
  id: string
  name: string
  category: 'custom'
  tags: string[]
  version?: string
  changelog?: PrefabChangelogEntry[]
  origin?: PrefabOrigin
  requiredPermissions?: string[]
  // 'auth-server' = the script calls isServer/registerMessages/Storage, so the
  // target scene must be on an SDK that has them
  requiresSdk?: 'auth-server'
  // prefabs sharing a group collapse into one browsable card (the 22 seats)
  group?: string
}

// a missing version reads as '0.0.0', so unversioned copies count as older than
// any versioned master
function versionParts(version: string | undefined): number[] {
  return (version ?? '0.0.0').split('.').map((segment) => {
    const n = parseInt(segment, 10)
    return Number.isFinite(n) ? n : 0
  })
}

// Semver-ish numeric compare: -1 / 0 / 1.
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const left = versionParts(a)
  const right = versionParts(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

export interface PrefabCompositeComponent {
  name: string
  data: Record<string, { json: unknown }>
}

export interface PrefabComposite {
  version: number
  components: PrefabCompositeComponent[]
}

// A file the prefab bundles: `source` is project-relative, `rel` is its path inside
// the prefab folder.
export interface PrefabResource {
  source: string
  rel: string
}

export type PrefabSnapshot = Record<string, Record<string, unknown>>

export type Vector3 = { x: number; y: number; z: number }
export type Quaternion = { x: number; y: number; z: number; w: number }
export interface TransformValue {
  position: Vector3
  rotation: Quaternion
  scale: Vector3
  parent: number
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// --- paths ---

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')
}

export function prefabFolder(slug: string): string {
  return `${PREFAB_ROOT_DIR}/${slug}`
}

// `custom/<slug>`, suffixed _2, _3, … until it isn't taken. `taken` holds folder paths.
export function uniquePrefabFolder(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base = slugify(name)
  const slug = base === '' ? 'prefab' : base
  let folder = prefabFolder(slug)
  let counter = 1
  while (used.has(folder)) folder = prefabFolder(`${slug}_${++counter}`)
  return folder
}

// --- parsing (a prefab folder can come from anywhere: the Hub, a zip, GitHub) ---

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function parsePrefabOrigin(value: unknown): PrefabOrigin | undefined {
  if (!isRecord(value)) return undefined
  const source = value.source
  if (source !== 'builtin' && source !== 'user' && source !== 'import' && source !== 'github') {
    return undefined
  }
  return {
    source,
    url: optionalString(value.url),
    commit: optionalString(value.commit),
    author: optionalString(value.author),
    importedAt: optionalString(value.importedAt),
    project: optionalString(value.project)
  }
}

function parseChangelog(value: unknown): PrefabChangelogEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const entries: PrefabChangelogEntry[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (typeof item.version !== 'string' || typeof item.notes !== 'string') continue
    entries.push({ version: item.version, notes: item.notes })
  }
  return entries
}

// `fallbackId` is used when the file has no id of its own — callers pass a fresh
// one so an id-less prefab still resolves its instances within a project.
export function parsePrefabData(raw: string, label: string, fallbackId: string): PrefabData {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || typeof parsed.name !== 'string') {
    throw new Error(`${label} is not a prefab`)
  }
  const permissions = Array.isArray(parsed.requiredPermissions)
    ? stringList(parsed.requiredPermissions)
    : undefined
  const origin = parsePrefabOrigin(parsed.origin)
  const group = optionalString(parsed.group)
  const version = optionalString(parsed.version)
  const changelog = parseChangelog(parsed.changelog)
  return {
    id: typeof parsed.id === 'string' ? parsed.id : fallbackId,
    name: parsed.name,
    category: 'custom',
    tags: stringList(parsed.tags),
    ...(version === undefined ? {} : { version }),
    ...(changelog === undefined ? {} : { changelog }),
    ...(origin === undefined ? {} : { origin }),
    ...(permissions === undefined ? {} : { requiredPermissions: permissions }),
    ...(group === undefined ? {} : { group })
  }
}

export function parsePrefabComposite(raw: string, label: string): PrefabComposite {
  const parsed: unknown = JSON.parse(raw)
  if (!isRecord(parsed) || !Array.isArray(parsed.components)) {
    throw new Error(`${label} is not a composite`)
  }
  const components: PrefabCompositeComponent[] = []
  for (const component of parsed.components) {
    if (!isRecord(component) || typeof component.name !== 'string') continue
    const data: Record<string, { json: unknown }> = {}
    if (isRecord(component.data)) {
      for (const [localId, entry] of Object.entries(component.data)) {
        if (isRecord(entry) && 'json' in entry) data[localId] = { json: entry.json }
      }
    }
    components.push({ name: component.name, data })
  }
  return { version: typeof parsed.version === 'number' ? parsed.version : 1, components }
}

export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

// Longest common directory prefix of the captured resources — the folder each
// bundled file's path is expressed relative to (port of the Hub's path-utils).
export function commonBasePath(paths: string[]): string {
  if (paths.length === 0) return ''
  const parts = paths.map((p) => p.split('/'))
  const minLength = Math.min(...parts.map((p) => p.length))
  const common: string[] = []
  for (let i = 0; i < minLength - 1; i++) {
    const segment = parts[0][i]
    if (!parts.every((p) => p[i] === segment)) break
    common.push(segment)
  }
  return common.join('/')
}

export function relativeResourcePath(fullPath: string, basePath: string): string {
  if (basePath === '') return fullPath.split('/').pop() ?? fullPath
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
  if (fullPath === base || fullPath.startsWith(`${base}/`)) {
    return fullPath.slice(base.length).replace(/^\//, '')
  }
  return fullPath.split('/').pop() ?? fullPath
}

// Only project-local files can be bundled; anything scheme'd (https://…) stays put.
export function isLocalResourcePath(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(value)
}

// --- {assetPath} substitution (prefab folder -> project path) ---

function normalizePosix(p: string): string {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0 || out[out.length - 1] === '..') out.push('..')
      else out.pop()
      continue
    }
    out.push(seg)
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/')
}

// A substituted path must stay inside the prefab folder; `{assetPath}/../../secrets`
// resolves back to the folder itself rather than escaping it.
function containAssetPath(replacement: string, joined: string): string | null {
  const base = replacement === '' ? '.' : normalizePosix(replacement)
  const normalized = normalizePosix(joined)
  if (normalized === base || normalized.startsWith(`${base}/`)) return normalized
  return null
}

// A material can stream from a VideoPlayer entity (`videoTexture.videoPlayerEntity`
// in Material and GltfNodeModifiers values). Deep get/set sites, like resource
// sites, so capture and instantiate remap the ref through one walk. The composite
// stores `{self}` for the owning entity (the Hub's convention) or a local id.
export interface EntityRefSite {
  read: () => unknown
  write: (next: number | string) => void
}

export function videoPlayerRefSites(value: unknown): EntityRefSite[] {
  const sites: EntityRefSite[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node)) return
    if ('videoPlayerEntity' in node) {
      sites.push({
        read: () => node.videoPlayerEntity,
        write: (next) => {
          node.videoPlayerEntity = next
        }
      })
    }
    for (const item of Object.values(node)) walk(item)
  }
  walk(value)
  return sites
}

// Fields whose string value is itself JSON — substitution has to recurse into the
// parsed value, not treat the whole literal as a path.
const JSON_WRAPPER_KEYS = new Set(['jsonPayload'])

function substituteString(raw: string, replacement: string): string {
  const joined = raw.split(ASSET_PATH_TOKEN).join(replacement)
  if (!joined.includes('/') && !joined.includes('\\')) return joined
  return containAssetPath(replacement, joined) ?? replacement
}

// Replace {assetPath} in every string reachable from `value` (including inside
// stringified jsonPayload carriers). Mutates in place; idempotent.
export function substituteAssetPath(value: unknown, replacement: string): void {
  if (value === null || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item: unknown = value[i]
      if (typeof item === 'string') {
        if (item.includes(ASSET_PATH_TOKEN)) value[i] = substituteString(item, replacement)
      } else {
        substituteAssetPath(item, replacement)
      }
    }
    return
  }

  const obj = value as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    const item: unknown = obj[key]
    if (typeof item !== 'string') {
      substituteAssetPath(item, replacement)
      continue
    }
    if (!item.includes(ASSET_PATH_TOKEN)) continue
    if (JSON_WRAPPER_KEYS.has(key)) {
      const nested = substituteJsonWrapper(item, replacement)
      if (nested !== null) {
        obj[key] = nested
        continue
      }
    }
    obj[key] = substituteString(item, replacement)
  }
}

function substituteJsonWrapper(raw: string, replacement: string): string | null {
  const first = raw.charCodeAt(0)
  if (first !== 0x7b && first !== 0x5b) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  substituteAssetPath(parsed, replacement)
  return JSON.stringify(parsed)
}

// --- component-id references ({self} / {self:Component} / {localId:Component}) ---

const SELF_REF = /^\{self:(.+)\}$/
const CROSS_ENTITY_REF = /^\{(\d+):(.+)\}$/

export const SELF_ID = '{self}'

export function selfComponentRef(componentName: string): string {
  return `{self:${componentName}}`
}

export function crossComponentRef(localId: number, componentName: string): string {
  return `{${localId}:${componentName}}`
}

export interface ComponentRef {
  componentName: string
  // undefined ⇒ the ref resolves against the entity that holds it
  localId?: number
}

// Every `{ id }` a Triggers value references, in both of its lists. Capture turns
// those ids into refs and instantiate turns them back, so they walk the shape once
// here rather than each keeping its own copy of it.
export function forEachTriggerRef(
  value: unknown,
  visit: (item: Record<string, unknown>) => void
): void {
  const triggers = isRecord(value) ? value.value : undefined
  if (!Array.isArray(triggers)) return
  for (const trigger of triggers) {
    if (!isRecord(trigger)) continue
    for (const key of ['actions', 'conditions']) {
      const list = trigger[key]
      if (!Array.isArray(list)) continue
      for (const item of list) if (isRecord(item)) visit(item)
    }
  }
}

export function parseComponentRef(ref: unknown): ComponentRef | null {
  if (typeof ref !== 'string') return null
  const self = SELF_REF.exec(ref)
  if (self !== null) return { componentName: self[1] }
  const cross = CROSS_ENTITY_REF.exec(ref)
  if (cross !== null) return { componentName: cross[2], localId: Number(cross[1]) }
  return null
}

// --- script layout entity params ---

// `Script.value[].layout` is a JSON string of { params, actions }. Entity-typed params
// hold raw engine ids, which mean nothing outside the scene that produced them — they
// are stored as this marker in a prefab and re-resolved at instantiation.
const ENTITY_MARKER = /^\{entity:(\d+)\}$/

export function entityMarker(localId: number): string {
  return `{entity:${localId}}`
}

export function parseEntityMarker(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = ENTITY_MARKER.exec(value)
  return m === null ? null : Number(m[1])
}

interface LayoutParam {
  type?: string
  value?: unknown
  optional?: boolean
}

interface Layout {
  params?: Record<string, LayoutParam>
  actions?: unknown
  error?: string
}

export interface LayoutRemapResult {
  layout: string
  warnings: string[]
}

// Rewrite every entity-typed param through `map`. `map` returns the replacement value,
// or null when the reference can't be resolved (the param is then zeroed — a dangling
// id would silently point at an unrelated entity). Unparseable layouts pass through.
function remapLayout(
  layoutJson: string,
  map: (value: unknown, paramName: string, warnings: string[]) => unknown
): LayoutRemapResult {
  const warnings: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(layoutJson)
  } catch {
    return { layout: layoutJson, warnings }
  }
  if (!isRecord(parsed)) return { layout: layoutJson, warnings }

  const layout = parsed as Layout
  const params = layout.params
  if (!isRecord(params)) return { layout: layoutJson, warnings }

  for (const [name, param] of Object.entries(params)) {
    if (!isRecord(param)) continue
    const typed = param as LayoutParam
    if (typed.type === 'entity') {
      typed.value = map(typed.value, name, warnings)
      continue
    }
    // an `action` param binds { entity, action } — its entity id needs the same remap
    if (typed.type === 'action' && isRecord(typed.value)) {
      const ref = typed.value
      ref.entity = map(ref.entity, name, warnings)
    }
  }
  return { layout: JSON.stringify(layout), warnings }
}

// capture: engine id -> {entity:<localId>} (0 = scene root, left as-is).
export function remapLayoutToLocal(
  layoutJson: string,
  toLocal: (engineId: number) => number | undefined
): LayoutRemapResult {
  return remapLayout(layoutJson, (value, name, warnings) => {
    if (typeof value !== 'number' || value === 0) return value
    const local = toLocal(value)
    if (local === undefined) {
      warnings.push(`script param "${name}" pointed at entity ${value} outside the prefab — cleared`)
      return 0
    }
    return entityMarker(local)
  })
}

// Run `remap` over every layout a Script component value carries, in place — the
// same walk for capture (to local markers) and instantiate (back to engine ids).
export function remapScriptLayouts(
  value: unknown,
  remap: (layoutJson: string) => LayoutRemapResult,
  warnings: string[]
): void {
  const list = isRecord(value) ? value.value : undefined
  if (!Array.isArray(list)) return
  for (const item of list) {
    if (!isRecord(item) || typeof item.layout !== 'string') continue
    const result = remap(item.layout)
    item.layout = result.layout
    warnings.push(...result.warnings)
  }
}

// instantiate: {entity:<localId>} -> the freshly allocated engine id.
export function remapLayoutToEngine(
  layoutJson: string,
  toEngine: (localId: number) => number | undefined
): LayoutRemapResult {
  return remapLayout(layoutJson, (value, name, warnings) => {
    const local = parseEntityMarker(value)
    if (local === null) return typeof value === 'number' ? value : 0
    const engineId = toEngine(local)
    if (engineId === undefined) {
      warnings.push(`script param "${name}" referenced missing prefab entity ${local} — cleared`)
      return 0
    }
    return engineId
  })
}

// --- composite reading ---

export interface PrefabEntity {
  localId: string
  parent: string | null
  name?: string
  transform?: Partial<TransformValue>
}

export interface PrefabLayout {
  entities: PrefabEntity[]
  roots: string[]
}

function componentData(
  composite: PrefabComposite,
  name: string
): Record<string, { json: unknown }> | undefined {
  return composite.components.find((c) => c.name === name)?.data
}

// Entity list of a prefab composite, breadth-first from its roots (a root being an
// entity whose Transform.parent isn't itself part of the prefab).
export function prefabLayout(composite: PrefabComposite): PrefabLayout {
  const ids: string[] = []
  for (const component of composite.components) {
    for (const id of Object.keys(component.data)) if (!ids.includes(id)) ids.push(id)
  }
  ids.sort((a, b) => Number(a) - Number(b))

  const transforms = componentData(composite, COMPOSITE_TRANSFORM) ?? {}
  const names = componentData(composite, COMPOSITE_NAME) ?? {}

  const parentOf = new Map<string, string | null>()
  const transformOf = new Map<string, Partial<TransformValue>>()
  for (const id of ids) {
    const json = transforms[id]?.json
    const t = isRecord(json) ? (json as Partial<TransformValue>) : undefined
    if (t !== undefined) transformOf.set(id, t)
    const parent = typeof t?.parent === 'number' ? String(t.parent) : null
    const inPrefab = parent !== null && parent !== id && ids.includes(parent)
    parentOf.set(id, inPrefab ? parent : null)
  }

  const nameOf = (id: string): string | undefined => {
    const json = names[id]?.json
    const value = isRecord(json) ? json.value : undefined
    return typeof value === 'string' ? value : undefined
  }

  const roots = ids.filter((id) => parentOf.get(id) === null)
  const entities: PrefabEntity[] = []
  const queue = [...roots]
  const seen = new Set<string>(roots)
  while (queue.length > 0) {
    const id = queue.shift() as string
    entities.push({
      localId: id,
      parent: parentOf.get(id) ?? null,
      name: nameOf(id),
      transform: transformOf.get(id)
    })
    for (const child of ids) {
      if (parentOf.get(child) === id && !seen.has(child)) {
        seen.add(child)
        queue.push(child)
      }
    }
  }
  // cycles (or a parent chain the walk couldn't reach) must not drop entities
  for (const id of ids) {
    if (seen.has(id)) continue
    entities.push({ localId: id, parent: null, name: nameOf(id), transform: transformOf.get(id) })
    roots.push(id)
  }
  return { entities, roots }
}
