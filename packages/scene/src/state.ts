import { engine } from '@dcl/sdk/ecs'
import { reactive } from './reactive'
import { type LiveSceneInfo } from './bevy-api/interface'
import { type HoverHint } from './bridge-protocol'

// crdt_snapshot shape: { "<entityId>": { "<ComponentName>": value, ... }, ... }
export type Snapshot = Record<string, Record<string, unknown>>

// scene.json spawn points, as authored (see viewport/spawn-area.ts)
export interface SpawnPointSpec {
  name?: string
  default?: boolean
  position?: { x?: number | number[]; y?: number | number[]; z?: number | number[] }
}

export type InspectorStatus =
  | 'logging-in'
  | 'no-scene'
  | 'loading-snapshot'
  | 'ready'
  | 'error'
  // the engine reports the scene's own code crashed: its thread is gone, so
  // retrying the snapshot for the full boot deadline can only ever time out
  | 'scene-broken'

// key: `${entityId}/${componentName}`
export type ComponentKey = string

export function componentKey(entityId: string, name: string): ComponentKey {
  return `${entityId}/${name}`
}

export const state = reactive({
  status: 'logging-in' as InspectorStatus,
  error: '',
  scene: undefined as LiveSceneInfo | undefined,
  snapshot: {} as Snapshot,
  expandedEntities: new Set<string>(),
  expandedComponents: new Set<ComponentKey>(),
  // raw-JSON edit text per component, used only in raw mode (absent => verbatim)
  drafts: new Map<ComponentKey, string>(),
  // structured edits keyed by `${componentKey}::${path}` (see fields.ts). Numbers
  // and strings stored as text (free typing), booleans as bool. Absent => the
  // snapshot leaf value verbatim.
  fieldEdits: new Map<string, string | boolean>(),
  // per-leaf revision counter (same key as fieldEdits). Bumped on *programmatic* edits
  // (copy/capture) to force the Input to re-mount and show the new value; NOT bumped while
  // typing, so the cursor isn't lost.
  fieldRev: new Map<string, number>(),
  // transient per-component result of the last Apply ('' => none)
  editStatus: new Map<ComponentKey, string>(),
  // current mode: a tool ('translate'|'rotate'|'scale') or 'select'. Always one
  // of these — toggling out of select returns to the last tool.
  activeAction: 'select' as string,
  // the last-used tool, restored when select mode is toggled off
  lastTool: 'translate' as 'translate' | 'rotate' | 'scale',
  // whether to draw parent/child relationship links
  showLinks: false,
  // active camera mode: 'none' (player), 'free' (fly), or 'target' (orbit the
  // active selection). Both 'free' and 'target' detach the camera + pin avatar.
  camMode: 'none' as 'none' | 'free' | 'target',
  // scroll-to target for the tree body: a row elementId (reference) or a literal
  // {x,y} position. Set once and left (see selectEntityInTree / primeScroll).
  jumpTarget: null as string | { x: number; y: number } | null,
  // whether the pinned scene is currently frozen (paused)
  frozen: false,
  // play-mode HUD (page-side): interaction hints for the hovered entity and
  // whether the engine holds the mouse for camera-look (draw the crosshair)
  playHover: [] as HoverHint[],
  playCursorLocked: false,
  // play-mode HUD (page-side): names of the trigger zones the avatar stands in
  playZones: [] as string[],
  // entity ids the delete-confirm dialog is asking about, or null when closed
  deleteConfirm: null as string[] | null,
  // entity id whose component window (popup editor) is open, or null. Components
  // live here rather than inline in the tree.
  componentWindow: null as string | null,
  // whether the new-entity dialog is open
  newEntityOpen: false,
  // asset-import catalog (slim entries) fetched for the page's picker, and
  // whether a catalog fetch / asset import is currently in flight
  assetCatalog: [] as Array<{
    id: string
    name: string
    category: string
    tags: string[]
    pack: string
    thumbnail?: string | null
  }>,
  assetBusy: false,
  // catalog of editable component names (from /component_names), for the picker
  componentNames: [] as string[],
  // per-component typed schema (from /component_schema), keyed by component name
  schemas: new Map<string, unknown>(),
  // component names whose schema fetch is in flight (avoid duplicate requests)
  schemaPending: new Set<string>(),
  // current multi-selection (tree + markers). The gizmo anchors on activeEntity
  // (the most-recently-clicked) and applies its delta to the whole selection.
  selected: new Set<string>(),
  activeEntity: null as string | null,
  // rotate/scale pivot: false = around the active entity (orbits positions),
  // true = each item about its own origin (positions unchanged).
  pivotEach: false,
  // translate axis orientation: false = active entity's local axes, true = world axes.
  orientGlobal: false,
  // in-progress marker drag-box (screen px). add = shift, remove = ctrl.
  selectBox: null as
    | { startX: number; startY: number; curX: number; curY: number; add: boolean; remove: boolean }
    | null,
  // gizmo handle currently under the pointer: translate 'x'|'y'|'z'|'xy'|'xz'|
  // 'yz', rotate 'rx'|'ry'|'rz', or null
  gizmoHover: null as string | null,
  // true while a gizmo handle is being dragged
  gizmoDragging: false,

  // --- save changelog: what the editor changed this session, so a save persists our edits
  // (not the scene's runtime churn). Keys are `${entityId}/${componentName}`. ---
  // components the editor wrote — these take their live value in the saved composite.
  editedComponents: new Set<string>(),
  // components the editor removed — omitted from the saved composite.
  deletedComponents: new Set<string>(),
  // entity ids the editor deleted — omitted (with all their components) from the composite.
  deletedEntities: new Set<string>(),
  // entities the EDITOR created this session. Everything else missing from the
  // save baseline was spawned by the scene's own code, which must never be
  // written into main.composite — the code would spawn it again next run.
  createdEntities: new Set<string>(),
  // the value the editor last wrote per `${entityId}/${componentName}` — the "editor" source in
  // the save diff. live may have churned since (tweens etc.), so we can't reuse it.
  editorValues: new Map<string, unknown>(),
  // After a save, the authored set we just persisted (decoded/snapshot form), cached as the new
  // baseline so the next save diffs against what we last wrote rather than the original /crdt_initial
  // — otherwise prior saves' edits (live ≠ stale-initial, but no longer in the cleared changelog)
  // would default to revert. Null until the first save; reset when the editor session reloads.
  // viewport: scene.json's spawnPoints, and whether to draw them. On by
  // default — where players land is something every creator should see; the
  // ⋯ menu toggle is the opt-out.
  spawnPoints: [] as SpawnPointSpec[],
  showSpawnAreas: true,
  // viewport: snap gizmo drags to the grid (Shift inverts it while dragging)
  snap: false,
  // viewport: draw collider/trigger volumes (engine debug view)
  showColliders: false,
  savedBaseline: null as Snapshot | null,
  // /crdt_initial — the scene as its composite authored it, before any code ran.
  // Loaded once at boot so the UI can mark entities the scene's code spawned.
  initialBaseline: null as Snapshot | null,
  // transient status line for the save action.
  saveStatus: '',
  // set on the first edit made while the scene is playing (runtime, won't persist)
  // so the UI can warn once; cleared when dismissed. Suppressed via localStorage.
  playEditWarn: false
})

