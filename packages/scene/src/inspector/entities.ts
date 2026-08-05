import { cmd } from '../cmd'
import { buildComposite } from '../composite'
import { INERT_BACKUP_COMPONENT } from '../inert'
import { NAME_COMPONENT, bumpCustomTimestamp, createCustomDefault, customComponentId, customTimestamp, encodeCustomComponent, isCustomComponent } from '../custom-components'
import { buildEditedJson } from '../fields'
import { captureTransformDefaults, getSchema } from '../schema'
import { type ComponentKey, type Snapshot, clearComponentEdits, componentKey, deleteSnapshotComponent, markComponentDeleted, markEdited, parentOf, selectEntityInTree, setComponentExpanded, setEditStatus, setSchema, setSelected, state, topLevelSelected } from '../state'
import { sleep } from '../utils'
import { invalidatePickLayer } from '../viewport/pick-layer'
import { localRelativeTo } from '../world-pos'
import { refresh } from './boot'
import { composeIntoGrandparent, directChildren, readTransform, type TransformValue } from './transform'
import { SETTLE_MS, applyLocalComponent, onComponentDeleted, reloadAfter, reloadSnapshot, writeComponent, writeDelete } from './writes'

// Add a component, seeded with its full default shape. /component_default returns
// every field at its zero/default (serde emits the full tree — unset scalars 0/""/
// false, optional/message/oneof null, repeated []), so the field editor has all the
// fields to edit immediately, even while paused (the write itself still encodes the
// proto default). Falls back to `{}` if the default fetch fails. The new component is
// expanded so it's ready to edit. No-op if the entity already has it.
export async function addComponent(entityId: string, name: string): Promise<void> {
  if (state.snapshot[entityId]?.[name] !== undefined) return
  const key = componentKey(entityId, name)
  setComponentExpanded(key, true)

  // Custom components aren't known to the engine — seed their default from the SDK schema locally.
  // Protocol components fetch the engine's full default shape (falls back to `{}` on failure).
  let json = '{}'
  if (isCustomComponent(name)) {
    json = JSON.stringify(createCustomDefault(name) ?? {})
  } else {
    try {
      const reply = await cmd.componentDefault(name)
      JSON.parse(reply) // validate before adopting it
      json = reply
    } catch (e) {
      console.error('component_default failed (using {}):', name, e)
    }
  }

  try {
    await writeComponent(entityId, name, json)
    await reloadAfter()
  } catch (e) {
    console.error('add_component failed:', name, e)
  }

  // Seed any `@transform.*` fields (e.g. a Tween's start/end) from the entity's current
  // Transform once, so they capture the placement at creation instead of live-tracking it.
  // Needs the schema; fetch it if it isn't cached yet.
  try {
    if (getSchema(name) === undefined) {
      const reply = await cmd.componentSchema(name)
      setSchema(name, JSON.parse(reply))
    }
    captureTransformDefaults(key)
  } catch {
    /* no schema → nothing to capture */
  }
}

// --- add entity ---

// Allocate `count` fresh entity ids from the engine's authoritative allocator (collision-free,
// correctly generationed), each instantiated scene-side with the given component so @dcl/ecs adopts
// it. Returns the proto-u32 ids (matching the snapshot's keys).
async function newEntityIds(
  componentId: number,
  base64: string,
  count: number
): Promise<number[]> {
  return await cmd.newEntity(componentId, base64, count)
}

