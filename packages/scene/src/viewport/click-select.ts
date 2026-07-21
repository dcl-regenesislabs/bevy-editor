// Click-to-select on the actual models (host-page UI mode), using a scene-side
// SDK Raycast — NOT the engine's /pointer_target command (which only existed in our
// patched engine). Mirrors robtfm/editor-scene's mesh-select: we overlay an
// editor-only collider layer (CL_RESERVED6 = 128) onto the inspected scene's
// renderable entities so a 128-mask ray can hit them, cast that ray under the
// cursor, and resolve the nearest hit to the selection.
//
// The pick colliders are written to the ENGINE ONLY (cmd.setComponent), never into
// the logical snapshot — reloadSnapshot strips the 128 bit on ingest (see
// inspector.ts) — so they are never shown in the tree nor written on save. A 128
// collider is inert to everything else (physics / pointer / scene raycasts use
// other masks), so they can stay applied while the scene plays without effect.
//
// Taps are detected scene-side from the engine's pointer input (startGizmoPick /
// overlay.tsx), not the DOM bus tap (unreliable in the iframed host). Selection is
// sticky: a clean miss with no modifier clears it; modifiers leave it.
import {
  engine,
  Transform,
  Raycast,
  RaycastResult,
  RaycastQueryType,
  inputSystem,
  InputAction,
  PointerEventType,
  PrimaryPointerInfo,
  type Entity
} from '@dcl/sdk/ecs'
import { cmd } from '../cmd'
import { log } from '../log'
import { state, selectionClick, selectEntityInTree, clearSelection, setActiveAction, parentOf } from '../state'
import { NAME_COMPONENT } from '../custom-components'
import { PICK_LAYER, GLTF, MESH_RENDERER, MESH_COLLIDER, pickApplied, synthesized } from './pick-layer'

// Map a MeshRenderer's shape (engine-form oneof) to the matching MeshCollider
// shape, dropping renderer-only fields, so a primitive renderer gets a pickable
// collider of the same shape.
function colliderMeshFromRenderer(mesh: unknown): Record<string, unknown> | undefined {
  if (typeof mesh !== 'object' || mesh === null) return undefined
  const m = mesh as Record<string, unknown>
  if ('box' in m) return { box: {} }
  if ('sphere' in m) return { sphere: {} }
  if ('cylinder' in m) return { cylinder: { ...(m.cylinder as object) } }
  if ('plane' in m) return { plane: {} }
  if ('gltf' in m) return { gltf: { ...(m.gltf as object) } }
  return undefined
}

// Overlay the pick layer onto every renderable inspected-scene entity, once each.
// Engine-only writes (cmd.setComponent) — the logical snapshot stays clean.
function syncPickColliders(): void {
  const writePick = (id: string, name: string, value: object, label: string): void => {
    void cmd.setComponent(id, name, JSON.stringify(value)).catch((e) => log.debug(`pick collider (${label}) failed`, e))
  }
  for (const [id, comps] of Object.entries(state.snapshot)) {
    if (pickApplied.has(id)) continue
    const gltf = comps[GLTF] as { visibleMeshesCollisionMask?: number } | undefined
    if (gltf !== undefined) {
      const vis = gltf.visibleMeshesCollisionMask ?? 0
      writePick(id, GLTF, { ...gltf, visibleMeshesCollisionMask: vis | PICK_LAYER }, 'gltf')
      pickApplied.add(id)
      continue
    }
    const renderer = comps[MESH_RENDERER] as { mesh?: unknown } | undefined
    if (renderer === undefined) continue
    const existing = comps[MESH_COLLIDER] as { collisionMask?: number; mesh?: unknown } | undefined
    if (existing !== undefined) {
      writePick(id, MESH_COLLIDER, { ...existing, collisionMask: (existing.collisionMask ?? 0) | PICK_LAYER }, 'mesh')
    } else {
      const value: Record<string, unknown> = { collisionMask: PICK_LAYER }
      const mesh = colliderMeshFromRenderer(renderer.mesh)
      if (mesh !== undefined) value.mesh = mesh
      writePick(id, MESH_COLLIDER, value, 'synth')
      synthesized.add(id)
    }
    pickApplied.add(id)
  }
}

// Resolve a raycast hit to the entity to select. A click on a GLTF's internal
// mesh should select its nearest NAMED ancestor (the logical authored entity),
// so we walk up looking for a Name. But runtime-spawned entities are real scene
// entities that simply carry no Name (they show as bare ids in the tree) — those
// must stay selectable, so when no named ancestor exists we fall back to the hit
// entity itself. Returns null only if the hit isn't a scene entity at all.
function resolvePick(id: string): string | null {
  let cur: string | null = id
  while (cur !== null && cur !== '0') {
    if (state.snapshot[cur]?.[NAME_COMPONENT] !== undefined) return cur
    cur = parentOf(state.snapshot, cur)
  }
  // no named ancestor: select the hit entity directly if it's in the snapshot
  return id in state.snapshot ? id : null
}

