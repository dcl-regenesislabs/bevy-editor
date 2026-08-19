// Place a prefab folder into the live scene: fresh engine entity ids, `{assetPath}`
// resolved to the folder, refs re-pointed at the copies, root dropped where the user
// asked. Every write goes through inspector.ts so undo, autosave and the bus mirror
// come for free.
import { allocateNamedEntities, reloadSnapshot, writeComponent } from '@scene/inspector'
import { snapshotComponentName } from '@scene/composite'
import { NAME_COMPONENT } from '@scene/custom-components'
import { state, setSelected } from '@scene/state'
import { revealInTree } from '../panels/reveal'
import { ensureContentMapped } from '../assets'
import { dataLayerReadFile } from '../engine/datalayer'
import { getScriptParams, parseLayout } from '../script/parser'
import { referencedNames } from '../script/references'
import { log } from '../log'
import { mergeRequiredPermissions, readPrefabFolder } from './storage'
import { mergedLayoutJson } from './versioning'
import {
  COMPONENTS_WITH_ID,
  COUNTER_COMPONENT,
  CUSTOM_ASSET_COMPONENT,
  SCRIPT_COMPONENT,
  SELF_ID,
  TRANSFORM_COMPONENT,
  TRIGGERS_COMPONENT,
  clone,
  forEachTriggerRef,
  isExcludedComponent,
  isRecord,
  parseComponentRef,
  parseEntityMarker,
  prefabLayout,
  remapLayoutToEngine,
  remapScriptLayouts,
  substituteAssetPath,
  videoPlayerRefSites,
  type PrefabComposite,
  type PrefabData,
  type PrefabEntity,
  type TransformValue,
  type Vector3
} from './format'

export interface InstantiateResult {
  rootId: string | null
  data: PrefabData
  warnings: string[]
  permissionsAdded: string[]
  // the prefab carries Script components — the scene server must restart
  // before Play for their server side to exist
  hasScripts: boolean
}

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 }
const UNIT = { x: 1, y: 1, z: 1 }
const MODEL_EXT = /\.(glb|gltf)$/i

