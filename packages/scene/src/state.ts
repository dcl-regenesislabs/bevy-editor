import { engine } from '@dcl/sdk/ecs'
import { type LiveSceneInfo } from './bevy-api/interface'
import { type DiffRow, type DiffSource } from './save-diff'

// crdt_snapshot shape: { "<entityId>": { "<ComponentName>": value, ... }, ... }
export type Snapshot = Record<string, Record<string, unknown>>

export type InspectorStatus =
  | 'logging-in'
  | 'no-scene'
  | 'loading-snapshot'
  | 'ready'
  | 'error'

// key: `${entityId}/${componentName}`
export type ComponentKey = string

export function componentKey(entityId: string, name: string): ComponentKey {
  return `${entityId}/${name}`
}

export const state = {
  // true once a host-page UI (React, over the editor message bus) announced
  // itself — the in-scene panels hide, leaving only gizmos/markers/relations.
  pageUi: true,
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
  // components currently editing as raw JSON instead of the structured editor
  rawMode: new Set<ComponentKey>(),
  // transient per-component result of the last Apply ('' => none)
  editStatus: new Map<ComponentKey, string>(),
  // current mode: a tool ('translate'|'rotate'|'scale') or 'select'. Always one
  // of these — toggling out of select returns to the last tool.
  activeAction: 'select' as string,
  // the last-used tool, restored when select mode is toggled off
  lastTool: 'translate' as 'translate' | 'rotate' | 'scale',
  // when to draw node markers: 'always' (all nodes), 'selected' (only selected),
  // 'selecting' (only while in select mode). Select mode always shows all nodes.
  nodeDisplay: 'selected' as 'always' | 'selected' | 'selecting',
  // whether to draw parent/child relationship links
  showLinks: false,
  // active camera mode: 'none' (player), 'free' (fly), or 'target' (orbit the
  // active selection). Both 'free' and 'target' detach the camera + pin avatar.
  camMode: 'none' as 'none' | 'free' | 'target',
  // entity whose world marker is hovered (for the id tooltip), or null
  hoveredOverlay: null as string | null,
  // scroll-to target for the tree body: a row elementId (reference) or a literal
  // {x,y} position. Set once and left (see selectEntityInTree / primeScroll).
  jumpTarget: null as string | { x: number; y: number } | null,
  // whether the pinned scene is currently frozen (paused)
  frozen: false,
  // entity id whose delete-confirm dialog is open, or null
  deleteConfirm: null as string | null,
  // entity id whose component window (popup editor) is open, or null. Components
  // live here rather than inline in the tree.
  componentWindow: null as string | null,
  // whether the add-component picker (inside the component window) is open
  addComponentOpen: false,
  // filter text for the add-component picker
  addComponentFilter: '',
  // whether the new-entity dialog is open, and the name typed into it
  newEntityOpen: false,
  newEntityName: '',
  // asset-import picker: whether it's open, the fetched catalog (slim entries), the search
  // filter, and whether a catalog fetch / asset import is currently in flight.
  assetPickerOpen: false,
  assetCatalog: [] as Array<{
    id: string
    name: string
    category: string
    tags: string[]
    pack: string
    thumbnail?: string | null
  }>,
  assetFilter: '',
  assetBusy: false,
  // catalog of editable component names (from /component_names), for the picker
  componentNames: [] as string[],
  // per-component typed schema (from /component_schema), keyed by component name
  schemas: new Map<string, unknown>(),
  // component names whose schema fetch is in flight (avoid duplicate requests)
  schemaPending: new Set<string>(),
  // true while the non-uniform-parent reparent confirm dialog is open
  parentConfirm: false,
  // entity id whose delete button is hovered (for the modifier tooltip), or null
  hoveredDelete: null as string | null,
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
  // the value the editor last wrote per `${entityId}/${componentName}` — the "editor" source in
  // the save diff. live may have churned since (tweens etc.), so we can't reuse it.
  editorValues: new Map<string, unknown>(),
  // the save diff dialog: null when closed, else the diff rows, the per-row source selection, and
  // the baseline they were computed against (to rebuild the authored set on confirm).
  saveDialog: null as
    | { rows: DiffRow[]; selection: Map<string, DiffSource>; initial: Snapshot }
    | null,
  // After a save, the authored set we just persisted (decoded/snapshot form), cached as the new
  // baseline so the next save diffs against what we last wrote rather than the original /crdt_initial
  // — otherwise prior saves' edits (live ≠ stale-initial, but no longer in the cleared changelog)
  // would default to revert. Null until the first save; reset when the editor session reloads.
  savedBaseline: null as Snapshot | null,
  // transient status line for the save action.
  saveStatus: '',
  // set on the first edit made while the scene is playing (runtime, won't persist)
  // so the UI can warn once; cleared when dismissed. Suppressed via localStorage.
  playEditWarn: false
}

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