// Create one or more authored entities, returning their ids. Each spec is a componentName -> value
// map (snapshot/decoded form).
//
// Each entity is allocated *and* instantiated by the engine via /new_entity: the engine's allocator
// hands out a collision-free, correctly-generationed id and writes the entity's Name scene-side, so
// the scene's @dcl/ecs adopts it on receive (before its next tick) — no scene freeze needed. The
// remaining components are then written normally; the Name write is recorded in the changelog so the
// new entity persists on save. inspector::Nodes is NOT touched here — it's regenerated from the
// Transform hierarchy at save time (see buildComposite), so it never shows as a session edit.
// Allocate `names.length` fresh entities, each instantiated engine-side with its Name (via
// /new_entity, so @dcl/ecs adopts it before the next tick) and the Name recorded as our edit so it
// persists on save. Returns the new ids 1:1 with `names` (null where allocation failed). Shared by
// single-entity creation and composite import (which needs all ids up front to remap parent refs).
export async function allocateNamedEntities(
  names: Array<{ value: string }>
): Promise<Array<number | null>> {
  const nameId = customComponentId(NAME_COMPONENT)
  const out: Array<number | null> = []
  for (const name of names) {
    const nameBytes =
      nameId !== undefined ? encodeCustomComponent(NAME_COMPONENT, name) : undefined
    if (nameId === undefined || nameBytes === undefined) {
      console.error('allocateNamedEntities: cannot encode Name to instantiate entity')
      out.push(null)
      continue
    }
    const [id] = await newEntityIds(nameId, nameBytes, 1)
    if (id === undefined) {
      out.push(null)
      continue
    }
    const eid = String(id)
    // replace, don't mutate: the reactive proxy only traps top-level assignment
    // (reactive.ts:36-43), and the hierarchy now derives its layout from provenance
    state.createdEntities = new Set(state.createdEntities).add(eid)
    applyLocalComponent(eid, NAME_COMPONENT, JSON.stringify(name))
    markEdited(eid, NAME_COMPONENT, JSON.parse(JSON.stringify(name)))
    out.push(id)
  }
  return out
}

export async function createEntities(
  specs: Array<Record<string, unknown>>
): Promise<number[]> {
  if (specs.length === 0) return []
  const ids: number[] = []
  try {
    for (const components of specs) {
      const name = (components[NAME_COMPONENT] ?? { value: 'Entity' }) as { value: string }
      const [id] = await allocateNamedEntities([name])
      if (id === null || id === undefined) continue
      ids.push(id)
      const eid = String(id)

      for (const [n, value] of Object.entries(components)) {
        if (n === NAME_COMPONENT) continue // already instantiated above
        await writeComponent(eid, n, JSON.stringify(value))
      }
    }

    // Running scenes: wait (bounded) for the scene to tick the new entities in
    // before refetching, so a refetch doesn't briefly drop them. Frozen scenes
    // must NOT refetch — /crdt_snapshot is stale there and would clobber the
    // optimistic components just written (e.g. the Transform parent).
    if (!state.frozen) {
      const last = ids.length > 0 ? String(ids[ids.length - 1]) : null
      for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(SETTLE_MS)
        await reloadSnapshot()
        if (last === null || state.snapshot[last] !== undefined) break
      }
    }
  } catch (e) {
    console.error('create_entities failed:', e)
  }
  return ids
}

// Duplicate an entity and its entire subtree. Every authored component is cloned
// (editor-only inspector:: state excluded, except the prefab marker); Transform.parent
// refs that point inside the subtree are remapped to the freshly-allocated ids so the
// hierarchy is reproduced. The new root keeps the original's parent and is nudged +1m.
// Returns the new root id (null if allocation failed).
// A detached copy of an entity subtree: every authored component, deep-cloned, so
// it survives the source being edited or deleted. Copy/paste holds one of these;
// duplicate makes one and instantiates it immediately.
export interface EntityClip {
  rootId: string
  order: string[] // breadth-first: parents precede their children
  components: Record<string, Record<string, unknown>>
}

// inspector:: components are editor tooling state and don't travel with a copy — except
// CustomAsset (the prefab identity: without it the copy is no longer a prefab instance)
// and Folder (a duplicated folder that arrives as a plain entity has lost its point).
const COPIED_INSPECTOR_COMPONENTS: readonly string[] = ['inspector::CustomAsset', 'inspector::Folder']

// `deep: false` captures the root alone — what the delete variants that leave the
// children in the scene need, since copying them into the clip would restore
// duplicates of entities that never went away.
export function captureEntityTree(rootId: string, opts?: { deep?: boolean }): EntityClip | null {
  const snap = state.snapshot
  if (snap[rootId] === undefined) return null

  const order: string[] = [rootId]
  if (opts?.deep !== false) {
    const queue = directChildren(rootId)
    while (queue.length > 0) {
      const id = queue.shift() as string
      order.push(id)
      for (const c of directChildren(id)) queue.push(c)
    }
  }

  const components: Record<string, Record<string, unknown>> = {}
  for (const id of order) {
    components[id] = JSON.parse(JSON.stringify(snap[id] ?? {})) as Record<string, unknown>
  }
  return { rootId, order, components }
}

