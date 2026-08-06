// Instance drift: does a placed prefab instance still match the folder it came
// from? An in-memory capture of the instance's subtree, structurally diffed
// against `custom/<slug>/composite.json`. Pure — no data layer, no engine.
//
// This is new machinery. `.origin-hashes.json` (hashes.ts) keeps its own,
// different job: folder-*file* drift for updatePrefabCopy.
//
// Three normalisations keep the diff about what the creator changed rather than
// about what placement does to a prefab on its way into a scene:
//
//   * entities are aligned by their position in the tree, not by local id — the
//     capture numbers entities in breadth-first order, so inserting one child
//     renumbers everything visited after it and would report the whole subtree;
//   * `{assetPath}` paths are re-expressed the way the folder stores them —
//     capture rebases resources onto the common directory of whatever the
//     instance references, which for a one-file prefab is `custom/x/scripts`,
//     not `custom/x`;
//   * a Script row whose folder layout carries no params compares on path and
//     priority only — instantiation fills those params in by parsing the script
//     (fillEmptyScriptLayouts), so every freshly placed built-in prefab would
//     otherwise read as drifted the moment it landed.
import { snapshotComponentName } from '@scene/composite'
import { authoredOnly, captureSelectionAsPrefab } from './capture'
import { componentValueEquivalent, valueEquivalent } from './equivalence'
import { prefabAssetId } from './provenance'
import {
  ASSET_PATH_TOKEN,
  COMPOSITE_NAME,
  COMPOSITE_TRANSFORM,
  SCRIPT_COMPONENT,
  isExcludedComponent,
  isRecord,
  prefabLayout,
  type PrefabComposite,
  type PrefabLayout,
  type PrefabResource,
  type PrefabSnapshot
} from './format'

export interface DriftEntry {
  localId: string
  component: string
}

export interface DriftResult {
  status: 'clean' | 'drifted' | 'unknown'
  added: DriftEntry[]
  removed: DriftEntry[]
  changed: DriftEntry[]
}

export interface DriftOptions {
  /** the prefab folder (`custom/<slug>`), so captured resource paths can be
   *  expressed the way the folder already stores them */
  folder?: string
  /** entities the scene's own code spawned — never part of the instance */
  isRuntime?: (entityId: string) => boolean
}

const UNKNOWN: DriftResult = { status: 'unknown', added: [], removed: [], changed: [] }

const SCRIPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const MODEL_EXT = /\.(glb|gltf)$/i

// --- value comparison ---

// The equivalence layer (equivalence.ts) is the single authority on when two
// component values are the same authored value: f32-tolerant, null == absent,
// runtime-mutated fields ignored per its table.
export function structuralEqual(a: unknown, b: unknown): boolean {
  return valueEquivalent(a, b)
}

// --- string rewriting over a composite (resource paths, local-id markers) ---

function mapEmbedded(raw: string, fn: (value: string) => string): string {
  const mapped = fn(raw)
  if (mapped !== raw) return mapped
  // a Script layout and an action's jsonPayload are JSON *strings* — the tokens
  // being rewritten live inside them
  const first = raw.charCodeAt(0)
  if (first !== 0x7b && first !== 0x5b) return raw
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }
  if (parsed === null || typeof parsed !== 'object') return raw
  const next = JSON.stringify(mapValueStrings(parsed, fn))
  return next === JSON.stringify(parsed) ? raw : next
}

function mapValueStrings(value: unknown, fn: (value: string) => string): unknown {
  if (typeof value === 'string') return mapEmbedded(value, fn)
  if (Array.isArray(value)) return value.map((item) => mapValueStrings(item, fn))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = mapValueStrings(item, fn)
  return out
}

function mapCompositeStrings(
  composite: PrefabComposite,
  fn: (value: string) => string
): PrefabComposite {
  return {
    version: composite.version,
    components: composite.components.map((component) => {
      const data: Record<string, { json: unknown }> = {}
      for (const [localId, entry] of Object.entries(component.data)) {
        data[localId] = { json: mapValueStrings(entry.json, fn) }
      }
      return { name: component.name, data }
    })
  }
}