function collectPaths(value: unknown, prefix: string, out: Set<string>): void {
  if (typeof value === 'string') {
    if (value.startsWith(`${prefix}/`)) out.add(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectPaths(item, prefix, out)
  }
}

// The engine only resolves files it has in its content map; a prefab that was just
// copied in (or written by another tool) isn't there until /scene_content refreshes.
async function mapPrefabContent(composite: PrefabComposite, folder: string): Promise<void> {
  const paths = new Set<string>()
  collectPaths(composite.components, folder, paths)
  for (const path of paths) {
    if (MODEL_EXT.test(path)) await ensureContentMapped(path)
  }
}

// Hub-compatible id allocation: `asset-packs::Counter` on the scene root is the
// scene's id counter (getNextId), so ids stay unique across the Hub and this editor.
async function allocateComponentIds(count: number): Promise<number[]> {
  if (count === 0) return []
  const current = state.snapshot['0']?.[COUNTER_COMPONENT]
  const base = isRecord(current) && typeof current.value === 'number' ? current.value : 0
  const next = { ...(isRecord(current) ? current : { id: 0 }), value: base + count }
  await writeComponent('0', COUNTER_COMPONENT, JSON.stringify(next))
  return Array.from({ length: count }, (_, i) => base + i + 1)
}

// Entity names are looked up by scripts (getEntitiesWithName, and a trigger zone's
// id IS its Name) and keyed on by the inspector, so a second copy of the same prefab
// must not reuse them.
//
// A name a SCRIPT still names is taken too, even with no entity carrying it. Delete
// every "Trigger Zone" and the reactions that referenced one keep the string; giving
// the next zone that freed name silently re-binds them to it, so a brand-new zone
// arrives already wired to a script the creator never put there.
function uniqueNames(requested: string[]): Array<{ value: string }> {
  const taken = referencedNames(state.snapshot)
  for (const components of Object.values(state.snapshot)) {
    const name = components[NAME_COMPONENT]
    if (isRecord(name) && typeof name.value === 'string') taken.add(name.value)
  }
  return requested.map((base) => {
    let name = base
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`
    taken.add(name)
    return { value: name }
  })
}

function idKey(componentName: string, localId: string): string {
  return `${componentName}:${localId}`
}

// Pre-allocate an id for every `id: "{self}"` in the composite, so Trigger references
// can be resolved in the same pass that writes the components.
async function allocateSelfIds(composite: PrefabComposite): Promise<Map<string, number>> {
  const keys: string[] = []
  for (const component of composite.components) {
    if (!COMPONENTS_WITH_ID.includes(component.name)) continue
    for (const [localId, entry] of Object.entries(component.data)) {
      if (isRecord(entry.json) && entry.json.id === SELF_ID) keys.push(idKey(component.name, localId))
    }
  }
  const ids = await allocateComponentIds(keys.length)
  return new Map(keys.map((key, i) => [key, ids[i]]))
}

function resolveTriggerRefs(
  value: unknown,
  localId: string,
  selfIds: Map<string, number>,
  warnings: string[]
): void {
  forEachTriggerRef(value, (item) => {
    if (typeof item.id === 'number') return
    const ref = parseComponentRef(item.id)
    const resolved =
      ref === null ? undefined : selfIds.get(idKey(ref.componentName, String(ref.localId ?? localId)))
    if (resolved === undefined) {
      if (item.id !== undefined && item.id !== null) {
        warnings.push(`trigger reference ${String(item.id)} could not be resolved — cleared`)
      }
      delete item.id
      return
    }
    item.id = resolved
  })
}

// A prefab may ship its Script entries with a partial layout — usually just the
// params it wires (the Moving Platform's destination) — but the inspector
// renders params FROM the layout, so anything the composite omitted would
// simply not exist as a setting. Re-parse the just-copied script and MERGE:
// the source is authoritative for the param list, the composite contributes
// the values it pre-wired. An empty layout degenerates to a plain fill.
async function fillEmptyScriptLayouts(value: unknown, warnings: string[]): Promise<void> {
  if (!isRecord(value) || !Array.isArray(value.value)) return
  for (const item of value.value) {
    if (!isRecord(item) || typeof item.path !== 'string') continue
    try {
      item.layout = mergedLayoutJson(
        getScriptParams(await dataLayerReadFile(item.path)),
        typeof item.layout === 'string' ? item.layout : undefined
      )
    } catch (e) {
      warnings.push(`could not read ${item.path} to build its params: ${String(e)}`)
    }
  }
}

function resolveScriptLayouts(
  value: unknown,
  idMap: Map<string, number>,
  warnings: string[]
): void {
  remapScriptLayouts(
    value,
    (layout) => remapLayoutToEngine(layout, (local) => idMap.get(String(local))),
    warnings
  )
}

// `{self}` and `{entity:<localId>}` resolve to the fresh engine ids; raw numbers are
// left alone (a foreign composite's dangling id — same policy as script layouts).
function resolveVideoRefs(
  value: unknown,
  self: number,
  idMap: Map<string, number>,
  warnings: string[]
): void {
  for (const site of videoPlayerRefSites(value)) {
    const current = site.read()
    if (current === SELF_ID) {
      site.write(self)
      continue
    }
    const local = parseEntityMarker(current)
    if (local === null) continue
    const mapped = idMap.get(String(local))
    if (mapped === undefined) {
      warnings.push(`a video texture ref ({entity:${local}}) could not be resolved — cleared`)
      site.write(0)
      continue
    }
    site.write(mapped)
  }
}

function transformJson(
  entity: PrefabEntity,
  parent: number,
  position: Vector3 | null
): string {
  const t = entity.transform ?? {}
  const value: TransformValue = {
    position: position ?? t.position ?? { x: 0, y: 0, z: 0 },
    rotation: t.rotation ?? IDENTITY,
    scale: t.scale ?? UNIT,
    parent
  }
  return JSON.stringify(value)
}

export async function instantiatePrefab(
  folder: string,
  position: Vector3
): Promise<InstantiateResult> {
  const { data, composite } = await readPrefabFolder(folder)
  substituteAssetPath(composite.components, folder)
  await mapPrefabContent(composite, folder)

  const layout = prefabLayout(composite)
  const hasScripts = composite.components.some((c) => c.name === SCRIPT_COMPONENT)
  const warnings: string[] = []
  if (layout.entities.length === 0) {
    return { rootId: null, data, warnings: ['the prefab has no entities'], permissionsAdded: [], hasScripts }
  }

  // Several roots can't share a drop point without a parent to hold them together —
  // the capture rebased them around their centroid, so one container restores the group.
  const needsContainer = layout.roots.length > 1
  const requested = layout.entities.map(
    (entity) => entity.name ?? (entity.parent === null ? data.name : `${data.name}_${entity.localId}`)
  )
  if (needsContainer) requested.unshift(data.name)
  const names = uniqueNames(requested)

  const allocated = await allocateNamedEntities(names)
  const containerId: number | null = needsContainer ? (allocated[0] ?? null) : null
  const idMap = new Map<string, number>()
  layout.entities.forEach((entity, i) => {
    const id = allocated[needsContainer ? i + 1 : i]
    if (id !== null && id !== undefined) idMap.set(entity.localId, id)
  })
  if (idMap.size === 0) {
    return { rootId: null, data, warnings: ['could not allocate entities'], permissionsAdded: [], hasScripts }
  }

  const selfIds = await allocateSelfIds(composite)
  const writes: Array<Promise<void>> = []

  for (const component of composite.components) {
    const snapshotName = snapshotComponentName(component.name)
    if (snapshotName === undefined) {
      warnings.push(`${component.name} is not a known component — skipped`)
      continue
    }
    if (isExcludedComponent(snapshotName)) continue
    if (snapshotName === NAME_COMPONENT || snapshotName === TRANSFORM_COMPONENT) continue

    for (const [localId, entry] of Object.entries(component.data)) {
      const entityId = idMap.get(localId)
      if (entityId === undefined) continue
      const value = clone(entry.json)
      if (COMPONENTS_WITH_ID.includes(component.name) && isRecord(value) && value.id === SELF_ID) {
        value.id = selfIds.get(idKey(component.name, localId)) ?? 0
      }
      if (snapshotName === TRIGGERS_COMPONENT) resolveTriggerRefs(value, localId, selfIds, warnings)
      if (snapshotName === SCRIPT_COMPONENT) {
        await fillEmptyScriptLayouts(value, warnings)
        resolveScriptLayouts(value, idMap, warnings)
      }
      resolveVideoRefs(value, entityId, idMap, warnings)
      writes.push(writeComponent(String(entityId), snapshotName, JSON.stringify(value)))
    }
  }

  if (containerId !== null) {
    writes.push(
      writeComponent(
        String(containerId),
        TRANSFORM_COMPONENT,
        JSON.stringify({ position, rotation: IDENTITY, scale: UNIT, parent: 0 })
      )
    )
  }

  for (const entity of layout.entities) {
    const entityId = idMap.get(entity.localId)
    if (entityId === undefined) continue
    const parentLocal = entity.parent
    const parent =
      parentLocal === null ? (containerId ?? 0) : (idMap.get(parentLocal) ?? containerId ?? 0)
    // a single-root prefab omits its root Transform on purpose: the drop position is it
    const drop = parentLocal === null && containerId === null ? position : null
    writes.push(
      writeComponent(String(entityId), TRANSFORM_COMPONENT, transformJson(entity, parent, drop))
    )
  }

  const rootEngineId = containerId ?? idMap.get(layout.roots[0])
  if (rootEngineId !== undefined) {
    writes.push(
      writeComponent(
        String(rootEngineId),
        CUSTOM_ASSET_COMPONENT,
        JSON.stringify({ assetId: data.id })
      )
    )
  }

  try {
    await Promise.all(writes)
  } catch (e) {
    warnings.push(`some components could not be written: ${String(e)}`)
    log.error('prefab instantiation write failed', e)
  }

  let permissionsAdded: string[] = []
  try {
    permissionsAdded = await mergeRequiredPermissions(data.requiredPermissions ?? [])
  } catch (e) {
    warnings.push('the prefab needs scene permissions that could not be added to scene.json')
    log.warn('prefab permissions merge failed', e)
  }

  const rootId = rootEngineId === undefined ? null : String(rootEngineId)
  if (rootId !== null) {
    setSelected([rootId])
    state.activeEntity = rootId
    revealInTree(rootId)
  }
  // a running scene hasn't ticked the new entities in yet; a frozen one must not
  // refetch at all (/crdt_snapshot is stale there and would drop the writes above)
  if (!state.frozen) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      await reloadSnapshot()
      if (rootId !== null && state.snapshot[rootId] !== undefined) break
    }
  }

  return { rootId, data, warnings, permissionsAdded, hasScripts }
}