export async function duplicateEntityTree(rootId: string): Promise<string | null> {
  const clip = captureEntityTree(rootId)
  return clip === null ? null : await instantiateEntityTree(clip)
}

// Create a fresh subtree from a clip: allocate ids, then write every component
// with internal parent refs remapped onto the new ids.
// `exact` reproduces the clip where it stood — same name, same place. That's a
// restore (undoing a delete); the default is a copy, which is renamed and nudged
// off the original so the creator can see it landed.
export async function instantiateEntityTree(
  clip: EntityClip,
  opts?: { exact?: boolean }
): Promise<string | null> {
  const { rootId, order } = clip
  const snap = clip.components
  const exact = opts?.exact === true

  const names = order.map((id) => {
    const base = (snap[id]?.[NAME_COMPONENT] as { value?: string } | undefined)?.value ?? 'Entity'
    return { value: id === rootId && !exact ? `${base} copy` : base }
  })

  const newIds = await allocateNamedEntities(names)
  const idMap = new Map<string, number>()
  for (let i = 0; i < order.length; i++) {
    const nid = newIds[i]
    if (nid !== null && nid !== undefined) idMap.set(order[i], nid)
  }

  try {
    // entities are already allocated, so component writes are independent — fire
    // them in parallel and await once, instead of E×C serialized round-trips
    const writes: Array<Promise<void>> = []
    for (const oldId of order) {
      const newId = idMap.get(oldId)
      const comps = snap[oldId]
      if (newId === undefined || comps === undefined) continue
      const eid = String(newId)
      for (const [name, value] of Object.entries(comps)) {
        if (name === NAME_COMPONENT) continue // set during allocation
        // A copy sheds editor tooling state; an EXACT restore must reproduce the
        // entity verbatim — dropping inspector::Inert quietly moved an undone
        // delete from "When spawned" to "From the start". InertBackup never
        // travels either way: restoreInert strips it from every snapshot a
        // capture could see, so meeting one here means it is already stale.
        if (name === INERT_BACKUP_COMPONENT) continue
        if (name.startsWith('inspector::') && !exact && !COPIED_INSPECTOR_COMPONENTS.includes(name)) continue
        const clone = JSON.parse(JSON.stringify(value)) as unknown
        if (name === 'Transform') {
          const t = clone as TransformValue
          const mapped = idMap.get(String(t.parent ?? 0))
          if (mapped !== undefined) {
            t.parent = mapped // internal ref → the duplicated parent
          } else if (oldId === rootId) {
            // a restore keeps its parent (that entity is still there) and its
            // position — moving it would make undo a lie
            if (!exact) {
              const p = t.position ?? { x: 0, y: 0, z: 0 }
              t.position = { ...p, x: p.x + 1 } // nudge the new root so it's visible
            }
          } else {
            // the intended parent's copy is missing (its allocation failed) — keep
            // this child inside the duplicate (under the new root, else scene root)
            // rather than leaving t.parent pointing at the ORIGINAL source entity,
            // which would graft copied children onto the source hierarchy
            t.parent = idMap.get(rootId) ?? 0
          }
        }
        writes.push(writeComponent(eid, name, JSON.stringify(clone)))
      }
    }
    await Promise.all(writes)
  } catch (e) {
    console.error('duplicate_entity failed:', e)
  }

  const newRoot = idMap.get(rootId)
  if (!state.frozen && newRoot !== undefined) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(SETTLE_MS)
      await reloadSnapshot()
      if (state.snapshot[String(newRoot)] !== undefined) break
    }
  }
  return newRoot === undefined ? null : String(newRoot)
}

// Create a single authored entity with a default Transform (parented under `parent`, 0 = scene
// root) and a Name, then select it. Mirrors the Hub's addChild operation.
//
// `position` is LOCAL to `parent`. The caller supplies it for a scene-root entity
// so a new entity lands where the creator is looking, the same way an imported
// model does; omitting it means the parent's origin, which is where a child
// belongs.
export async function addEntity(
  name: string,
  parent: number,
  position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): Promise<void> {
  const ids = await createEntities([
    {
      // Full default Transform (explicit scale 1 — a partial write would leave scale 0 → invisible).
      Transform: {
        position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        parent
      },
      [NAME_COMPONENT]: { value: name || 'Entity' }
    }
  ])
  if (ids.length > 0) {
    const eid = String(ids[0])
    setSelected([eid])
    state.activeEntity = eid
    // expand ancestors and scroll the tree to the new row
    selectEntityInTree(state.snapshot, eid)
  }
}

