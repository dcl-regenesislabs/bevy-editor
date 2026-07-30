// Turn a selection (its top-level roots plus everything under them) into a
// Hub-format prefab composite: local entity ids, `{assetPath}` resource paths,
// `{self}` / `{<localId>:Component}` entity refs, and `{entity:<localId>}` script
// params. Pure — it reads a snapshot and returns data; capture-time file copying
// and the folder write live in storage.ts.
import { compositeComponentName } from '../../../scene/src/composite'
import {
  ACTIONS_COMPONENT,
  ASSET_PATH_TOKEN,
  BASE_ENTITY_ID,
  COMPONENTS_WITH_ID,
  RESOURCE_ACTION_TYPES,
  SCRIPT_COMPONENT,
  SELF_ID,
  SINGLE_ENTITY_ID,
  TRANSFORM_COMPONENT,
  TRIGGERS_COMPONENT,
  clone,
  commonBasePath,
  crossComponentRef,
  entityMarker,
  forEachTriggerRef,
  isExcludedComponent,
  isLocalResourcePath,
  isRecord,
  relativeResourcePath,
  remapLayoutToLocal,
  remapScriptLayouts,
  selfComponentRef,
  videoPlayerRefSites,
  type PrefabComposite,
  type PrefabCompositeComponent,
  type PrefabResource,
  type PrefabSnapshot,
  type TransformValue,
  type Vector3
} from './format'

export interface LocalEntity {
  entityId: string
  localId: number
  isRoot: boolean
}

export interface LocalIds {
  entities: LocalEntity[]
  byEntity: Map<string, number>
  roots: string[]
}

export interface CaptureResult {
  composite: PrefabComposite
  resources: PrefabResource[]
  warnings: string[]
  ids: LocalIds
}

function transformOf(snapshot: PrefabSnapshot, id: string): Partial<TransformValue> | undefined {
  const t = snapshot[id]?.[TRANSFORM_COMPONENT]
  return isRecord(t) ? (t as Partial<TransformValue>) : undefined
}

function directChildren(snapshot: PrefabSnapshot, id: string): string[] {
  const pid = Number(id)
  return Object.keys(snapshot).filter((child) => (transformOf(snapshot, child)?.parent ?? 0) === pid)
}

function subtree(snapshot: PrefabSnapshot, root: string): string[] {
  const order: string[] = []
  const queue = [root]
  while (queue.length > 0) {
    const id = queue.shift() as string
    if (order.includes(id)) continue
    order.push(id)
    for (const child of directChildren(snapshot, id)) queue.push(child)
  }
  return order
}

// The subtree walk follows Transform.parent through everything in the snapshot,
// which includes entities the scene's own code spawned at load (isRuntimeEntity).
// Those must never be captured: the script that made them ships with the prefab
// and recreates them on every run, so a baked copy doubles them — and orphans
// hundreds of junk entities when the instance root is deleted.
export function authoredOnly(
  snapshot: PrefabSnapshot,
  isRuntime: (entityId: string) => boolean
): PrefabSnapshot {
  const authored: PrefabSnapshot = {}
  for (const [entityId, components] of Object.entries(snapshot)) {
    if (!isRuntime(entityId)) authored[entityId] = components
  }
  return authored
}

// Hub-compatible numbering: one entity total -> "0"; otherwise roots at 512+index
// and every other entity at 512+rootCount+n, in per-root breadth-first order.
export function assignLocalIds(snapshot: PrefabSnapshot, roots: string[]): LocalIds {
  const present = roots.filter((id) => snapshot[id] !== undefined)
  const entities: LocalEntity[] = []
  const byEntity = new Map<string, number>()
  const single = present.length === 1
  let nonRoot = 0

  present.forEach((root, index) => {
    for (const id of subtree(snapshot, root)) {
      if (byEntity.has(id)) continue
      const isRoot = id === root
      const localId =
        single && isRoot
          ? SINGLE_ENTITY_ID
          : BASE_ENTITY_ID + (isRoot ? index : present.length + nonRoot++)
      byEntity.set(id, localId)
      entities.push({ entityId: id, localId, isRoot })
    }
  })

  return { entities, byEntity, roots: present }
}

function centroid(snapshot: PrefabSnapshot, roots: string[]): Vector3 {
  const sum = { x: 0, y: 0, z: 0 }
  if (roots.length === 0) return sum
  for (const id of roots) {
    const p = transformOf(snapshot, id)?.position
    sum.x += p?.x ?? 0
    sum.y += p?.y ?? 0
    sum.z += p?.z ?? 0
  }
  return { x: sum.x / roots.length, y: sum.y / roots.length, z: sum.z / roots.length }
}

