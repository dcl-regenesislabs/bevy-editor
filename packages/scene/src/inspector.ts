import { cmd } from './cmd'
import { log } from './log'
import { autoLogin } from './login'
import { applyGraphicsPreset } from './graphics-preset'
import { getCurrentInspectableScene } from './current-scene'
import {
  state,
  clearComponentEdits,
  componentKey,
  primeScroll,
  parentOf,
  topLevelSelected,
  markEdited,
  markComponentDeleted,
  markEntityDeleted,
  resetSaveChangelog,
  selectEntityInTree,
  setSelected,
  setComponentExpanded,
  setEditStatus,
  setSnapshotComponent,
  deleteSnapshotComponent,
  deleteSnapshotEntity,
  setSchema,
  type ComponentKey,
  type Snapshot
} from './state'
import { buildEditedJson } from './fields'
import {
  decodeCustomComponents,
  isCustomComponent,
  customComponentId,
  customTimestamp,
  bumpCustomTimestamp,
  encodeCustomComponent,
  createCustomDefault,
  stringToBase64,
  NAME_COMPONENT
} from './custom-components'
import { buildComposite, unknownComponentNames } from './composite'
import {
  computeSaveDiff,
  buildAuthoredFromSelection,
  defaultSelection,
  type DiffRow,
  type DiffSource
} from './save-diff'
import { getSchema, captureTransformDefaults, loadSchema, toSdkValue } from './schema'
import { stripPickColliders } from './viewport/pick-layer'
import { localRelativeTo } from './world-pos'
import { sleep } from './utils'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { rotateVec3ByQuat } from './camera/perspective-to-screen'

// Boot sequence: log in, then load the current scene's component state.
export async function startInspector(): Promise<void> {
  state.status = 'logging-in'
  // Force the Low graphics preset before the heavy scene renders: the default
  // (Medium) crashes the WebGPU renderer on some scenes (invalid shadow_pass →
  // poisoned Queue.Submit → blank viewport). Best-effort, never blocks boot.
  void applyGraphicsPreset('Low')
  await autoLogin()
  await refresh()
  // Best-effort, independent of the scene — populates the add-component picker.
  loadComponentNames().catch(console.error)
}

// Boot resolution races a still-loading scene. A large scene (e.g. a Genesis
// Plaza plaza) isn't registered / the player isn't placed in it / its CRDT isn't
// queryable for the first several seconds after entry — so a single resolve+
// snapshot attempt lands on "no scene" or a transient /crdt_snapshot stall and,
// with no retry, wedges the editor at "Loading scene…" forever even though the
// exact same commands succeed a moment later. Retry until it lands, with a
// per-attempt timeout so a hanging command just triggers another try.
const SCENE_BOOT_TIMEOUT_MS = 90_000
const SCENE_BOOT_RETRY_MS = 1_500
const CMD_ATTEMPT_TIMEOUT_MS = 8_000

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// Pull + decode one snapshot. Sets state.snapshot + status 'ready' and returns
// true on success; records the error and returns false (leaving status alone) on
// failure, so the boot loop can retry. Bounded so a hanging command can't stall
// the retry loop.
async function pullSnapshot(): Promise<boolean> {
  try {
    const snapshot = await withTimeout(cmd.crdtSnapshot(), CMD_ATTEMPT_TIMEOUT_MS, 'crdt_snapshot')
    // drop the editor's pick-collider overlay (CL_RESERVED6) so the logical view
    // and save never see it (click-select writes it engine-only for raycasting).
    stripPickColliders(snapshot)
    decodeCustomComponents(snapshot)
    state.snapshot = snapshot
    state.status = 'ready'
    primeScroll()
    return true
  } catch (e) {
    state.error = String(e)
    return false
  }
}