const NODE_DISPLAY_ORDER = ['always', 'selected', 'selecting'] as const
export function cycleNodeDisplay(): void {
  const i = NODE_DISPLAY_ORDER.indexOf(state.nodeDisplay)
  state.nodeDisplay = NODE_DISPLAY_ORDER[(i + 1) % NODE_DISPLAY_ORDER.length]
}

export function isSelected(id: string): boolean {
  return state.selected.has(id)
}

export function clearSelection(): void {
  state.selected.clear()
  state.activeEntity = null
}

// Apply a click to the selection. `additive` (shift) adds; `toggle` (ctrl)
// flips membership; neither replaces the selection with just this entity.
export function selectionClick(id: string, additive: boolean, toggle: boolean): void {
  if (toggle) {
    if (state.selected.has(id)) {
      state.selected.delete(id)
      if (state.activeEntity === id) {
        let last: string | null = null
        for (const v of state.selected) last = v
        state.activeEntity = last
      }
      return
    }
  } else if (!additive) {
    state.selected.clear()
  }
  state.selected.add(id)
  state.activeEntity = id
}

// Apply a drag-box result: `remove` (ctrl) unselects the boxed entities,
// `add` (shift) adds them, neither replaces the selection with them.
export function applyBoxSelection(ids: string[], add: boolean, remove: boolean): void {
  if (remove) {
    for (const id of ids) state.selected.delete(id)
  } else {
    if (!add) state.selected.clear()
    for (const id of ids) state.selected.add(id)
    if (ids.length > 0) state.activeEntity = ids[ids.length - 1]
  }
  if (state.activeEntity === null || !state.selected.has(state.activeEntity)) {
    let last: string | null = null
    for (const v of state.selected) last = v
    state.activeEntity = last
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
  state.drafts.set(key, text)
  state.editStatus.delete(key)
}

export function revertDraft(key: ComponentKey): void {
  state.drafts.delete(key)
  state.editStatus.delete(key)
}

export function toggleRawMode(key: ComponentKey): void {
  if (state.rawMode.has(key)) state.rawMode.delete(key)
  else state.rawMode.add(key)
  state.editStatus.delete(key)
}

// Drop every pending edit (raw + structured) for a component, e.g. after a
// successful Apply so the widgets reflect the freshly-applied snapshot.
export function clearComponentEdits(key: ComponentKey): void {
  state.drafts.delete(key)
  const prefix = `${key}::`
  for (const fieldKey of state.fieldEdits.keys()) {
    if (fieldKey.startsWith(prefix)) state.fieldEdits.delete(fieldKey)
  }
}

export function toggleEntity(id: string): void {
  if (state.expandedEntities.has(id)) state.expandedEntities.delete(id)
  else state.expandedEntities.add(id)
}

export function toggleComponent(key: string): void {
  if (state.expandedComponents.has(key)) state.expandedComponents.delete(key)
  else state.expandedComponents.add(key)
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
  const parentId = transform?.parent === undefined ? '0' : String(transform.parent)
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
  let cur = parentOf(snapshot, id)
  while (cur !== null && cur in snapshot) {
    state.expandedEntities.add(cur)
    cur = parentOf(snapshot, cur)
  }
  state.expandedEntities.add(id)

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