// Every place a component value holds a project file path, as get/set pairs so the
// collect pass and the rewrite pass agree by construction.
interface ResourceSite {
  read: () => string | undefined
  write: (value: string) => void
}

const TEXTURE_SLOTS = ['texture', 'alphaTexture', 'emissiveTexture', 'bumpTexture']
const RESOURCE_PATHS: Record<string, string[][]> = {
  GltfContainer: [['src']],
  AudioSource: [['audioClipUrl']],
  VideoPlayer: [['src']],
  Material: [
    ...TEXTURE_SLOTS.map((slot) => ['material', 'pbr', slot, 'tex', 'texture', 'src']),
    ['material', 'unlit', 'texture', 'tex', 'texture', 'src']
  ]
}

function containerAt(value: unknown, keys: string[]): Record<string, unknown> | null {
  let cur: unknown = value
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isRecord(cur)) return null
    cur = cur[keys[i]]
  }
  return isRecord(cur) ? cur : null
}

function pathSite(value: unknown, keys: string[]): ResourceSite | null {
  const container = containerAt(value, keys)
  if (container === null) return null
  const last = keys[keys.length - 1]
  return {
    read: () => (typeof container[last] === 'string' ? (container[last] as string) : undefined),
    write: (next) => {
      container[last] = next
    }
  }
}

// An action's payload is a JSON string; its `src` is edited through a parse/serialize
// round-trip so the carrier stays a string.
function actionPayloadSites(value: unknown): ResourceSite[] {
  const sites: ResourceSite[] = []
  const list = isRecord(value) ? value.value : undefined
  if (!Array.isArray(list)) return sites
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const action = entry
    if (typeof action.type !== 'string' || !RESOURCE_ACTION_TYPES.includes(action.type)) continue
    if (typeof action.jsonPayload !== 'string') continue
    let payload: unknown
    try {
      payload = JSON.parse(action.jsonPayload)
    } catch {
      continue
    }
    if (!isRecord(payload)) continue
    sites.push({
      read: () => (typeof payload.src === 'string' ? payload.src : undefined),
      write: (next) => {
        payload.src = next
        action.jsonPayload = JSON.stringify(payload)
      }
    })
  }
  return sites
}

function scriptPathSites(value: unknown): ResourceSite[] {
  const sites: ResourceSite[] = []
  const list = isRecord(value) ? value.value : undefined
  if (!Array.isArray(list)) return sites
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const item = entry
    sites.push({
      read: () => (typeof item.path === 'string' ? item.path : undefined),
      write: (next) => {
        item.path = next
      }
    })
  }
  return sites
}

export function resourceSites(componentName: string, value: unknown): ResourceSite[] {
  const sites: ResourceSite[] = []
  for (const keys of RESOURCE_PATHS[componentName] ?? []) {
    const site = pathSite(value, keys)
    if (site !== null) sites.push(site)
  }
  if (componentName === ACTIONS_COMPONENT) sites.push(...actionPayloadSites(value))
  if (componentName === SCRIPT_COMPONENT) sites.push(...scriptPathSites(value))
  return sites.filter((site) => isLocalResourcePath(site.read()))
}

interface IdOwner {
  entityId: string
  componentName: string
}

// Which entity owns each id-bearing component, so a Trigger's numeric reference can
// be turned into `{self:Component}` / `{<localId>:Component}`.
function idOwners(snapshot: PrefabSnapshot): Map<number, IdOwner> {
  const owners = new Map<number, IdOwner>()
  for (const [entityId, components] of Object.entries(snapshot)) {
    for (const componentName of COMPONENTS_WITH_ID) {
      const value = components[componentName]
      const id = isRecord(value) ? value.id : undefined
      if (typeof id === 'number' && !owners.has(id)) owners.set(id, { entityId, componentName })
    }
  }
  return owners
}

function rewriteTriggers(
  value: unknown,
  entityId: string,
  owners: Map<number, IdOwner>,
  byEntity: Map<string, number>,
  warnings: string[]
): void {
  const toRef = (id: unknown): unknown => {
    if (typeof id !== 'number') return id
    const owner = owners.get(id)
    if (owner === undefined) {
      warnings.push(`trigger reference #${id} has no owner in the scene — cleared`)
      return null
    }
    if (owner.entityId === entityId) return selfComponentRef(owner.componentName)
    const local = byEntity.get(owner.entityId)
    if (local === undefined) {
      warnings.push(
        `trigger reference to entity ${owner.entityId} lies outside the prefab — cleared`
      )
      return null
    }
    return crossComponentRef(local, owner.componentName)
  }

  forEachTriggerRef(value, (item) => {
    item.id = toRef(item.id)
  })
}

