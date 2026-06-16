// Composite import: pull a catalog asset's construction data from the engine and instance it into
// the current scene. The engine (`/asset_catalog`, `/init_asset`) owns sourcing — it fetches the
// asset-packs catalog, copies the asset's files into the scene's content map (so GltfContainer.src
// resolves), and returns the composite with `{assetPath}` already substituted. This module does the
// scene-side instancing: allocate a fresh entity per composite entity, remap entity-id references
// (Transform.parent), translate composite component names to editor names, and write the values.

import { BevyApi } from './bevy-api'
import { state, selectEntityInTree, type Snapshot } from './state'
import { editorNameForComposite, componentIdForName } from './composite'
import { allocateNamedEntities, writeComponent, reloadSnapshot } from './inspector'
import { sleep } from './utils'

const COMPOSITE_NAME = 'core-schema::Name'
const TRANSFORM = 'core::Transform'
const TRIGGERS = 'asset-packs::Triggers'
const SYNC_COMPONENTS = 'core-schema::Sync-Components'
const NETWORK_ENTITY = 'core-schema::Network-Entity'
const NETWORK_ID_START = 8001 // INSPECTOR_ENUM_ENTITY_ID_START in the Hub
// asset-packs components whose `id` field is a scene-unique generated number (the id sequence
// tracked by Counter.value on the root). On import an `id` of '{self}' gets a fresh id.
const COMPONENTS_WITH_ID = new Set(['asset-packs::Actions', 'asset-packs::States', 'asset-packs::Counter'])

type CompositeComponent = { name: string; data: Record<string, { json: unknown }> }
type Composite = { version?: number; components: CompositeComponent[] }
type Vec3 = { x: number; y: number; z: number }
type TransformJson = { parent?: number; position?: Vec3; rotation?: Vec3 & { w: number }; scale?: Vec3 }

export type CatalogEntry = {
  id: string
  name: string
  category: string
  tags: string[]
  pack: string
  thumbnail?: string | null
}

// Fetch (engine-side) the asset-packs catalog and return the slim asset index for a picker.
export async function fetchCatalog(): Promise<CatalogEntry[]> {
  const reply = await BevyApi.consoleCommand('asset_catalog')
  const parsed = JSON.parse(reply) as unknown
  return Array.isArray(parsed) ? (parsed as CatalogEntry[]) : []
}

// The asset-packs self-reference token is the exact string '{self}'.
function isSelf(v: unknown): boolean {
  return v === '{self}'
}

// Recursively replace exact '{self}' string refs with the (new) entity id. Mirrors the Hub's
// resolveSelfReferences — handles e.g. a Material videoTexture's videoPlayerEntity.
function resolveSelfReferences(obj: unknown, entityId: number): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return isSelf(obj) ? entityId : obj
  if (Array.isArray(obj)) return obj.map((v) => resolveSelfReferences(v, entityId))
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = resolveSelfReferences(v, entityId)
    }
    return out
  }
  return obj
}

// Resolve a Trigger id-reference token to the generated id: `{self:Comp}` -> this entity's Comp id,
// `{N:Comp}` -> entity N's Comp id (Comp is the composite/editor name, e.g. asset-packs::Actions).
function mapTriggerId(token: unknown, oldEid: number, genIds: Map<string, number>): unknown {
  if (typeof token !== 'string') return token
  const self = token.match(/^\{self:(.+)\}$/)
  if (self) return genIds.get(`${self[1]}:${oldEid}`) ?? token
  const cross = token.match(/^\{(\d+):(.+)\}$/)
  if (cross) return genIds.get(`${cross[2]}:${cross[1]}`) ?? token
  return token
}

// Rewrite a Triggers value's condition/action id references via mapTriggerId.
function remapTriggers(value: unknown, oldEid: number, genIds: Map<string, number>): unknown {
  const v = value as { value?: Array<Record<string, unknown>> } | undefined
  if (!v || !Array.isArray(v.value)) return value
  const triggers = v.value.map((trigger) => {
    const t = trigger as {
      conditions?: Array<Record<string, unknown>>
      actions?: Array<Record<string, unknown>>
    }
    return {
      ...t,
      conditions: (t.conditions ?? []).map((c) => ({ ...c, id: mapTriggerId(c.id, oldEid, genIds) })),
      actions: (t.actions ?? []).map((a) => ({ ...a, id: mapTriggerId(a.id, oldEid, genIds) }))
    }
  })
  return { ...(value as Record<string, unknown>), value: triggers }
}