// Record an editor edit in the changelog (so save knows it was us, not runtime churn), capturing
// the written value as the "editor" source for the diff.
export function markEdited(entityId: string, name: string, value: unknown): void {
  const key = `${entityId}/${name}`
  state.editedComponents.add(key)
  state.deletedComponents.delete(key)
  state.editorValues.set(key, value)
}

export function markComponentDeleted(entityId: string, name: string): void {
  const key = `${entityId}/${name}`
  state.deletedComponents.add(key)
  state.editedComponents.delete(key)
  state.editorValues.delete(key)
}

export function markEntityDeleted(entityId: string): void {
  state.deletedEntities.add(entityId)
}

// Clear the changelog after a successful save — the just-saved state becomes the new baseline.
export function resetSaveChangelog(): void {
  state.editedComponents.clear()
  state.deletedComponents.clear()
  state.deletedEntities.clear()
  state.editorValues.clear()
  state.createdEntities = new Set()
}

// Spawned by the scene's own code rather than authored: present live, absent from
// the save baseline, and not one of ours. Such an entity can be selected and
// nudged — useful — but saving it would duplicate it on the next run, since the
// code that made it runs again.
export const RUNTIME_ENTITY_TIP =
  "Your scene's code creates this one while it runs, so the editor can't save changes to it — the code puts it back the way it says on every restart. To change it for good, change the code."