const ENTITY_MARKER_TEXT = /\{entity:(\d+)\}/g
const COMPONENT_REF_TEXT = /\{(\d+):([^{}]+)\}/g

// `{entity:<localId>}` / `{<localId>:Component}` name entities by local id, and
// the two sides number them differently once the tree has changed shape — the
// path alignment already says which is which, so speak the folder's ids.
function remapMarkerText(raw: string, map: Map<number, number>): string {
  if (!raw.includes('{')) return raw
  return raw
    .replace(ENTITY_MARKER_TEXT, (all, id: string) => {
      const next = map.get(Number(id))
      return next === undefined ? all : `{entity:${next}}`
    })
    .replace(COMPONENT_REF_TEXT, (all, id: string, name: string) => {
      const next = map.get(Number(id))
      return next === undefined ? all : `{${next}:${name}}`
    })
}

// --- resource paths ---

// Where a captured file belongs inside the prefab folder: a file already in the
// folder keeps exactly where it is (capture would otherwise re-derive a shallower
// path from the common directory of the instance's references), anything new is
// filed by kind, the way the built-in folders are laid out.
export function folderRelForResource(resource: PrefabResource, folder: string): string {
  const prefix = `${folder}/`
  if (resource.source.startsWith(prefix)) return resource.source.slice(prefix.length)
  const base = resource.source.split('/').pop() ?? resource.rel
  if (SCRIPT_EXT.test(base)) return `scripts/${base}`
  if (MODEL_EXT.test(base)) return `models/${base}`
  return resource.rel
}

export interface RealignedCapture {
  composite: PrefabComposite
  resources: PrefabResource[]
}

// Re-express a capture's `{assetPath}` paths against a specific prefab folder.
// Used by the diff (so an untouched instance matches its folder) and by Save over
// prefab (so a file already in the folder isn't copied to a second location).
export function realignCapturedResources(
  composite: PrefabComposite,
  resources: PrefabResource[],
  folder: string
): RealignedCapture {
  const rewrites = new Map<string, string>()
  const realigned = resources.map((resource) => {
    const rel = folderRelForResource(resource, folder)
    if (rel !== resource.rel) {
      rewrites.set(`${ASSET_PATH_TOKEN}/${resource.rel}`, `${ASSET_PATH_TOKEN}/${rel}`)
    }
    return { source: resource.source, rel }
  })
  if (rewrites.size === 0) return { composite, resources: realigned }
  return {
    composite: mapCompositeStrings(composite, (value) => rewrites.get(value) ?? value),
    resources: realigned
  }
}

// Two token paths that name the same file are the same resource. A copy whose
// model still points at the ORIGINAL project file — the normal shape for a
// prefab created in place, since capture copies the file into the folder but
// never rewrites the live entity — realigns to `models/<name>` because its
// source sits outside the folder, while the folder shelves that very file
// somewhere else (often its root). Re-speak such captured tokens the folder's
// way, so the diff is about which model the creator chose, never about where
// the folder happens to file it. Basenames that are ambiguous on either side
// are left alone — there is no honest single mapping.
function tokenPaths(composite: PrefabComposite): Set<string> {
  const found = new Set<string>()
  mapCompositeStrings(composite, (value) => {
    if (value.startsWith(`${ASSET_PATH_TOKEN}/`)) found.add(value)
    return value
  })
  return found
}

function baseOf(token: string): string {
  return token.slice(token.lastIndexOf('/') + 1)
}

function alignResourceTokens(captured: PrefabComposite, folder: PrefabComposite): PrefabComposite {
  const folderTokens = tokenPaths(folder)
  const capturedTokens = tokenPaths(captured)
  const folderByBase = new Map<string, string | null>()
  for (const token of folderTokens) {
    const base = baseOf(token)
    folderByBase.set(base, folderByBase.has(base) ? null : token)
  }
  const capturedBaseCount = new Map<string, number>()
  for (const token of capturedTokens) {
    const base = baseOf(token)
    capturedBaseCount.set(base, (capturedBaseCount.get(base) ?? 0) + 1)
  }
  const rewrites = new Map<string, string>()
  for (const token of capturedTokens) {
    if (folderTokens.has(token)) continue
    const base = baseOf(token)
    if (capturedBaseCount.get(base) !== 1) continue
    const target = folderByBase.get(base)
    if (target !== undefined && target !== null) rewrites.set(token, target)
  }
  if (rewrites.size === 0) return captured
  return mapCompositeStrings(captured, (value) => rewrites.get(value) ?? value)
}