function rewriteScriptLayouts(
  value: unknown,
  byEntity: Map<string, number>,
  warnings: string[]
): void {
  remapScriptLayouts(
    value,
    (layout) => remapLayoutToLocal(layout, (engineId) => byEntity.get(String(engineId))),
    warnings
  )
}

interface Captured {
  localId: number
  isRoot: boolean
  entityId: string
  componentName: string
  value: unknown
}

export function captureSelectionAsPrefab(
  snapshot: PrefabSnapshot,
  roots: string[]
): CaptureResult {
  const warnings: string[] = []
  const ids = assignLocalIds(snapshot, roots)
  const singleRoot = ids.roots.length === 1
  const origin = singleRoot ? { x: 0, y: 0, z: 0 } : centroid(snapshot, ids.roots)
  const owners = idOwners(snapshot)

  const captured: Captured[] = []
  const skipped = new Set<string>()
  for (const { entityId, localId, isRoot } of ids.entities) {
    for (const [componentName, value] of Object.entries(snapshot[entityId] ?? {})) {
      if (isExcludedComponent(componentName)) continue
      // a single-root prefab carries no root Transform — the drop position supplies it
      if (componentName === TRANSFORM_COMPONENT && isRoot && singleRoot) continue
      if (compositeComponentName(componentName) === undefined) {
        skipped.add(componentName)
        continue
      }
      captured.push({ localId, isRoot, entityId, componentName, value: clone(value) })
    }
  }
  if (skipped.size > 0) {
    warnings.push(`components not in the schema registry were skipped: ${[...skipped].join(', ')}`)
  }

  // Resource paths are collected first so every bundled file can be expressed relative
  // to their common folder (the Hub's convention — it keeps models/ and scripts/ apart).
  const sitesByComponent = captured.map((c) => resourceSites(c.componentName, c.value))
  const sourcePaths: string[] = []
  for (const sites of sitesByComponent) {
    for (const site of sites) {
      const path = site.read()
      if (path !== undefined) sourcePaths.push(path)
    }
  }
  const basePath = commonBasePath(sourcePaths)

  const resources: PrefabResource[] = []
  const seenResources = new Set<string>()
  for (const sites of sitesByComponent) {
    for (const site of sites) {
      const source = site.read()
      if (source === undefined) continue
      const rel = relativeResourcePath(source, basePath)
      site.write(`${ASSET_PATH_TOKEN}/${rel}`)
      if (seenResources.has(source)) continue
      seenResources.add(source)
      resources.push({ source, rel })
    }
  }

  for (const entry of captured) {
    const { componentName, value, entityId, isRoot } = entry
    if (componentName === TRANSFORM_COMPONENT && isRecord(value)) {
      const t = value as Partial<TransformValue>
      const parentLocal = ids.byEntity.get(String(t.parent ?? 0))
      t.parent = parentLocal ?? 0
      if (isRoot && !singleRoot) {
        const p = t.position ?? { x: 0, y: 0, z: 0 }
        t.position = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z }
      }
      continue
    }
    if (COMPONENTS_WITH_ID.includes(componentName) && isRecord(value)) value.id = SELF_ID
    if (componentName === TRIGGERS_COMPONENT) {
      rewriteTriggers(value, entityId, owners, ids.byEntity, warnings)
    }
    if (componentName === SCRIPT_COMPONENT) rewriteScriptLayouts(value, ids.byEntity, warnings)
    // `{self}` is the Hub's convention; cross-entity refs use our `{entity:<localId>}`
    // marker because a raw number is ambiguous (local id 0 vs. cleared).
    for (const site of videoPlayerRefSites(value)) {
      const current = site.read()
      if (typeof current !== 'number') continue
      if (String(current) === entityId) {
        site.write(SELF_ID)
        continue
      }
      const local = ids.byEntity.get(String(current))
      if (local === undefined) {
        warnings.push(`a video texture points at entity ${current} outside the prefab — cleared`)
        site.write(0)
        continue
      }
      site.write(entityMarker(local))
    }
  }

  const byName = new Map<string, PrefabCompositeComponent>()
  for (const entry of captured) {
    const name = compositeComponentName(entry.componentName)
    if (name === undefined) continue
    let component = byName.get(name)
    if (component === undefined) {
      component = { name, data: {} }
      byName.set(name, component)
    }
    component.data[String(entry.localId)] = { json: entry.value }
  }

  return {
    composite: { version: 1, components: [...byName.values()] },
    resources,
    warnings,
    ids
  }
}