// A UI node (button, label, leaderboard row…) rather than something in the world.
// The scene's UI is built from entities like any other, so they show up in the
// snapshot — but they have no position, can't be picked, and a busy UI can bury
// the actual scene content under hundreds of rows. Any Ui* component marks one:
// UiTransform is on every node, and the rest (UiText, UiBackground, UiInput…)
// only ever appear alongside it.
// Engine->scene outputs that merely START with "Ui" but do not mark a UI node.
// UiCanvasInformation is canvas metadata the engine writes onto the scene ROOT —
// reading it as a UI marker made entity 0 a UI node, and therefore made every
// entity in the scene "under UI".
const UI_ENGINE_OUTPUT = new Set(['UiCanvasInformation'])

export function isUiEntity(snapshot: Snapshot, id: string): boolean {
  if (id === '0') return false // the scene root is never a UI node
  const comps = snapshot[id]
  if (comps === undefined) return false
  for (const name of Object.keys(comps)) {
    if (name.startsWith('Ui') && !UI_ENGINE_OUTPUT.has(name)) return true
  }
  return false
}

export const OUT_OF_BOUNDS_TIP =
  "Outside the scene's parcels — the engine doesn't render what falls outside the layout, so this won't be visible in-world. Move it back inside, or add the parcel to the scene."

export function isRuntimeEntity(id: string, baseline: Snapshot | null): boolean {
  if (baseline === null) return false
  return baseline[id] === undefined && !state.createdEntities.has(id)
}

// The baseline UI provenance checks must diff against. A save clears
// createdEntities (its ids are now authored), so /crdt_initial alone would
// reclassify entities created this session as code-spawned — the saved
// authored set supersedes it once it exists.
export function provenanceBaseline(): Snapshot | null {
  return state.savedBaseline ?? state.initialBaseline
}

// The engine creates the scrollable link with scroll_position = None and only
// acts on scroll_position *changes* via its update path — so the very first
// change merely initializes the link without scrolling. Prime it once at load
// with a harmless literal scroll-to-top, so the user's first real jump is
// already a "subsequent" change that takes effect.
let scrollPrimed = false
export function primeScroll(): void {
  if (scrollPrimed) return
  scrollPrimed = true
  let elapsed = 0
  const sys = (dt: number): void => {
    elapsed += dt
    if (elapsed >= 0.5) {
      state.jumpTarget = { x: 0, y: 0 }
      engine.removeSystem(sys)
    }
  }
  engine.addSystem(sys)
}

export function rowElementId(id: string): string {
  return `row-${id}`
}

const TOOLS = ['translate', 'rotate', 'scale']

// Switch mode. Selecting a tool makes it current (and remembered); the Select
// button toggles select on/off, returning to the last tool when toggled off.
export function setActiveAction(action: string): void {
  if (action === 'select') {
    state.activeAction = state.activeAction === 'select' ? state.lastTool : 'select'
    return
  }
  if (TOOLS.includes(action)) state.lastTool = action as 'translate' | 'rotate' | 'scale'
  state.activeAction = action
}

export function clearSelection(): void {
  state.selected = new Set()
  state.activeEntity = null
}