// --- tree alignment ---

function childrenOf(layout: PrefabLayout): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const entity of layout.entities) {
    if (entity.parent === null) continue
    const list = children.get(entity.parent)
    if (list === undefined) children.set(entity.parent, [entity.localId])
    else list.push(entity.localId)
  }
  for (const list of children.values()) list.sort((a, b) => Number(a) - Number(b))
  return children
}

// A stable name for an entity's place in the tree: '' for the root, then the
// child index at each level. A new entity always carries the highest engine id,
// so it sorts last among its siblings and every entity that was already there
// keeps its path.
export function pathKeys(layout: PrefabLayout): Map<string, string> {
  const children = childrenOf(layout)
  const keys = new Map<string, string>()
  const roots = [...layout.roots].sort((a, b) => Number(a) - Number(b))
  const walk = (localId: string, key: string): void => {
    if (keys.has(localId)) return
    keys.set(localId, key)
    const list = children.get(localId) ?? []
    list.forEach((child, index) => walk(child, `${key}/${index}`))
  }
  roots.forEach((localId, index) => walk(localId, roots.length === 1 ? '' : `${index}`))
  return keys
}

function pathSegments(path: string): number[] {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(Number)
}

function comparePaths(a: string, b: string): number {
  const left = pathSegments(a)
  const right = pathSegments(b)
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return left.length - right.length
}

interface Cell {
  localId: string
  value: unknown
}

// `core-schema::Name` never travels: placement uniquifies it ("Zombie 2") and the
// spawnable snapshot strips it, so comparing it would light the chip on a second
// copy of a prefab nobody touched.
function comparable(compositeName: string): boolean {
  if (compositeName === COMPOSITE_NAME) return false
  const snapshotName = snapshotComponentName(compositeName)
  return snapshotName !== undefined && !isExcludedComponent(snapshotName)
}

function indexByPath(
  composite: PrefabComposite,
  keys: Map<string, string>
): Map<string, Map<string, Cell>> {
  const index = new Map<string, Map<string, Cell>>()
  for (const component of composite.components) {
    if (!comparable(component.name)) continue
    for (const [localId, entry] of Object.entries(component.data)) {
      const path = keys.get(localId)
      if (path === undefined) continue
      let cells = index.get(path)
      if (cells === undefined) {
        cells = new Map<string, Cell>()
        index.set(path, cells)
      }
      cells.set(component.name, { localId, value: entry.json })
    }
  }
  return index
}

// --- per-component comparison ---

const ORIGIN = { x: 0, y: 0, z: 0 }
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const UNIT = { x: 1, y: 1, z: 1 }

function vector(value: unknown, defaults: Record<string, number>): Record<string, unknown> {
  return { ...defaults, ...(isRecord(value) ? value : {}) }
}

// `parent` is deliberately left out: the hierarchy is compared through the path
// alignment, and the two sides may legitimately number the same entity differently.
function normalizedTransform(value: unknown): Record<string, unknown> {
  const t = isRecord(value) ? value : {}
  return {
    position: vector(t.position, ORIGIN),
    rotation: vector(t.rotation, IDENTITY),
    scale: vector(t.scale, UNIT)
  }
}

interface ScriptRow {
  path: string
  priority: number
  /** null when the layout declares no params — "not specified", not "no params" */
  params: Record<string, unknown> | null
}

