import { trace } from '../boot-trace'
import { cmd } from '../cmd'
import { bumpCustomTimestamp, customComponentId, customTimestamp, decodeCustomComponents, encodeCustomComponent, isCustomComponent } from '../custom-components'
import { log } from '../log'
import { deleteSnapshotComponent, deleteSnapshotEntity, markComponentDeleted, markEdited, markEntityDeleted, primeScroll, setSnapshotComponent, state } from '../state'
import { sleep } from '../utils'
import { stripAnimationHolds } from '../viewport/animation-hold'
import { invalidatePickLayer, stripPickColliders } from '../viewport/pick-layer'
import { directChildren } from './transform'

export const SCENE_BOOT_TIMEOUT_MS = 90_000
export const SCENE_BOOT_RETRY_MS = 1_500
export const CMD_ATTEMPT_TIMEOUT_MS = 8_000

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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
export async function pullSnapshot(): Promise<boolean> {
  const started = Date.now()
  // Keep the underlying promise: when the command outlives the timeout the engine
  // is still serialising, and how long it ACTUALLY took is the number that says
  // whether the timeout is too tight for this scene or the channel is wedged.
  const pending = cmd.crdtSnapshot()
  void pending.then((s) => {
    const took = Date.now() - started
    if (took > CMD_ATTEMPT_TIMEOUT_MS) {
      trace('crdt_snapshot (late)', `${took}ms — ${Object.keys(s).length} entities, past the ${CMD_ATTEMPT_TIMEOUT_MS}ms attempt timeout`)
    }
  }, () => {}) // rejection: the awaited path below is what records the failure
  try {
    const snapshot = await withTimeout(pending, CMD_ATTEMPT_TIMEOUT_MS, 'crdt_snapshot')
    const fetched = Date.now()
    // drop the editor's pick-collider overlay (CL_RESERVED6) so the logical view
    // and save never see it (click-select writes it engine-only for raycasting).
    stripPickColliders(snapshot)
    stripAnimationHolds(snapshot)
    decodeCustomComponents(snapshot)
    state.snapshot = snapshot
    state.status = 'ready'
    primeScroll()
    trace(
      'crdt_snapshot',
      `${fetched - started}ms fetch + ${Date.now() - fetched}ms decode — ${Object.keys(snapshot).length} entities`
    )
    return true
  } catch (e) {
    state.error = String(e)
    trace('crdt_snapshot failed', `after ${Date.now() - started}ms — ${String(e)}`)
    return false
  }
}

// What the engine says about the scene it is loading. `blocked({"gltfs loading"})`
// is the answer to "why is a 70-parcel scene not inspectable yet" — it means the
// engine is still pulling models, not that anything is stuck.
export async function traceSceneStats(): Promise<void> {
  try {
    const stats = await withTimeout(cmd.sceneStats(), CMD_ATTEMPT_TIMEOUT_MS, 'scene_stats')
    trace('scene_stats', stats.replace(/\s+/g, ' ').trim().slice(0, 300))
  } catch (e) {
    trace('scene_stats failed', String(e))
  }
}

// Resolve the current non-portable scene, pin it as the inspection target, then
// pull a fresh CRDT snapshot — retrying both until the (possibly still-loading)
// scene actually answers, or SCENE_BOOT_TIMEOUT_MS elapses.
// Re-pull the CRDT snapshot for the already-pinned scene (no re-resolve/re-pin).
export async function reloadSnapshot(): Promise<void> {
  if (!(await pullSnapshot())) state.status = 'error'
}

// The pre-code scene, for telling authored entities from ones the scene's code
// spawned. Best-effort: without it the UI simply shows no provenance.
export async function loadInitialBaseline(): Promise<void> {
  try {
    const initial = await cmd.crdtInitial()
    decodeCustomComponents(initial)
    state.initialBaseline = initial
  } catch (e) {
    log.debug('crdt_initial unavailable — no runtime-entity marking', e)
  }
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
export const SETTLE_MS = 150
export async function reloadAfter(goneIds: string[] = []): Promise<void> {
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
export function applyLocalComponent(entityId: string, name: string, json: string): void {
  try {
    const value = JSON.parse(json) as unknown
    const existing = state.snapshot[entityId]?.[name]
    setSnapshotComponent(entityId, name, mergeKeepingOrder(existing, value))
    invalidatePickLayer(entityId, name)
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
type ComponentDeletedFn = (
  entityId: string,
  name: string,
  // deep-cloned value the component had, undefined when it wasn't in the
  // snapshot — same contract as ComponentWrittenFn's `prev`, so the page can
  // record the removal as an undo step
  prev?: unknown
) => void
let onComponentWritten: ComponentWrittenFn | null = null
let onEntityDeleted: EntityDeletedFn | null = null
export let onComponentDeleted: ComponentDeletedFn | null = null
export function setMutationObservers(
  componentWritten: ComponentWrittenFn,
  entityDeleted: EntityDeletedFn,
  componentDeleted: ComponentDeletedFn
): void {
  onComponentWritten = componentWritten
  onEntityDeleted = entityDeleted
  onComponentDeleted = componentDeleted
}

// Mirror of applyExternalComponentWrite for a deletion arriving over the bus.
export function applyExternalComponentDelete(entityId: string, name: string): void {
  deleteSnapshotComponent(entityId, name)
  markComponentDeleted(entityId, name)
  invalidatePickLayer(entityId, name)
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

// Re-impose the session changelog over a freshly pulled snapshot. A frozen scene's
// /crdt_snapshot lags the editor's writes, so a forced re-pull (resync) would drop
// them — entities placed this session (a prefab, an imported model) would vanish
// from this context's snapshot and the gizmo/pick layer would lose their target.
// Values first, then deletions, so an edit-then-delete ends deleted.
export function overlayEditorChangelog(): void {
  for (const [key, value] of state.editorValues) {
    const slash = key.indexOf('/')
    const entityId = key.slice(0, slash)
    const name = key.slice(slash + 1)
    if (state.deletedEntities.has(entityId)) continue
    const cloned = JSON.parse(JSON.stringify(value)) as unknown
    setSnapshotComponent(entityId, name, mergeKeepingOrder(state.snapshot[entityId]?.[name], cloned))
    invalidatePickLayer(entityId, name)
  }
  for (const key of state.deletedComponents) {
    const slash = key.indexOf('/')
    deleteSnapshotComponent(key.slice(0, slash), key.slice(slash + 1))
  }
  for (const entityId of state.deletedEntities) {
    if (state.snapshot[entityId] !== undefined) removeLocal(entityId, false)
  }
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
export async function writeDelete(id: string, recursive: boolean): Promise<void> {
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