// --- collection writes are REPLACE-ON-WRITE ---
// The reactive() proxy notifies on top-level set/delete, but an in-place Set/Map
// mutation (`state.x.add()/.set()`) doesn't touch a tracked property, so it would
// NOT re-render. Every write to a state Set/Map therefore reassigns a fresh copy —
// the top-level assignment is what notifies. Always go through these helpers;
// never `state.x.add/set/delete(...)` directly. See docs/STATE-ARCHITECTURE.md.
function setWith<T>(s: ReadonlySet<T>, fn: (next: Set<T>) => void): Set<T> {
  const next = new Set(s)
  fn(next)
  return next
}
function mapWith<K, V>(m: ReadonlyMap<K, V>, fn: (next: Map<K, V>) => void): Map<K, V> {
  const next = new Map(m)
  fn(next)
  return next
}

// Two different questions, and conflating them left UI rows inert once the tree
// started listing them.
//
// VIEWPORT picking (click, drag-box) must never land on a UI node: they are screen
// elements with no world position, so a hit is always a mistake.
function pickable(id: string): boolean {
  return !isUiEntity(state.snapshot, id)
}
// The TREE / bus path may select anything that exists — selecting a UI node is the
// only way to read its UiTransform/UiBackground in the inspector. The transform
// gizmo gates itself on the entity having a Transform (gizmo.ts, gizmoVisible).
function selectable(id: string): boolean {
  return state.snapshot[id] !== undefined
}

function lastSelected(): string | null {
  let last: string | null = null
  for (const v of state.selected) last = v
  return last
}

// Replace the whole selection.
export function setSelected(ids: Iterable<string>): void {
  state.selected = new Set([...ids].filter(selectable))
}

// Replace selection AND active together (the scene→UI bus sync). The active id
// must survive the UI-entity filter, else fall back to the last selected.
export function setSelectionAndActive(ids: string[], active: string | null): void {
  setSelected(ids)
  state.activeEntity = active !== null && state.selected.has(active) ? active : lastSelected()
}

// Apply a click to the selection. `additive` (shift) adds; `toggle` (ctrl)
// flips membership; neither replaces the selection with just this entity.
// `viewport` marks a pick in the 3D view, which must never land on a UI node —
// a click in the TREE may, since that is the only way to inspect one.
export function selectionClick(id: string, additive: boolean, toggle: boolean, viewport = false): void {
  if (toggle && state.selected.has(id)) {
    state.selected = setWith(state.selected, (s) => s.delete(id))
    if (state.activeEntity === id) state.activeEntity = lastSelected()
    return
  }
  if (viewport ? !pickable(id) : !selectable(id)) return
  state.selected = setWith(state.selected, (s) => {
    if (!toggle && !additive) s.clear()
    s.add(id)
  })
  state.activeEntity = id
}

// Apply a drag-box result: `remove` (ctrl) unselects the boxed entities,
// `add` (shift) adds them, neither replaces the selection with them.
export function applyBoxSelection(ids: string[], add: boolean, remove: boolean): void {
  const boxed = remove ? ids : ids.filter(pickable)
  state.selected = setWith(state.selected, (s) => {
    if (remove) {
      for (const id of boxed) s.delete(id)
    } else {
      if (!add) s.clear()
      for (const id of boxed) s.add(id)
    }
  })
  if (!remove && boxed.length > 0) state.activeEntity = boxed[boxed.length - 1]
  if (state.activeEntity === null || !state.selected.has(state.activeEntity)) {
    state.activeEntity = lastSelected()
  }
}

// Selected entities with no selected ancestor — the set a group transform should
// drive directly (descendants of a selected entity inherit its motion).
export function topLevelSelected(snapshot: Snapshot): string[] {
  const out: string[] = []
  for (const id of state.selected) {
    let p = parentOf(snapshot, id)
    let nested = false
    while (p !== null) {
      if (state.selected.has(p)) {
        nested = true
        break
      }
      p = parentOf(snapshot, p)
    }
    if (!nested) out.push(id)
  }
  return out
}