function scriptParams(layout: unknown): Record<string, unknown> | null {
  if (typeof layout !== 'string' || layout === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(layout)
  } catch {
    return null
  }
  const params = isRecord(parsed) ? parsed.params : undefined
  if (!isRecord(params) || Object.keys(params).length === 0) return null
  const values: Record<string, unknown> = {}
  for (const [name, param] of Object.entries(params)) {
    values[name] = isRecord(param) ? param.value : param
  }
  return values
}

function scriptRows(value: unknown): ScriptRow[] | null {
  const list = isRecord(value) ? value.value : undefined
  if (!Array.isArray(list)) return null
  const rows: ScriptRow[] = []
  for (const item of list) {
    if (!isRecord(item) || typeof item.path !== 'string') return null
    rows.push({
      path: item.path,
      priority: typeof item.priority === 'number' ? item.priority : 0,
      params: scriptParams(item.layout)
    })
  }
  return rows
}

function scriptsEqual(folderValue: unknown, capturedValue: unknown): boolean {
  const folderRows = scriptRows(folderValue)
  const capturedRows = scriptRows(capturedValue)
  if (folderRows === null || capturedRows === null) {
    return structuralEqual(folderValue, capturedValue)
  }
  if (folderRows.length !== capturedRows.length) return false
  return folderRows.every((row, i) => {
    const other = capturedRows[i]
    if (row.path !== other.path || row.priority !== other.priority) return false
    if (row.params === null || other.params === null) return true
    const names = new Set([...Object.keys(row.params), ...Object.keys(other.params)])
    for (const name of names) {
      if (!structuralEqual(row.params[name], other.params[name])) return false
    }
    return true
  })
}

// A cell's key is a composite name on one side of the diff, a snapshot name on the other.
function named(compositeName: string, short: string): boolean {
  return compositeName === short || compositeName === `core::${short}`
}

function componentEqual(compositeName: string, folderValue: unknown, capturedValue: unknown): boolean {
  if (compositeName === SCRIPT_COMPONENT) return scriptsEqual(folderValue, capturedValue)
  if (compositeName === COMPOSITE_TRANSFORM) {
    return structuralEqual(normalizedTransform(folderValue), normalizedTransform(capturedValue))
  }
  // runtime-mutated fields (Animator playing/weight as clips blend, per the
  // equivalence table) are the engine's playback, never the creator's edit
  return componentValueEquivalent(compositeName, folderValue, capturedValue)
}

function gltfArtifact(compositeName: string, value: unknown): boolean {
  if (compositeName !== 'core::GltfContainer' && compositeName !== 'GltfContainer') return false
  return typeof value === 'object' && value !== null && (value as { src?: unknown }).src === ''
}

// The spawn projection's own rewrites, recognised so they are never blamed on
// the creator: a hidden VisibilityComponent the folder lacks, and a
// GltfContainer whose src is '' with both masks zeroed — '' is not authorable
// from the UI, so a diff of exactly that shape is our artifact (an echo from a
// session before the guards), not an edit. Only ever asked about a component the
// folder lacks, so the captured value alone decides.
function projectionArtifact(name: string, after: unknown): boolean {
  if (named(name, 'VisibilityComponent')) {
    const value = after as { visible?: unknown } | undefined
    return value !== undefined && Object.keys(value).length === 1 && value.visible === false
  }
  if (named(name, 'GltfContainer')) {
    const a = after as { src?: unknown; visibleMeshesCollisionMask?: unknown; invisibleMeshesCollisionMask?: unknown } | undefined
    if (a === undefined) return false
    return a.src === '' && (a.visibleMeshesCollisionMask ?? 0) === 0 && (a.invisibleMeshesCollisionMask ?? 0) === 0
  }
  return false
}

// --- the diff ---

// A nested instance root belongs to ITS prefab, never to the one it sits inside:
// nesting is unsupported (docs/PREFABS.md), so a Trigger Zone with a Spawner
// dropped on it was never "a drifted Trigger Zone" — it is a Trigger Zone with
// something else parked on top. Without this, any gesture that parents a prefab
// to a placed instance reads as drift of that instance.
//
// Dropping the nested ROOT is enough to prune its whole subtree: the capture walk
// only reaches a child through its parent, and nothing outside the nested
// instance parents into it.
function withoutNestedInstances(snapshot: PrefabSnapshot, rootId: string): PrefabSnapshot {
  const out: PrefabSnapshot = {}
  for (const [entityId, components] of Object.entries(snapshot)) {
    if (entityId !== rootId && prefabAssetId(components) !== null) continue
    out[entityId] = components
  }
  return out
}