let picker: Entity | null = null
let rayTs = 0
let pending: { shift: boolean; ctrl: boolean } | null = null

// Cast a pick ray under the cursor. A super-user scene's plain raycast is routed by
// the engine to the active inspection scene, so it returns that scene's entity ids.
export function pickAtPointer(add: boolean, toggle: boolean): void {
  if (picker === null) return
  const dir = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.worldRayDirection
  const camT = Transform.getOrNull(engine.CameraEntity)
  if (dir === undefined || camT === null) return
  Transform.createOrReplace(picker, { position: { ...camT.position } })
  rayTs += 1
  Raycast.createOrReplace(picker, {
    timestamp: rayTs,
    maxDistance: 1000,
    queryType: RaycastQueryType.RQT_QUERY_ALL, // all hits, so we can skip hidden ones
    continuous: false,
    collisionMask: PICK_LAYER,
    direction: { $case: 'globalDirection', globalDirection: { ...dir } }
  })
  pending = { shift: add, ctrl: toggle }
}

// Resolve a requested pick once the engine answers (matched by timestamp).
function handlePickResult(): void {
  if (pending === null || picker === null) return
  const result = RaycastResult.getOrNull(picker)
  if (result === null || result.timestamp !== rayTs) return
  const p = pending
  pending = null
  // nearest hit that resolves to an authored (named) entity ≥ 512
  const ordered = [...result.hits]
    .filter((h) => h.entityId !== undefined)
    .sort((a, b) => a.length - b.length)
  let picked: string | null = null
  for (const h of ordered) {
    const hit = String(h.entityId)
    if (!(hit in state.snapshot) || Number(hit) < 512) continue
    const id = resolvePick(hit)
    if (id !== null) {
      picked = id
      break
    }
  }
  if (picked === null) {
    // clean miss → clear selection (modifiers leave it sticky)
    if (!p.shift && !p.ctrl) clearSelection()
    return
  }
  selectionClick(picked, p.shift, p.ctrl)
  if (state.selected.has(picked)) {
    selectEntityInTree(state.snapshot, picked)
    // clicking a model means you want to manipulate it — bring up the move gizmo
    if (state.activeAction === 'select') setActiveAction('translate')
  }
}

// Set up the picker entity + the per-frame sync (pick colliders) and result drain.
export function setupMeshSelect(): void {
  picker = engine.addEntity()
  Transform.create(picker)
  engine.addSystem(() => {
    // overlay pick colliders whenever a host UI is attached (they're inert to the
    // running scene, so no need to gate on frozen)
    if (state.status === 'ready' && state.pageUi) syncPickColliders()
    handlePickResult()
  })
}

// Tap-to-pick while a transform gizmo is up (translate/rotate/scale). Select mode
// has its own tap path (overlay.tsx box-select); the gizmo modes had none, so
// clicking a DIFFERENT model while a gizmo showed did nothing. A press that lands
// on a gizmo handle starts a DRAG, not a pick.
let pickDownXY: { x: number; y: number } | null = null
export function startGizmoPick(): void {
  engine.addSystem(() => {
    if (state.status !== 'ready' || !state.pageUi) {
      pickDownXY = null
      return
    }
    const mode = state.activeAction
    if (mode !== 'translate' && mode !== 'rotate' && mode !== 'scale') {
      pickDownXY = null
      return
    }
    if (state.gizmoDragging) pickDownXY = null

    const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenCoordinates

    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
      pickDownXY = state.gizmoHover === null && p !== undefined ? { x: p.x, y: p.y } : null
      return
    }
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
      const down = pickDownXY
      pickDownXY = null
      if (down === null) return
      if (p !== undefined && (Math.abs(p.x - down.x) > 4 || Math.abs(p.y - down.y) > 4)) return
      const add = inputSystem.isPressed(InputAction.IA_MODIFIER)
      const toggle = inputSystem.isPressed(InputAction.IA_WALK)
      pickAtPointer(add, toggle)
    }
  })
}

// Mirror the selection into the engine's outline highlight (/highlight) so picked
// models read as selected in the viewport, whatever changed the selection.
export function startSelectionHighlight(): void {
  let lastSig = ''
  engine.addSystem(() => {
    if (state.status !== 'ready') return
    const ids = [...state.selected].sort()
    const sig = ids.join(',')
    if (sig === lastSig) return
    lastSig = sig
    cmd.highlight(ids).catch((e) => log.debug('highlight failed', e))
  })
}