// Highest asset-packs id currently in the scene — the id sequence lives in Counter.value on the
// root and each id-bearing component carries its assigned id; new ids continue past this.
function currentMaxAssetId(snapshot: Snapshot): number {
  let max = 0
  for (const comps of Object.values(snapshot)) {
    for (const name of COMPONENTS_WITH_ID) {
      const c = comps[name] as { id?: unknown } | undefined
      if (c && typeof c.id === 'number') max = Math.max(max, c.id)
    }
    const counter = comps['asset-packs::Counter'] as { value?: unknown } | undefined
    if (counter && typeof counter.value === 'number') max = Math.max(max, counter.value)
  }
  return max
}

// Highest NetworkEntity id in the scene — sync entities get the next id past this (the inspector's
// enum-entity sequence starts at 8001), so network ids stay unique. Mirrors getNextEnumEntityId.
function currentMaxNetworkId(snapshot: Snapshot): number {
  let max = NETWORK_ID_START
  for (const comps of Object.values(snapshot)) {
    const n = comps[NETWORK_ENTITY] as { entityId?: unknown } | undefined
    if (n && typeof n.entityId === 'number') max = Math.max(max, n.entityId)
  }
  return max
}

// Import catalog asset `assetId` into the current scene, parented under `parent` (0 = scene root),
// and select its root. Requires fetchCatalog() to have run (so the engine cached the catalog).
export async function importAsset(assetId: string, parent = 0, assetName = 'Asset'): Promise<void> {
  const reply = await BevyApi.consoleCommand('init_asset', [assetId])
  const parsed = JSON.parse(reply) as {
    baseDir: string
    composite: Composite
    written?: number
    errors?: string[]
  }
  const { composite } = parsed
  // The engine pushes the asset's files to the scene folder at import (so it renders without a
  // save/reload). Surface that outcome — especially failures (e.g. a denied directory pick).
  console.log(`[import ${assetId}] ${parsed.written ?? 0} file(s) written`)
  if (parsed.errors && parsed.errors.length > 0) {
    console.error(`[import ${assetId}] ${parsed.errors.join('; ')}`)
  }
  if (!composite || !Array.isArray(composite.components)) return

  // --- gather every composite entity, its Transform, Name, and (mapped) components ---
  const entityIds = new Set<number>()
  const transforms = new Map<number, TransformJson>()
  const names = new Map<number, string>()
  const comps = new Map<number, Map<string, unknown>>() // entity -> (editorName -> value)

  for (const comp of composite.components) {
    for (const [eidStr, cell] of Object.entries(comp.data)) {
      const eid = Number(eidStr)
      if (!Number.isFinite(eid)) continue
      entityIds.add(eid)
      const json = cell?.json

      if (comp.name === TRANSFORM) {
        const t = (json ?? {}) as TransformJson
        transforms.set(eid, t)
        if (typeof t.parent === 'number') entityIds.add(t.parent)
        continue
      }
      if (comp.name === COMPOSITE_NAME) {
        const v = json as { value?: string } | undefined
        if (v && typeof v.value === 'string') names.set(eid, v.value)
        continue
      }
      const editorName = editorNameForComposite(comp.name)
      if (editorName === undefined) {
        console.error(`import: unknown component ${comp.name}, skipped`)
        continue
      }
      let m = comps.get(eid)
      if (!m) {
        m = new Map()
        comps.set(eid, m)
      }
      m.set(editorName, json)
    }
  }

  const ordered = [...entityIds].sort((a, b) => a - b)
  // A root has no Transform, or a parent that isn't itself part of the composite.
  const isRoot = (eid: number): boolean => {
    const p = transforms.get(eid)?.parent
    return typeof p !== 'number' || !entityIds.has(p)
  }
  const roots = ordered.filter(isRoot)

  // --- phase 1: allocate all entities (Name-seeded) so parent refs can be remapped ---
  const newIds = await allocateNamedEntities(
    ordered.map((eid) => ({ value: names.get(eid) ?? `Entity_${eid}` }))
  )
  const idMap = new Map<number, number>()
  ordered.forEach((eid, i) => {
    const n = newIds[i]
    if (n != null) idMap.set(eid, n)
  })

  // Multiple roots get a shared wrapper entity (like the Hub) so the import is one selectable/movable
  // object; a single root is used directly.
  let wrapperNew: number | null = null
  if (roots.length > 1) {
    const [w] = await allocateNamedEntities([{ value: `${assetName}_root` }])
    if (w != null) {
      wrapperNew = w
      await writeComponent(
        String(w),
        'Transform',
        JSON.stringify({
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
          parent
        })
      )
    }
  }

  // Assign fresh scene-unique ids to id-bearing components whose id is '{self}', so Triggers
  // references ({self:Comp} / {N:Comp}) can be remapped to them. Keyed by `${editorName}:${oldEid}`.
  const genIds = new Map<string, number>()
  let nextId = currentMaxAssetId(state.snapshot)
  let nextNet = currentMaxNetworkId(state.snapshot)
  for (const eid of ordered) {
    const m = comps.get(eid)
    if (!m) continue
    for (const name of COMPONENTS_WITH_ID) {
      const v = m.get(name) as { id?: unknown } | undefined
      if (v && isSelf(v.id)) {
        nextId += 1
        genIds.set(`${name}:${eid}`, nextId)
      }
    }
  }
  // Advance the scene's id sequence (Counter.value on the root) past the ids we just assigned, so a
  // later getNextId (Hub / runtime) can't reuse them. Only updates an existing root Counter.
  if (genIds.size > 0) {
    const rootCounter = state.snapshot['0']?.['asset-packs::Counter'] as
      | Record<string, unknown>
      | undefined
    if (rootCounter && typeof rootCounter.value === 'number' && nextId > rootCounter.value) {
      try {
        await writeComponent('0', 'asset-packs::Counter', JSON.stringify({ ...rootCounter, value: nextId }))
      } catch (e) {
        console.error('import: failed to advance root Counter:', e)
      }
    }
  }

  // --- phase 2: write a (parent-remapped) Transform and the remaining components per entity ---
  let mainNew: number | null = null
  for (const eid of ordered) {
    const newId = idMap.get(eid)
    if (newId === undefined) continue
    const newIdStr = String(newId)

    // Remap parent: composite-local id -> its new id; roots attach to the wrapper (or the target).
    // Fill identity defaults for any missing Transform fields (a partial write would leave scale 0
    // -> invisible), matching the Hub's addChild.
    const t = transforms.get(eid)
    const parentNew = isRoot(eid) ? wrapperNew ?? parent : idMap.get(t!.parent as number) ?? parent
    const transformValue = {
      position: t?.position ?? { x: 0, y: 0, z: 0 },
      rotation: t?.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
      scale: t?.scale ?? { x: 1, y: 1, z: 1 },
      parent: parentNew
    }
    await writeComponent(newIdStr, 'Transform', JSON.stringify(transformValue))

    const m = comps.get(eid)
    if (m) {
      for (const [editorName, raw] of m) {
        // SyncComponents: its value is a list of component NAMES — resolve them to component ids,
        // and pair it with a NetworkEntity (a fresh enum-entity id) so the runtime syncs this entity.
        if (editorName === SYNC_COMPONENTS) {
          const raw_names = (raw as { value?: unknown }).value
          const componentIds = (Array.isArray(raw_names) ? raw_names : [])
            .filter((n): n is string => typeof n === 'string')
            .map(componentIdForName)
            .filter((id): id is number => id !== undefined)
          try {
            await writeComponent(newIdStr, SYNC_COMPONENTS, JSON.stringify({ componentIds }))
            nextNet += 1
            await writeComponent(
              newIdStr,
              NETWORK_ENTITY,
              JSON.stringify({ entityId: nextNet, networkId: 0 })
            )
          } catch (e) {
            console.error(`import: failed to write sync components on ${newIdStr}:`, e)
          }
          continue
        }
        // Smart-item wiring (Actions/Triggers/States/Counter…) is intentionally
        // dropped — imports are plain models; behavior is the scene code's job.
        if (editorName.startsWith('asset-packs::')) continue
        let value = raw
        // id-bearing component: stamp its generated id
        if (COMPONENTS_WITH_ID.has(editorName)) {
          const gen = genIds.get(`${editorName}:${eid}`)
          if (gen !== undefined) value = { ...(value as Record<string, unknown>), id: gen }
        }
        // triggers: remap condition/action id references to the generated ids
        if (editorName === TRIGGERS) value = remapTriggers(value, eid, genIds)
        // remaining '{self}' refs -> the new entity id
        value = resolveSelfReferences(value, newId)
        try {
          await writeComponent(newIdStr, editorName, JSON.stringify(value))
        } catch (e) {
          console.error(`import: failed to write ${editorName} on ${newIdStr}:`, e)
        }
      }
    }

    if (mainNew === null && isRoot(eid)) mainNew = newId
  }
  if (wrapperNew !== null) mainNew = wrapperNew

  // Wait (bounded) for the scene to tick the imported entities in, then select the root.
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(150)
    await reloadSnapshot()
    if (mainNew === null || state.snapshot[String(mainNew)] !== undefined) break
  }
  if (mainNew !== null) {
    const eid = String(mainNew)
    state.selected.clear()
    state.selected.add(eid)
    state.activeEntity = eid
    selectEntityInTree(state.snapshot, eid)
  }
}