// Remove a component from an entity (optimistic local removal + /delete_component).
export function deleteComponent(entityId: string, name: string): void {
  const prevRaw = state.snapshot[entityId]?.[name]
  const prev = prevRaw === undefined ? undefined : (JSON.parse(JSON.stringify(prevRaw)) as unknown)
  deleteSnapshotComponent(entityId, name)
  // deleting a collider takes the editor's pick-collider overlay with it
  invalidatePickLayer(entityId, name)
  onComponentDeleted?.(entityId, name, prev)
  const key = componentKey(entityId, name)
  setComponentExpanded(key, false)
  clearComponentEdits(key)
  markComponentDeleted(entityId, name)
  // the delete tombstones the component engine-side at the next LWW counter —
  // remember that so a re-add doesn't send a stale timestamp and get rejected
  if (isCustomComponent(name)) {
    bumpCustomTimestamp(entityId, name, customTimestamp(entityId, name) + 1)
  }
  cmd.deleteComponent(entityId, name).catch((e) => {
    console.error('delete_component failed:', name, e)
  })
}

// Write a component value via /set_component, then refresh so the tree reflects
// it. `json` is validated (and compacted) client-side first. Records the outcome
// in state.editStatus[key].
export async function setComponentValue(
  key: ComponentKey,
  entityId: string,
  name: string,
  json: string
): Promise<void> {
  let compact: string
  try {
    compact = JSON.stringify(JSON.parse(json))
  } catch (e) {
    setEditStatus(key, 'invalid JSON')
    return
  }

  try {
    await writeComponent(entityId, name, compact)
    setEditStatus(key, '✓ set')
    clearComponentEdits(key)
    await reloadAfter()
  } catch (e) {
    setEditStatus(key, String(e))
  }
}

// --- save ---

// Which of the three deletes ran — undo has to put back what that one took, and
// redo has to take it away the same way.
export type DeleteMode = 'entity' | 'subtree' | 'keep-children'

// A deletion, captured so it can be undone. The engine owns id allocation, so a
// restore comes back under FRESH ids; everything that referred to the old ones
// (`children`, and the step's own `live` id) is remapped as it replays.
export interface EntityRestore {
  clip: EntityClip
  mode: DeleteMode
  // entities that outlive the delete but point at it: their Transform as it stood
  // before, re-parented onto the restored entity when undone. Empty for 'subtree',
  // where the children are in the clip.
  children: Array<{ entityId: string; before: unknown }>
  // the live incarnation's root — the original id until an undo re-creates it
  live: string | null
}

// Snapshot a delete BEFORE it runs (it reads state that the delete is about to
// remove). Null when there's nothing there to capture.
export function captureEntityDelete(id: string, mode: DeleteMode): EntityRestore | null {
  const clip = captureEntityTree(id, { deep: mode === 'subtree' })
  if (clip === null) return null
  const children =
    mode === 'subtree'
      ? []
      : directChildren(id)
          .filter((childId) => state.snapshot[childId]?.Transform !== undefined)
          .map((childId) => ({
            entityId: childId,
            before: JSON.parse(JSON.stringify(state.snapshot[childId].Transform)) as unknown
          }))
  return { clip, mode, children, live: id }
}

// Undo: re-create the subtree where it was, then hand its children back.
export async function restoreEntityDelete(step: EntityRestore): Promise<string | null> {
  const newRoot = await instantiateEntityTree(step.clip, { exact: true })
  if (newRoot === null) return null
  for (const child of step.children) {
    const t = JSON.parse(JSON.stringify(child.before)) as TransformValue
    t.parent = Number(newRoot) // the old parent id died with the entity
    try {
      await writeComponent(child.entityId, 'Transform', JSON.stringify(t))
    } catch (e) {
      console.error('restoring child parent failed:', child.entityId, e)
    }
  }
  return newRoot
}

// Redo: delete it again, the same way it went the first time.
export async function replayEntityDelete(step: EntityRestore): Promise<void> {
  const id = step.live
  if (id === null) return
  if (step.mode === 'subtree') await deleteEntityRecursive(id)
  else if (step.mode === 'keep-children') await deleteEntityReparent(id)
  else await deleteEntity(id)
}