// Resolve the current non-portable scene, pin it as the inspection target, then
// pull a fresh CRDT snapshot — retrying both until the (possibly still-loading)
// scene actually answers, or SCENE_BOOT_TIMEOUT_MS elapses.
export async function refresh(): Promise<void> {
  state.status = 'loading-snapshot'
  state.error = ''
  const deadline = Date.now() + SCENE_BOOT_TIMEOUT_MS
  let resolvedEver = false

  for (let attempt = 1; ; attempt++) {
    let scene: Awaited<ReturnType<typeof getCurrentInspectableScene>>
    try {
      scene = await withTimeout(getCurrentInspectableScene(), CMD_ATTEMPT_TIMEOUT_MS, 'resolve scene')
    } catch (e) {
      console.log(`[boot] resolve attempt ${attempt} errored: ${String(e)}`)
      scene = undefined
    }

    if (scene !== undefined) {
      resolvedEver = true
      state.scene = scene
      // Pin the inspection target so subsequent snapshots/edits stay on this
      // scene even if the player wanders out of its parcels.
      try {
        await cmd.setScene(scene.hash)
      } catch (e) {
        console.error('set_scene failed:', e)
      }
      await syncFrozenState()
      if (await pullSnapshot()) {
        console.log(`[boot] editor ready (attempt ${attempt}, scene ${scene.hash})`)
        return
      }
      console.log(`[boot] snapshot attempt ${attempt} failed (${state.error}); retrying…`)
    } else {
      console.log(`[boot] no inspectable scene yet (attempt ${attempt}) — still loading?`)
    }

    if (Date.now() > deadline) break
    await sleep(SCENE_BOOT_RETRY_MS)
  }

  // Timed out: distinguish "never found a scene" from "found it but the snapshot
  // kept failing" so the UI can label it correctly.
  if (!resolvedEver) {
    state.scene = undefined
    state.status = 'no-scene'
  } else {
    state.status = 'error'
  }
  console.log(`[boot] gave up after ${SCENE_BOOT_TIMEOUT_MS}ms (resolvedEver=${resolvedEver})`)
}

// Sync the local frozen flag from the pinned scene's actual status (it may
// differ from our last action after a scene change or external freeze).
async function syncFrozenState(): Promise<void> {
  try {
    const stats = await cmd.sceneStats()
    state.frozen = /status:\s*blocked/i.test(stats)
  } catch {
    // leave the flag as-is
  }
}

// --- transport controls (freeze / tick / unfreeze the pinned scene) ---

export async function pauseScene(): Promise<void> {
  try {
    await cmd.freezeScene()
    state.frozen = true
  } catch (e) {
    // someone else (e.g. the host page) froze it first — same outcome
    if (String(e).includes('already frozen')) {
      state.frozen = true
      return
    }
    console.error('freeze_scene failed:', e)
  }
}

export async function playScene(): Promise<void> {
  try {
    await cmd.unfreezeScene()
    state.frozen = false
  } catch (e) {
    const msg = String(e)
    if (msg.includes('not frozen')) {
      state.frozen = false
      return
    }
    // Stale pin: the inspected scene entity changed (e.g. after a Stop/reload),
    // so /unfreeze_scene can't resolve it and Play silently no-ops. Re-pin the
    // scene by hash and retry once.
    const hash = state.scene?.hash
    if (msg.includes('no longer exists') && hash !== undefined) {
      try {
        await cmd.setScene(hash)
        await cmd.unfreezeScene()
        state.frozen = false
        return
      } catch (e2) {
        state.saveStatus = `play failed: ${String(e2)}`
        return
      }
    }
    state.saveStatus = `play failed: ${msg}`
    console.error('unfreeze_scene failed:', e)
  }
}

// Advance the frozen scene by `count` ticks, then re-pull the snapshot so the
// tree reflects the stepped frame. The scene re-freezes itself after the ticks.
export async function stepScene(count = 1): Promise<void> {
  try {
    await cmd.tickScene(count)
    state.frozen = true
    await sleep(150)
    await reloadSnapshot()
  } catch (e) {
    console.error('tick_scene failed:', e)
  }
}

// Re-pull the CRDT snapshot for the already-pinned scene (no re-resolve/re-pin).
export async function reloadSnapshot(): Promise<void> {
  if (!(await pullSnapshot())) state.status = 'error'
}

// Reload after a modification. /crdt_snapshot reads the scene's CRDT store, which
// only reflects our edits on the scene's next tick — so reload after a short
// settle. For deletes, retry until the removed ids actually disappear (bounded),
// so the tree can't keep showing a gone entity.
//
// A paused scene never ticks, so it never applies our inbound messages and
// /crdt_snapshot would return the pre-edit state. We instead keep the optimistic
// local snapshot (every edit updates it; see writeComponent/writeDelete) and
// skip the refetch entirely while frozen.
const SETTLE_MS = 150
async function reloadAfter(goneIds: string[] = []): Promise<void> {
  if (state.frozen) return
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(SETTLE_MS)
    await reloadSnapshot()
    if (goneIds.every((id) => !(id in state.snapshot))) return
  }
}