// The compact JSON the editor shows for a component value when no draft is held.
export function valueJson(value: unknown): string {
  return JSON.stringify(value)
}

export function getDraft(key: ComponentKey, value: unknown): string {
  return state.drafts.get(key) ?? valueJson(value)
}

export function setDraft(key: ComponentKey, text: string): void {
  state.drafts = mapWith(state.drafts, (m) => m.set(key, text))
  state.editStatus = mapWith(state.editStatus, (m) => m.delete(key))
}

export function revertDraft(key: ComponentKey): void {
  state.drafts = mapWith(state.drafts, (m) => m.delete(key))
  state.editStatus = mapWith(state.editStatus, (m) => m.delete(key))
}

// Drop every pending edit (raw + structured) for a component, e.g. after a
// successful Apply so the widgets reflect the freshly-applied snapshot.
export function clearComponentEdits(key: ComponentKey): void {
  const prefix = `${key}::`
  state.drafts = mapWith(state.drafts, (m) => m.delete(key))
  state.fieldEdits = mapWith(state.fieldEdits, (m) => {
    for (const fieldKey of [...m.keys()]) if (fieldKey.startsWith(prefix)) m.delete(fieldKey)
  })
}

// Structured field edits (fields.ts / schema.ts / properties.tsx write through these).
export function setFieldEdit(key: string, value: string | boolean): void {
  state.fieldEdits = mapWith(state.fieldEdits, (m) => m.set(key, value))
}
export function deleteFieldEdit(key: string): void {
  state.fieldEdits = mapWith(state.fieldEdits, (m) => m.delete(key))
}
export function deleteFieldEditsWhere(pred: (key: string) => boolean): void {
  state.fieldEdits = mapWith(state.fieldEdits, (m) => {
    for (const k of [...m.keys()]) if (pred(k)) m.delete(k)
  })
}

// Per-component apply status ('' / '✓ set' / error). Read in the inspector.
export function setEditStatus(key: ComponentKey, msg: string): void {
  state.editStatus = mapWith(state.editStatus, (m) => m.set(key, msg))
}
export function clearEditStatus(key: ComponentKey): void {
  state.editStatus = mapWith(state.editStatus, (m) => m.delete(key))
}

// Clear all pending edits (e.g. on snapshot reload).
export function clearAllEdits(): void {
  state.fieldEdits = new Map()
  state.drafts = new Map()
}

// --- snapshot writes are REPLACE-ON-WRITE too ---
// The proxy is shallow, so `state.snapshot[id][name] = v` wouldn't notify. These
// reassign `state.snapshot` immutably (the top-level set is what re-renders).
export function setSnapshotComponent(id: string, name: string, value: unknown): void {
  state.snapshot = { ...state.snapshot, [id]: { ...state.snapshot[id], [name]: value } }
}
// Batched variant: apply several component writes in ONE snapshot reassignment
// (a single shallow copy + a single notify) instead of N. Used by gizmo drag-end,
// where each moved entity would otherwise spread the whole snapshot (quadratic).
export function setSnapshotComponents(updates: Array<{ id: string; name: string; value: unknown }>): void {
  if (updates.length === 0) return
  const next = { ...state.snapshot }
  for (const { id, name, value } of updates) {
    next[id] = { ...next[id], [name]: value }
  }
  state.snapshot = next
}
export function deleteSnapshotComponent(id: string, name: string): void {
  const entry = state.snapshot[id]
  if (entry === undefined || !(name in entry)) return
  const { [name]: _drop, ...rest } = entry
  state.snapshot = { ...state.snapshot, [id]: rest }
}
export function deleteSnapshotEntity(id: string): void {
  if (!(id in state.snapshot)) return
  const { [id]: _drop, ...rest } = state.snapshot
  state.snapshot = rest
}

// Cache a fetched component schema. Replace-on-write so the inspector re-renders
// when an async schema load lands (components select it via useStore(getSchema)).
export function setSchema(name: string, schema: unknown): void {
  state.schemas = mapWith(state.schemas, (m) => m.set(name, schema))
}