export function instanceDrift(
  snapshot: PrefabSnapshot,
  rootId: string,
  folder: PrefabComposite,
  options: DriftOptions = {}
): DriftResult {
  const authored = authoredOnly(snapshot, options.isRuntime ?? (() => false))
  if (authored[rootId] === undefined) return UNKNOWN

  const folderLayout = prefabLayout(folder)
  // A multi-root prefab is placed under a generated container entity, so the
  // instance is a tree the folder never described — there is nothing honest to
  // align, and both coarse verbs would reshape the prefab.
  if (folderLayout.entities.length === 0 || folderLayout.roots.length !== 1) return UNKNOWN

  const captured = captureSelectionAsPrefab(withoutNestedInstances(authored, rootId), [rootId])
  const realigned =
    options.folder === undefined
      ? { composite: captured.composite, resources: captured.resources }
      : realignCapturedResources(captured.composite, captured.resources, options.folder)

  const tokenAligned =
    options.folder === undefined
      ? realigned.composite
      : alignResourceTokens(realigned.composite, folder)

  const capturedLayout = prefabLayout(tokenAligned)
  if (capturedLayout.roots.length > 1) return UNKNOWN

  const folderKeys = pathKeys(folderLayout)
  const capturedKeys = pathKeys(capturedLayout)

  const localIdMap = new Map<number, number>()
  const folderByPath = new Map<string, string>()
  for (const [localId, path] of folderKeys) folderByPath.set(path, localId)
  for (const [localId, path] of capturedKeys) {
    const target = folderByPath.get(path)
    if (target !== undefined) localIdMap.set(Number(localId), Number(target))
  }

  const aligned = mapCompositeStrings(tokenAligned, (value) =>
    remapMarkerText(value, localIdMap)
  )

  const folderIndex = indexByPath(folder, folderKeys)
  const capturedIndex = indexByPath(aligned, capturedKeys)

  const added: DriftEntry[] = []
  const removed: DriftEntry[] = []
  const changed: DriftEntry[] = []

  const paths = [...new Set([...folderIndex.keys(), ...capturedIndex.keys()])].sort(comparePaths)
  for (const path of paths) {
    const folderCells = folderIndex.get(path)
    const capturedCells = capturedIndex.get(path)
    const names = [
      ...new Set([...(folderCells?.keys() ?? []), ...(capturedCells?.keys() ?? [])])
    ].sort()
    for (const name of names) {
      // The root's placement belongs to the scene, not the prefab: capture
      // drops it on a single-root copy and a builtin folder may ship a default
      // one, so comparing it calls every fresh placement "changed".
      if (path === '' && name === COMPOSITE_TRANSFORM) continue
      const before = folderCells?.get(name)
      const after = capturedCells?.get(name)
      if (before === undefined && after !== undefined) {
        if (!projectionArtifact(name, after.value)) added.push({ localId: after.localId, component: name })
        continue
      }
      if (before !== undefined && after === undefined) {
        removed.push({ localId: before.localId, component: name })
        continue
      }
      if (before === undefined || after === undefined) continue
      // either side holding the projection's blank model is damage awaiting the
      // heal, not an edit — blaming it re-opens the modal the heal is closing
      if (gltfArtifact(name, before.value) || gltfArtifact(name, after.value)) continue
      if (!componentEqual(name, before.value, after.value)) {
        changed.push({ localId: before.localId, component: name })
      }
    }
  }

  const clean = added.length === 0 && removed.length === 0 && changed.length === 0
  return { status: clean ? 'clean' : 'drifted', added, removed, changed }
}

export function driftEntryCount(result: DriftResult): number {
  return result.added.length + result.removed.length + result.changed.length
}