// Delete just the entity. Its children are left parented to the (now gone)
// entity — use deleteEntityReparent to keep them, or recursive to remove them.
export async function deleteEntity(id: string): Promise<void> {
  state.deleteConfirm = null
  try {
    await writeDelete(id, false)
  } catch (e) {
    console.error('delete_entity failed:', e)
  }
  await reloadAfter([id])
}

export async function deleteEntityRecursive(id: string): Promise<void> {
  state.deleteConfirm = null
  try {
    await writeDelete(id, true)
  } catch (e) {
    console.error('delete_entity -r failed:', e)
  }
  await reloadAfter([id])
}

// Reparent each direct child to the entity's parent (preserving world placement),
// then delete the entity.
export async function deleteEntityReparent(id: string): Promise<void> {
  state.deleteConfirm = null
  const parentT = readTransform(id)
  for (const childId of directChildren(id)) {
    const json = composeIntoGrandparent(parentT, readTransform(childId), parentT.parent)
    try {
      await writeComponent(childId, 'Transform', json)
    } catch (e) {
      console.error('reparent child failed:', childId, e)
    }
  }
  try {
    await writeDelete(id, false)
  } catch (e) {
    console.error('delete_entity failed:', e)
  }
  await reloadAfter([id])
}

// Whether `ancestor` is an ancestor of `node` in the snapshot hierarchy.
function isAncestorOf(snapshot: Snapshot, ancestor: string, node: string): boolean {
  let cur = parentOf(snapshot, node)
  while (cur !== null) {
    if (cur === ancestor) return true
    cur = parentOf(snapshot, cur)
  }
  return false
}

// Reparent a set of entities under `newParent` ('0' = scene root), preserving
// each item's world placement. Skips entities that would create a cycle (the
// target is one of them or a descendant of one), are already parented there, or
// equal the target. Returns the ids that actually moved.
export async function reparentEntitiesTo(ids: string[], newParent: string): Promise<string[]> {
  const snap = state.snapshot
  const pNum = Number(newParent)
  const targets = ids.filter(
    (c) =>
      c !== newParent &&
      !isAncestorOf(snap, c, newParent) &&
      String(readTransform(c).parent) !== newParent
  )
  for (const c of targets) {
    const local = localRelativeTo(snap, c, newParent)
    const json = JSON.stringify({ ...local, parent: pNum })
    try {
      await writeComponent(c, 'Transform', json)
    } catch (e) {
      console.error('reparent failed:', c, e)
    }
  }
  if (targets.length > 0) await reloadAfter()
  return targets
}

// Reparent the selection under the active entity, preserving each item's world
// placement. Only top-level selected entities move (a selected sub-tree stays
// intact); the active entity, its ancestors (would cycle), and entities already
// parented to it are skipped.
export async function reparentSelectionToActive(): Promise<void> {
  const active = state.activeEntity
  if (active === null || state.selected.size < 2) return
  await reparentEntitiesTo(topLevelSelected(state.snapshot), active)
}

// Detach each selected entity to the scene root (parent 0), preserving world
// placement. Entities already at root are skipped. The new parent (root) is
// always uniform, so this is exact except for a child that was sheared under a
// non-uniformly-scaled parent — which can't keep its shape outside it anyway.
export async function clearParentOfSelection(): Promise<void> {
  const snap = state.snapshot
  const targets = [...state.selected].filter((id) => (readTransform(id).parent ?? 0) !== 0)
  for (const id of targets) {
    const local = localRelativeTo(snap, id, '0')
    const json = JSON.stringify({ ...local, parent: 0 })
    try {
      await writeComponent(id, 'Transform', json)
    } catch (e) {
      console.error('clear parent failed:', id, e)
    }
  }
  await reloadAfter()
}

// Apply structured-editor edits: rebuild the JSON from the snapshot value shape
// + per-field edits, then write it.
export async function applyStructuredEdits(
  key: ComponentKey,
  entityId: string,
  name: string,
  value: unknown
): Promise<void> {
  const built = buildEditedJson(key, value)
  if (!built.ok) {
    setEditStatus(key, built.error)
    return
  }
  await setComponentValue(key, entityId, name, built.json)
}