// Apply a component write to the local snapshot so the edit shows immediately,
// independent of whether/when the scene ticks it into its CRDT store. Merge into
// the existing value (rather than replace) so the field key order matches the
// CRDT snapshot — otherwise e.g. Transform.parent would jump in the editor list.
function applyLocalComponent(entityId: string, name: string, json: string): void {
  try {
    const value = JSON.parse(json) as unknown
    const existing = state.snapshot[entityId]?.[name]
    setSnapshotComponent(entityId, name, mergeKeepingOrder(existing, value))
  } catch {
    /* leave the snapshot unchanged on unparseable json */
  }
}

// `{ ...existing, ...value }` for plain objects (keeping existing's key order),
// else just `value`. Exported for the gizmo's optimistic writes.
export function mergeKeepingOrder(existing: unknown, value: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
  return isObj(existing) && isObj(value) ? { ...existing, ...value } : value
}

// Optional observers for local mutations, so a second editor instance (the host
// page UI ↔ the scene) can mirror writes into its own snapshot without a refetch —
// /crdt_snapshot is stale while the scene is frozen, so refetching can't be relied on.
type ComponentWrittenFn = (
  entityId: string,
  name: string,
  json: string,
  // deep-cloned previous value, undefined when the component is new — lets the
  // page build undo history without re-deriving state
  prev?: unknown
) => void
type EntityDeletedFn = (entityId: string, recursive: boolean) => void
let onComponentWritten: ComponentWrittenFn | null = null
let onEntityDeleted: EntityDeletedFn | null = null
export function setMutationObservers(
  componentWritten: ComponentWrittenFn,
  entityDeleted: EntityDeletedFn
): void {
  onComponentWritten = componentWritten
  onEntityDeleted = entityDeleted
}

// Apply a mutation that originated in the other editor instance (over the bus):
// merge into the local snapshot and record it in the changelog, no engine write.
export function applyExternalComponentWrite(entityId: string, name: string, json: string): void {
  applyLocalComponent(entityId, name, json)
  try {
    markEdited(entityId, name, JSON.parse(json))
  } catch {
    /* unparseable — snapshot merge already skipped it */
  }
}

export function applyExternalEntityDelete(entityId: string, recursive: boolean): void {
  removeLocal(entityId, recursive)
}

// Send a component write and reflect it locally (optimistic). Custom (non-engine-managed)
// components — which the engine can't address by name — are encoded with the SDK schema and
// written via /set_component_raw, carrying a timestamp newer than the snapshot's so the write
// wins LWW. Everything else goes through /set_component as JSON.
export async function writeComponent(entityId: string, name: string, json: string): Promise<void> {
  const prevRaw = state.snapshot[entityId]?.[name]
  const prev = prevRaw === undefined ? undefined : (JSON.parse(JSON.stringify(prevRaw)) as unknown)
  applyLocalComponent(entityId, name, json)
  markEdited(entityId, name, JSON.parse(json))
  onComponentWritten?.(entityId, name, json, prev)
  if (isCustomComponent(name)) {
    const id = customComponentId(name)
    const b64 = encodeCustomComponent(name, JSON.parse(json))
    if (id === undefined || b64 === undefined) {
      throw new Error(`cannot encode custom component ${name}`)
    }
    const ts = customTimestamp(entityId, name) + 1
    try {
      await cmd.setComponentRaw(entityId, id, ts, b64)
      bumpCustomTimestamp(entityId, name, ts)
    } catch (e) {
      // LWW counter drift (e.g. a tombstone from a delete in a previous session
      // that the snapshot can't show us) — jump well past it and retry once
      if (!/not newer/i.test(String(e))) throw e
      const retryTs = ts + 64
      await cmd.setComponentRaw(entityId, id, retryTs, b64)
      bumpCustomTimestamp(entityId, name, retryTs)
    }
    return
  }
  await cmd.setComponent(entityId, name, json)
}

// Remove an entity (and, recursively, its descendants) from the local snapshot.
function removeLocal(id: string, recursive: boolean): void {
  if (!recursive) {
    deleteSnapshotEntity(id)
    markEntityDeleted(id)
    return
  }
  const all: string[] = []
  const stack = [id]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    all.push(cur)
    for (const child of directChildren(cur)) stack.push(child)
  }
  for (const r of all) {
    deleteSnapshotEntity(r)
    markEntityDeleted(r)
  }
  // Close the component window if its entity was removed.
  if (state.componentWindow !== null && !(state.componentWindow in state.snapshot)) {
    state.componentWindow = null
  }
}

// Send a delete and reflect it locally (optimistic).
async function writeDelete(id: string, recursive: boolean): Promise<void> {
  removeLocal(id, recursive)
  onEntityDeleted?.(id, recursive)
  await cmd.deleteEntity(id, recursive)
}