export function toggleEntity(id: string): void {
  state.expandedEntities = setWith(state.expandedEntities, (s) =>
    s.has(id) ? s.delete(id) : s.add(id)
  )
}

export function expandEntity(id: string): void {
  state.expandedEntities = setWith(state.expandedEntities, (s) => s.add(id))
}

export function toggleComponent(key: string): void {
  state.expandedComponents = setWith(state.expandedComponents, (s) =>
    s.has(key) ? s.delete(key) : s.add(key)
  )
}

export function setComponentExpanded(key: string, expanded: boolean): void {
  state.expandedComponents = setWith(state.expandedComponents, (s) =>
    expanded ? s.add(key) : s.delete(key)
  )
}

export type Forest = {
  roots: string[]
  children: Map<string, string[]>
}

// Parent of an entity from its Transform.parent (proto u32). Entities with no
// Transform default to root (0). Returns null for root and self-parents.
export function parentOf(snapshot: Snapshot, id: string): string | null {
  if (id === '0') return null
  const transform = snapshot[id]?.Transform as { parent?: number } | undefined
  // A UI node has no Transform — its parent lives on UiTransform. Without this
  // every UI entity re-rooted to 0 and the panel showed a flat wall of hundreds
  // of "UI node" rows instead of the UI tree.
  const ui = snapshot[id]?.UiTransform as { parent?: number } | undefined
  const raw = transform?.parent ?? ui?.parent
  const parentId = raw === undefined ? '0' : String(raw)
  return parentId === id ? null : parentId
}

// Build the entity hierarchy from the snapshot's Transform parents. An entity is
// a forest root when its parent is absent from the snapshot (e.g. the parent has
// no components of its own, or is the scene root). Cycles/orphans are surfaced as
// extra roots by the renderer so nothing is silently dropped.
export function buildForest(snapshot: Snapshot): Forest {
  const ids = Object.keys(snapshot)
  const present = new Set(ids)
  const children = new Map<string, string[]>()
  const roots: string[] = []

  for (const id of ids) {
    const parent = parentOf(snapshot, id)
    if (parent !== null && present.has(parent)) {
      const siblings = children.get(parent) ?? []
      siblings.push(id)
      children.set(parent, siblings)
    } else {
      roots.push(id)
    }
  }

  const byId = (a: string, b: string): number => Number(a) - Number(b)
  roots.sort(byId)
  for (const siblings of children.values()) siblings.sort(byId)
  return { roots, children }
}

// Expand the entity (so its components show), expand all its ancestors (so its
// row actually renders in the nested tree), and request a scroll to its row.
export function selectEntityInTree(snapshot: Snapshot, id: string): void {
  state.expandedEntities = setWith(state.expandedEntities, (s) => {
    let cur = parentOf(snapshot, id)
    while (cur !== null && cur in snapshot) {
      s.add(cur)
      cur = parentOf(snapshot, cur)
    }
    s.add(id)
  })

  // The engine scrolls to an elementId by reading the target row's *settled*
  // layout position, and only acts on a *change* to scrollPosition. Set it once,
  // a few frames after expanding (so the freshly-built subtree has laid out),
  // and leave it set — clearing it would risk coalescing with the set in the
  // same LWW tick, leaving the engine seeing only the cleared value.
  const target = rowElementId(id)
  let elapsed = 0
  const jumpSystem = (dt: number): void => {
    elapsed += dt
    if (elapsed >= 0.12) {
      state.jumpTarget = target
      engine.removeSystem(jumpSystem)
    }
  }
  engine.addSystem(jumpSystem)
}

// root/player/camera are the well-known reserved entity ids.
export function entityLabel(id: string): string {
  switch (id) {
    case '0':
      return `root (${id})`
    case '1':
      return `player (${id})`
    case '2':
      return `camera (${id})`
    default:
      return id
  }
}