// --- add / delete component ---

// Fetch the catalog of editable component names (for the add-component picker).
// Best-effort: leaves the list empty (free-text fallback) on failure.
export async function loadComponentNames(): Promise<void> {
  try {
    state.componentNames = await cmd.componentNames()
  } catch (e) {
    console.error('component_names failed:', e)
  }
}

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
// (editor-only inspector:: state excluded); Transform.parent refs that point
// inside the subtree are remapped to the freshly-allocated ids so the hierarchy
// is reproduced. The new root keeps the original's parent and is nudged +1m on X.
// Returns the new root id (null if allocation failed).
export async function duplicateEntityTree(rootId: string): Promise<string | null> {
  const snap = state.snapshot
  if (snap[rootId] === undefined) return null

  // root + all descendants, breadth-first (parents precede their children)
  const order: string[] = []
  const queue = [rootId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    order.push(id)
    for (const c of directChildren(id)) queue.push(c)
  }

  const names = order.map((id) => {
    const base = (snap[id]?.[NAME_COMPONENT] as { value?: string } | undefined)?.value ?? 'Entity'
    return { value: id === rootId ? `${base} copy` : base }
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
        if (name.startsWith('inspector::')) continue
        const clone = JSON.parse(JSON.stringify(value)) as unknown
        if (name === 'Transform') {
          const t = clone as TransformValue
          const mapped = idMap.get(String(t.parent ?? 0))
          if (mapped !== undefined) {
            t.parent = mapped // internal ref → the duplicated parent
          } else if (oldId === rootId) {
            const p = t.position ?? { x: 0, y: 0, z: 0 }
            t.position = { ...p, x: p.x + 1 } // nudge the new root so it's visible
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
export async function addEntity(name: string, parent: number): Promise<void> {
  const ids = await createEntities([
    {
      // Full default Transform (explicit scale 1 — a partial write would leave scale 0 → invisible).
      Transform: {
        position: { x: 0, y: 0, z: 0 },
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
  deleteSnapshotComponent(entityId, name)
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

// A local scene (served by `dcl start`) has a `b64-`-prefixed hash that decodes to its project path,
// so we can write its files back. A deployed/remote scene has a content hash — nowhere to save to.
export function isLocalScene(): boolean {
  return state.scene?.hash?.startsWith('b64-') ?? false
}

// One-click save: persist the editor's current state without a review dialog.
// Editor-written values win; runtime churn the editor never touched reverts to
// the baseline (defaultSelection), which is what "save my work" means.
export async function saveCompositeDirect(): Promise<void> {
  if (!isLocalScene()) {
    state.saveStatus = 'save needs a local scene (served by `dcl start`)'
    return
  }
  state.saveStatus = 'saving…'
  try {
    if (state.componentNames.length === 0) await loadComponentNames()
    let initial: Snapshot
    if (state.savedBaseline !== null) {
      initial = state.savedBaseline
    } else {
      initial = await cmd.crdtInitial()
      decodeCustomComponents(initial)
    }
    const rows = computeSaveDiff(initial, state.snapshot)
    const selection = new Map<string, DiffSource>()
    for (const row of rows) {
      selection.set(`${row.entityId}/${row.component}`, defaultSelection(row))
    }
    await writeComposite(initial, rows, selection)
  } catch (e) {
    state.saveStatus = `save failed: ${String(e)}`
    throw e
  }
}

// Build the composite from the baseline + the dialog's selections, convert protocol values to SDK
// form, and ship it to /save_composite (the engine owns the destination). Resets the changelog on
// success — the saved state becomes the new baseline.
// Writes the composite string somewhere durable and returns a human-readable
// destination. The default writes through the engine (`/save_composite`, which
// also exports imported-asset files); the host page can inject a writer that
// ships it to the dev server's data-layer instead (auto-save).
export type CompositeWriter = (composite: string) => Promise<string>

const engineCompositeWriter: CompositeWriter = async (composite) =>
  await cmd.saveComposite(stringToBase64(composite))

let compositeWriter: CompositeWriter = engineCompositeWriter
export function setCompositeWriter(writer: CompositeWriter | null): void {
  compositeWriter = writer ?? engineCompositeWriter
}

async function writeComposite(
  initial: Snapshot,
  rows: DiffRow[],
  selection: Map<string, DiffSource>
): Promise<void> {
  state.saveStatus = 'saving…'
  try {
    const authored = buildAuthoredFromSelection(initial, rows, selection)
    // Cache the persisted authored set (snapshot form, before the SDK conversion below mutates it)
    // as the next baseline, so a follow-up save diffs against what we just wrote.
    const newBaseline = JSON.parse(JSON.stringify(authored)) as Snapshot

    // Protocol components are in engine form (a protobuf oneof as `{case: val}` with no `$case`),
    // which the composite loader drops. Convert them to SDK form via each component's schema;
    // custom components are already SDK form (decoded via the SDK schema).
    const protoNames = new Set<string>()
    for (const comps of Object.values(authored)) {
      for (const name of Object.keys(comps)) {
        if (!isCustomComponent(name)) protoNames.add(name)
      }
    }
    await Promise.all([...protoNames].map(loadSchema))
    for (const comps of Object.values(authored)) {
      for (const name of Object.keys(comps)) {
        if (isCustomComponent(name)) continue
        const schema = getSchema(name)
        if (schema !== undefined) comps[name] = toSdkValue(comps[name], schema.root)
      }
    }

    const composite = buildComposite(authored)
    const skipped = unknownComponentNames(authored)
    const path = await compositeWriter(composite)
    // Full (untruncated) save result, incl. the imported-asset export summary, to the browser console.
    console.log(`[save] ${path}`)
    state.savedBaseline = newBaseline
    resetSaveChangelog()
    state.saveStatus =
      skipped.length > 0 ? `saved → ${path} (skipped: ${skipped.join(', ')})` : `saved → ${path}`
  } catch (e) {
    state.saveStatus = `save failed: ${String(e)}`
    throw e
  }
}

// --- gizmo drag commits ---

// Fire a Transform write without awaiting/reloading — used per-frame during a
// gizmo drag (the engine applies it to the bevy entity immediately; the gizmo
// previews from its own computed position).
export function fireTransform(entityId: string, json: string): void {
  // Gizmo drags write the Transform directly (not via writeComponent), so record the edit in the
  // changelog here too — otherwise the save diff treats a gizmo move as runtime churn. Fired every
  // frame of the drag; the last call holds the committed pose.
  markEdited(entityId, 'Transform', JSON.parse(json))
  // Keep the local snapshot current too: while the scene is frozen /crdt_snapshot
  // is stale, so without this the next drag would start from the pre-drag pose.
  applyLocalComponent(entityId, 'Transform', json)
  cmd.setComponent(entityId, 'Transform', json).catch((e) =>
    log.warn('gizmo transform write failed', entityId, e)
  )
}

// --- delete / reparent ---

type V3 = { x: number; y: number; z: number }
type Q = { x: number; y: number; z: number; w: number }
type TransformValue = { position: V3; rotation: Q; scale: V3; parent: number }

function readTransform(id: string): TransformValue {
  const t = state.snapshot[id]?.Transform as Partial<TransformValue> | undefined
  return {
    position: t?.position ?? { x: 0, y: 0, z: 0 },
    rotation: t?.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
    scale: t?.scale ?? { x: 1, y: 1, z: 1 },
    parent: t?.parent ?? 0
  }
}

function directChildren(id: string): string[] {
  const pid = Number(id)
  return Object.keys(state.snapshot).filter(
    (c) => (state.snapshot[c]?.Transform as TransformValue | undefined)?.parent === pid
  )
}

// Express `child` (currently local to `parent`) in `parent`'s parent frame, so
// it keeps its world placement when `parent` is removed: parent ∘ child.
function composeIntoGrandparent(
  parent: TransformValue,
  child: TransformValue,
  grandparent: number
): string {
  const pPos = Vector3.create(parent.position.x, parent.position.y, parent.position.z)
  const pRot = Quaternion.create(parent.rotation.x, parent.rotation.y, parent.rotation.z, parent.rotation.w)
  const pScale = Vector3.create(parent.scale.x, parent.scale.y, parent.scale.z)
  const cPos = Vector3.create(child.position.x, child.position.y, child.position.z)
  const cRot = Quaternion.create(child.rotation.x, child.rotation.y, child.rotation.z, child.rotation.w)
  const cScale = Vector3.create(child.scale.x, child.scale.y, child.scale.z)

  const pos = Vector3.add(pPos, rotateVec3ByQuat(Vector3.multiply(cPos, pScale), pRot))
  const rot = Quaternion.multiply(pRot, cRot)
  const scale = Vector3.multiply(pScale, cScale)

  return JSON.stringify({
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    scale: { x: scale.x, y: scale.y, z: scale.z },
    parent: grandparent
  })
}

// How many direct children an entity has (for the confirm dialog).
export function childCount(id: string): number {
  return directChildren(id).length
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
