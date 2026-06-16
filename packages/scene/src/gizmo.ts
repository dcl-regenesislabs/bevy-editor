// World-space transform gizmo, modeled on the opendcl editor-gizmo skill: the
// handles are REAL entities of this (editor) scene with pointer colliders, so
// hover/press use the engine's own hit-testing, and the drag runs as a system
// that ends on the global pointer state — no scene-UI mouse events, no missed
// releases, no ghost drags.
//
// Differences from opendcl's: the edited entities belong to ANOTHER scene, so
// transforms are read from state.snapshot and written through fireTransform
// (console commands), and a drag applies to the whole top-level selection.
import {
  engine,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode,
  pointerEventsSystem,
  inputSystem,
  InputAction,
  PointerEventType,
  PrimaryPointerInfo,
  ColliderLayer,
  type Entity
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { state, topLevelSelected, parentOf } from './state'
import {
  worldTransformOf,
  worldToLocalPosition,
  worldToLocalRotation,
  worldScaleOf
} from './world-pos'
import { fireTransform } from './inspector'

type Axis = 'x' | 'y' | 'z'
type Local = { x: number; y: number; z: number }
type LocalRot = { x: number; y: number; z: number; w: number }

// ---- geometry constants (Roblox-style: slim, minimal) ----
// All lengths are in gizmo-local units; the root is scaled each frame to a
// constant fraction of the screen, so these set proportions, not world size.
const SHAFT_LENGTH = 1.0
const SHAFT_RADIUS = 0.022 // fine shafts
const TIP_LENGTH = 0.26
const TIP_RADIUS = 0.085 // small cone arrowheads
const HANDLE_RADIUS = 0.2 // invisible grab cylinder around each shaft (fat for easy clicks)
const PLANE_OFFSET = 0.34
const PLANE_SIZE = 0.22
const RING_RADIUS = 0.92
const RING_SEGMENTS = 32
const RING_SEGMENT_THICKNESS = 0.022
const RING_COLLIDER_THICKNESS = 0.2
const CUBE_SIZE = 0.16
// Constant screen-size: world scale = distance × FACTOR keeps the gizmo a fixed
// fraction of the viewport at any range (FACTOR ≈ desiredScreenFraction ×
// 2·tan(fov/2) ÷ gizmoLocalHeight).
const GIZMO_SCALE_FACTOR = 0.075
// The handles are children of the scaled root, so their pointer colliders shrink
// with this scale. Below ~0.15 the handle collider's world radius drops under the
// physics collider margin and pointer raycasts start missing it — making the
// gizmo ungrabbable up close. Floor the scale so colliders stay pickable; the
// floor meets the constant-screen curve at distance 2m (0.15 = 2 × 0.075), so
// there's no visual jump — closer than that the gizmo just grows on screen.
const GIZMO_MIN_SCALE = 0.15
const GIZMO_MAX_SCALE = 1000

const AXIS_COLORS: Record<Axis, { c4: Color4; c3: Color3 }> = {
  x: { c4: Color4.create(0.95, 0.2, 0.25, 1), c3: Color3.create(0.95, 0.2, 0.25) },
  y: { c4: Color4.create(0.25, 0.85, 0.3, 1), c3: Color3.create(0.25, 0.85, 0.3) },
  z: { c4: Color4.create(0.25, 0.45, 0.95, 1), c3: Color3.create(0.25, 0.45, 0.95) }
}
const UNIFORM_COLOR = { c4: Color4.create(0.9, 0.9, 0.92, 1), c3: Color3.create(0.9, 0.9, 0.92) }

// container rotation that points local +Y along the given axis
const AXIS_ROTATION: Record<Axis, LocalRot> = {
  x: Quaternion.fromEulerDegrees(0, 0, -90),
  y: Quaternion.Identity(),
  z: Quaternion.fromEulerDegrees(90, 0, 0)
}

function axisVec(a: Axis): Vector3 {
  return a === 'x' ? Vector3.Right() : a === 'y' ? Vector3.Up() : Vector3.Forward()
}
function otherAxes(a: Axis): [Axis, Axis] {
  return a === 'x' ? ['y', 'z'] : a === 'y' ? ['x', 'z'] : ['x', 'y']
}

// ---- gizmo entity bookkeeping ----
type HandleKind =
  | { op: 'translate-axis'; axis: Axis }
  | { op: 'translate-plane'; normal: Axis }
  | { op: 'rotate'; axis: Axis }
  | { op: 'scale-axis'; axis: Axis }
  | { op: 'scale-uniform' }

type HandleEntry = { handle: Entity; visuals: Entity[]; kind: HandleKind; hoverId: string }

let gizmoRoot: Entity | null = null
let gizmoEntities: Entity[] = []
let handles: HandleEntry[] = []
let builtSig = ''

function hoverId(kind: HandleKind): string {
  switch (kind.op) {
    case 'translate-axis':
      return kind.axis
    case 'translate-plane':
      return otherAxes(kind.normal).join('')
    case 'rotate':
      return `r${kind.axis}`
    case 'scale-axis':
      return `s${kind.axis}`
    case 'scale-uniform':
      return 'sc'
  }
}

function handleColors(kind: HandleKind): { c4: Color4; c3: Color3 } {
  switch (kind.op) {
    case 'translate-axis':
    case 'rotate':
    case 'scale-axis':
      return AXIS_COLORS[(kind as { axis: Axis }).axis]
    case 'translate-plane': {
      const [a, b] = otherAxes(kind.normal)
      const ca = AXIS_COLORS[a]
      const cb = AXIS_COLORS[b]
      return {
        c4: Color4.create((ca.c4.r + cb.c4.r) / 2, (ca.c4.g + cb.c4.g) / 2, (ca.c4.b + cb.c4.b) / 2, 0.6),
        c3: Color3.create((ca.c3.r + cb.c3.r) / 2, (ca.c3.g + cb.c3.g) / 2, (ca.c3.b + cb.c3.b) / 2)
      }
    }
    case 'scale-uniform':
      return UNIFORM_COLOR
  }
}

function applyMaterial(entry: HandleEntry, hovered: boolean): void {
  const { c4, c3 } = handleColors(entry.kind)
  const translucent = entry.kind.op === 'translate-plane'
  for (const v of entry.visuals) {
    Material.setPbrMaterial(v, {
      albedoColor: translucent ? Color4.create(c4.r, c4.g, c4.b, hovered ? 0.85 : 0.5) : c4,
      emissiveColor: c3,
      emissiveIntensity: hovered ? 2.6 : 0.7,
      metallic: 0.6,
      roughness: 0.3,
      ...(translucent ? { transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND } : {})
    })
  }
}

function track(e: Entity): Entity {
  gizmoEntities.push(e)
  return e
}

function registerHandle(handle: Entity, visuals: Entity[], kind: HandleKind, label: string): void {
  const entry: HandleEntry = { handle, visuals, kind, hoverId: hoverId(kind) }
  handles.push(entry)
  applyMaterial(entry, false)

  pointerEventsSystem.onPointerDown(
    {
      entity: handle,
      opts: { button: InputAction.IA_POINTER, hoverText: label, maxDistance: 200, showFeedback: false }
    },
    () => beginDrag(entry)
  )
  pointerEventsSystem.onPointerHoverEnter({ entity: handle, opts: { maxDistance: 200 } }, () => {
    state.gizmoHover = entry.hoverId
    for (const h of handles) applyMaterial(h, h === entry)
  })
  pointerEventsSystem.onPointerHoverLeave({ entity: handle, opts: { maxDistance: 200 } }, () => {
    if (state.gizmoHover === entry.hoverId) state.gizmoHover = null
    if (drag === null) for (const h of handles) applyMaterial(h, false)
  })
}

// ---- handle construction ----

function createArrow(axis: Axis, root: Entity): void {
  const container = track(engine.addEntity())
  Transform.create(container, { rotation: AXIS_ROTATION[axis], parent: root })

  const shaft = track(engine.addEntity())
  Transform.create(shaft, {
    position: Vector3.create(0, SHAFT_LENGTH / 2, 0),
    scale: Vector3.create(1, SHAFT_LENGTH, 1),
    parent: container
  })
  MeshRenderer.setCylinder(shaft, SHAFT_RADIUS, SHAFT_RADIUS)

  const tip = track(engine.addEntity())
  Transform.create(tip, {
    position: Vector3.create(0, SHAFT_LENGTH + TIP_LENGTH / 2, 0),
    scale: Vector3.create(1, TIP_LENGTH, 1),
    parent: container
  })
  MeshRenderer.setCylinder(tip, TIP_RADIUS, 0)

  const handle = track(engine.addEntity())
  Transform.create(handle, {
    position: Vector3.create(0, (SHAFT_LENGTH + TIP_LENGTH) / 2, 0),
    scale: Vector3.create(1, SHAFT_LENGTH + TIP_LENGTH, 1),
    parent: container
  })
  MeshCollider.setCylinder(handle, HANDLE_RADIUS, HANDLE_RADIUS, ColliderLayer.CL_POINTER)

  registerHandle(handle, [shaft, tip], { op: 'translate-axis', axis }, `Move ${axis.toUpperCase()}`)
}

function createPlaneHandle(normal: Axis, root: Entity): void {
  const axes = otherAxes(normal)
  const pos = Vector3.create(
    axes.includes('x') ? PLANE_OFFSET : 0,
    axes.includes('y') ? PLANE_OFFSET : 0,
    axes.includes('z') ? PLANE_OFFSET : 0
  )
  const visual = track(engine.addEntity())
  Transform.create(visual, {
    position: pos,
    scale: Vector3.create(
      normal === 'x' ? 0.02 : PLANE_SIZE,
      normal === 'y' ? 0.02 : PLANE_SIZE,
      normal === 'z' ? 0.02 : PLANE_SIZE
    ),
    parent: root
  })
  MeshRenderer.setBox(visual)

  const handle = track(engine.addEntity())
  Transform.create(handle, {
    position: pos,
    scale: Vector3.create(
      normal === 'x' ? 0.14 : PLANE_SIZE * 1.7,
      normal === 'y' ? 0.14 : PLANE_SIZE * 1.7,
      normal === 'z' ? 0.14 : PLANE_SIZE * 1.7
    ),
    parent: root
  })
  MeshCollider.setBox(handle, ColliderLayer.CL_POINTER)

  registerHandle(
    handle,
    [visual],
    { op: 'translate-plane', normal },
    `Move ${axes.map((a) => a.toUpperCase()).join('')}`
  )
}

function createRing(axis: Axis, root: Entity): void {
  const container = track(engine.addEntity())
  Transform.create(container, { rotation: AXIS_ROTATION[axis], parent: root })

  const segAngle = (Math.PI * 2) / RING_SEGMENTS
  const segLength = RING_RADIUS * 2 * Math.sin(segAngle / 2) * 1.05
  const visuals: Entity[] = []
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const angle = i * segAngle
    const seg = track(engine.addEntity())
    Transform.create(seg, {
      position: Vector3.create(Math.cos(angle) * RING_RADIUS, 0, Math.sin(angle) * RING_RADIUS),
      rotation: Quaternion.fromEulerDegrees(0, (-(angle + Math.PI / 2) * 180) / Math.PI, 0),
      scale: Vector3.create(segLength, RING_SEGMENT_THICKNESS, RING_SEGMENT_THICKNESS),
      parent: container
    })
    MeshRenderer.setBox(seg)
    visuals.push(seg)
  }

  const handle = track(engine.addEntity())
  Transform.create(handle, {
    scale: Vector3.create(RING_RADIUS * 2, RING_COLLIDER_THICKNESS, RING_RADIUS * 2),
    parent: container
  })
  MeshCollider.setCylinder(handle, 0.5, 0.5, ColliderLayer.CL_POINTER)

  registerHandle(handle, visuals, { op: 'rotate', axis }, `Rotate ${axis.toUpperCase()}`)
}

function createScaleHandle(axis: Axis, root: Entity): void {
  const container = track(engine.addEntity())
  Transform.create(container, { rotation: AXIS_ROTATION[axis], parent: root })

  const shaft = track(engine.addEntity())
  Transform.create(shaft, {
    position: Vector3.create(0, SHAFT_LENGTH / 2, 0),
    scale: Vector3.create(1, SHAFT_LENGTH, 1),
    parent: container
  })
  MeshRenderer.setCylinder(shaft, SHAFT_RADIUS, SHAFT_RADIUS)

  const cube = track(engine.addEntity())
  Transform.create(cube, {
    position: Vector3.create(0, SHAFT_LENGTH + CUBE_SIZE / 2, 0),
    scale: Vector3.create(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
    parent: container
  })
  MeshRenderer.setBox(cube)

  const handle = track(engine.addEntity())
  Transform.create(handle, {
    position: Vector3.create(0, (SHAFT_LENGTH + CUBE_SIZE) / 2, 0),
    scale: Vector3.create(1, SHAFT_LENGTH + CUBE_SIZE, 1),
    parent: container
  })
  MeshCollider.setCylinder(handle, HANDLE_RADIUS, HANDLE_RADIUS, ColliderLayer.CL_POINTER)

  registerHandle(handle, [shaft, cube], { op: 'scale-axis', axis }, `Scale ${axis.toUpperCase()}`)
}

function createUniformScaleHandle(root: Entity): void {
  const cube = track(engine.addEntity())
  Transform.create(cube, { scale: Vector3.create(CUBE_SIZE * 1.4, CUBE_SIZE * 1.4, CUBE_SIZE * 1.4), parent: root })
  MeshRenderer.setBox(cube)

  const handle = track(engine.addEntity())
  Transform.create(handle, { scale: Vector3.create(CUBE_SIZE * 3, CUBE_SIZE * 3, CUBE_SIZE * 3), parent: root })
  MeshCollider.setBox(handle, ColliderLayer.CL_POINTER)

  registerHandle(handle, [cube], { op: 'scale-uniform' }, 'Scale uniformly')
}

function destroyGizmo(): void {
  for (const h of handles) {
    pointerEventsSystem.removeOnPointerDown(h.handle)
    pointerEventsSystem.removeOnPointerHoverEnter(h.handle)
    pointerEventsSystem.removeOnPointerHoverLeave(h.handle)
  }
  for (const e of gizmoEntities) engine.removeEntity(e)
  if (gizmoRoot !== null) engine.removeEntity(gizmoRoot)
  gizmoRoot = null
  gizmoEntities = []
  handles = []
  builtSig = ''
  if (state.gizmoHover !== null) state.gizmoHover = null
}

function buildGizmo(mode: string): void {
  destroyGizmo()
  gizmoRoot = engine.addEntity()
  Transform.create(gizmoRoot, {})
  if (mode === 'translate') {
    createArrow('x', gizmoRoot)
    createArrow('y', gizmoRoot)
    createArrow('z', gizmoRoot)
    createPlaneHandle('x', gizmoRoot)
    createPlaneHandle('y', gizmoRoot)
    createPlaneHandle('z', gizmoRoot)
  } else if (mode === 'rotate') {
    createRing('x', gizmoRoot)
    createRing('y', gizmoRoot)
    createRing('z', gizmoRoot)
  } else {
    createScaleHandle('x', gizmoRoot)
    createScaleHandle('y', gizmoRoot)
    createScaleHandle('z', gizmoRoot)
    createUniformScaleHandle(gizmoRoot)
  }
}

// ---- drag state ----

type GroupEntry = {
  id: string
  startWorldPos: Vector3
  startWorldRot: LocalRot
  position: Local
  rotation: LocalRot
  scale: Local
  parent: number
}

type DragState = {
  kind: HandleKind
  entry: HandleEntry
  center: Vector3 // gizmo world center at drag start
  anchorStart?: Vector3 // selection anchor (sans top offset) at drag start
  planeNormal: Vector3
  startHit: Vector3
  axisDir?: Vector3 // translate/scale axis in world space
  startAngle?: number // rotate
  gizmoScale: number
  group: GroupEntry[]
}

let drag: DragState | null = null
// live world-space delta of the current translate drag, for overlays
let liveDelta: Vector3 | null = null
let liveRoots: Set<string> | null = null

function rayPlaneIntersect(
  origin: Vector3,
  dir: Vector3,
  planePoint: Vector3,
  normal: Vector3
): Vector3 | null {
  const denom = Vector3.dot(normal, dir)
  if (Math.abs(denom) < 1e-6) return null
  const t = Vector3.dot(normal, Vector3.subtract(planePoint, origin)) / denom
  if (t < 0) return null
  return Vector3.add(origin, Vector3.scale(dir, t))
}

// best drag plane for a single-axis translate: contains the axis, faces the camera
function axisDragPlaneNormal(axisDir: Vector3, camForward: Vector3): Vector3 {
  const side = Vector3.cross(axisDir, camForward)
  const normal = Vector3.cross(axisDir, side)
  const len = Vector3.length(normal)
  return len < 1e-6 ? Vector3.Up() : Vector3.scale(normal, 1 / len)
}

function angleOnPlane(hit: Vector3, center: Vector3, normal: Vector3): number {
  // stable basis on the plane
  const ref = Math.abs(normal.y) > 0.9 ? Vector3.Right() : Vector3.Up()
  const u = Vector3.normalize(Vector3.cross(normal, ref))
  const v = Vector3.normalize(Vector3.cross(normal, u))
  const rel = Vector3.subtract(hit, center)
  return Math.atan2(Vector3.dot(rel, v), Vector3.dot(rel, u))
}

function captureGroup(): GroupEntry[] {
  const out: GroupEntry[] = []
  for (const id of topLevelSelected(state.snapshot)) {
    const wt = worldTransformOf(state.snapshot, id)
    if (wt === null) continue
    const t = state.snapshot[id]?.Transform as
      | { position?: Local; rotation?: LocalRot; scale?: Local; parent?: number }
      | undefined
    out.push({
      id,
      startWorldPos: { ...wt.position },
      startWorldRot: { ...wt.rotation },
      position: t?.position ?? { x: 0, y: 0, z: 0 },
      rotation: t?.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
      scale: t?.scale ?? { x: 1, y: 1, z: 1 },
      parent: t?.parent ?? 0
    })
  }
  return out
}

function pointerRay(): { origin: Vector3; dir: Vector3 } | null {
  const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const camT = Transform.getOrNull(engine.CameraEntity)
  if (p?.worldRayDirection === undefined || camT === null) return null
  return { origin: camT.position, dir: p.worldRayDirection as Vector3 }
}

function beginDrag(entry: HandleEntry): void {
  if (state.activeEntity === null || gizmoRoot === null) return
  const ray = pointerRay()
  if (ray === null) return
  const rootT = Transform.get(gizmoRoot)
  const center = { ...rootT.position }
  const gizmoScale = rootT.scale.x
  const kind = entry.kind

  let planeNormal: Vector3
  let axisDir: Vector3 | undefined
  let startAngle: number | undefined

  const camT = Transform.getOrNull(engine.CameraEntity)
  const camForward = camT === null ? Vector3.Forward() : Vector3.rotate(Vector3.Forward(), camT.rotation)

  if (kind.op === 'translate-axis') {
    axisDir = axisVec(kind.axis)
    planeNormal = axisDragPlaneNormal(axisDir, camForward)
  } else if (kind.op === 'translate-plane') {
    planeNormal = axisVec(kind.normal)
  } else if (kind.op === 'rotate') {
    planeNormal = axisVec(kind.axis)
  } else if (kind.op === 'scale-axis') {
    // scale handles are world-aligned like the rest of the gizmo
    axisDir = axisVec(kind.axis)
    planeNormal = axisDragPlaneNormal(axisDir, camForward)
  } else {
    // uniform: drag on the camera-facing plane
    planeNormal = Vector3.scale(camForward, -1)
  }

  const startHit = rayPlaneIntersect(ray.origin, ray.dir, center, planeNormal)
  if (startHit === null) return
  if (kind.op === 'rotate') startAngle = angleOnPlane(startHit, center, planeNormal)

  const group = captureGroup()
  // selection anchor at drag start: centroid of the group (the gizmo root sits
  // at anchor + top offset, so derive the anchor from the group, not the root)
  let anchorStart: Vector3 | undefined
  if (group.length > 0) {
    let sum = Vector3.Zero()
    for (const g of group) sum = Vector3.add(sum, g.startWorldPos)
    anchorStart = Vector3.scale(sum, 1 / group.length)
  }
  drag = {
    kind,
    entry,
    center,
    anchorStart,
    planeNormal,
    startHit,
    axisDir,
    startAngle,
    gizmoScale,
    group
  }
  liveDelta = null
  liveRoots = new Set(drag.group.map((g) => g.id))
  state.gizmoDragging = true
}

export function endGizmoDrag(): void {
  if (drag === null) {
    state.gizmoDragging = false
    return
  }
  drag = null
  liveDelta = null
  liveRoots = null
  state.gizmoDragging = false
  for (const h of handles) applyMaterial(h, false)
}

function writeEntry(g: GroupEntry, t: { position: Local; rotation: LocalRot; scale: Local }): void {
  fireTransform(
    g.id,
    JSON.stringify({ position: t.position, rotation: t.rotation, scale: t.scale, parent: g.parent })
  )
}

function updateDrag(): void {
  const d = drag
  if (d === null) return
  const ray = pointerRay()
  if (ray === null) return
  const hit = rayPlaneIntersect(ray.origin, ray.dir, d.center, d.planeNormal)
  if (hit === null) return

  if (d.kind.op === 'translate-axis' || d.kind.op === 'translate-plane') {
    const worldDelta = Vector3.subtract(hit, d.startHit)
    let constrained: Vector3
    if (d.kind.op === 'translate-axis') {
      const along = Vector3.dot(worldDelta, d.axisDir as Vector3)
      constrained = Vector3.scale(d.axisDir as Vector3, along)
    } else {
      const [a, b] = otherAxes(d.kind.normal)
      const da = axisVec(a)
      const db = axisVec(b)
      constrained = Vector3.add(
        Vector3.scale(da, Vector3.dot(worldDelta, da)),
        Vector3.scale(db, Vector3.dot(worldDelta, db))
      )
    }
    liveDelta = constrained
    for (const g of d.group) {
      const newWorld = Vector3.add(g.startWorldPos, constrained)
      const localPos = worldToLocalPosition(state.snapshot, g.id, newWorld)
      if (localPos === null) continue
      writeEntry(g, { position: localPos, rotation: g.rotation, scale: g.scale })
    }
  } else if (d.kind.op === 'rotate') {
    const angle = angleOnPlane(hit, d.center, d.planeNormal)
    const degrees = ((angle - (d.startAngle as number)) * 180) / Math.PI
    const incremental = Quaternion.fromAngleAxis(degrees, d.planeNormal)
    for (const g of d.group) {
      // rotate each entity about its own origin (positions unchanged)
      const newWorldRot = Quaternion.multiply(incremental, g.startWorldRot)
      const localRot = worldToLocalRotation(state.snapshot, g.id, newWorldRot)
      writeEntry(g, { position: g.position, rotation: localRot ?? g.rotation, scale: g.scale })
    }
  } else {
    // scale: displacement along the drag direction, exponential feel
    let disp: number
    if (d.kind.op === 'scale-axis') {
      disp = Vector3.dot(Vector3.subtract(hit, d.startHit), d.axisDir as Vector3)
    } else {
      const rel = Vector3.subtract(hit, d.startHit)
      disp = (rel.x + rel.y) / 2 + rel.z / 2
    }
    const factor = Math.max(0.01, 1 + disp / Math.max(0.001, d.gizmoScale * 1.5))
    for (const g of d.group) {
      const scale =
        d.kind.op === 'scale-uniform'
          ? { x: g.scale.x * factor, y: g.scale.y * factor, z: g.scale.z * factor }
          : {
              x: d.kind.axis === 'x' ? g.scale.x * factor : g.scale.x,
              y: d.kind.axis === 'y' ? g.scale.y * factor : g.scale.y,
              z: d.kind.axis === 'z' ? g.scale.z * factor : g.scale.z
            }
      writeEntry(g, { position: g.position, rotation: g.rotation, scale })
    }
  }
}

// ---- systems ----

function gizmoActive(): boolean {
  const mode = state.activeAction
  return (
    state.status === 'ready' &&
    (mode === 'translate' || mode === 'rotate' || mode === 'scale') &&
    state.activeEntity !== null &&
    state.snapshot[state.activeEntity] !== undefined
  )
}

function gizmoSystem(_dt: number): void {
  // drag lifecycle first: ends on the engine's release, or page bus pointer-up
  if (drag !== null) {
    if (
      inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP) ||
      !inputSystem.isPressed(InputAction.IA_POINTER)
    ) {
      endGizmoDrag()
    } else {
      updateDrag()
    }
  }

  if (!gizmoActive()) {
    if (gizmoRoot !== null) destroyGizmo()
    return
  }

  const sig = `${state.activeAction}`
  if (gizmoRoot === null || builtSig !== sig) {
    buildGizmo(state.activeAction)
    builtSig = sig
  }

  // Anchor on the selection: the active entity alone, or the centroid of the
  // top-level selection when several are selected (a centroid behaves sanely
  // no matter which entity happens to be 'active').
  const active = state.activeEntity as string
  if (gizmoRoot === null) return
  const roots = topLevelSelected(state.snapshot)
  let anchor: Vector3 | null = null
  if (roots.length > 1) {
    let sum = Vector3.Zero()
    let n = 0
    for (const id of roots) {
      const w = worldTransformOf(state.snapshot, id)
      if (w === null) continue
      sum = Vector3.add(sum, w.position)
      n++
    }
    if (n > 0) anchor = Vector3.scale(sum, 1 / n)
  }
  if (anchor === null) {
    const wt = worldTransformOf(state.snapshot, active)
    if (wt === null) return
    anchor = wt.position
  }
  // The gizmo sits AT the pivot (Roblox-style) — no model-size offset, so its
  // placement and size are independent of how big the selected model is.
  const camT = Transform.getOrNull(engine.CameraEntity)
  let base = anchor
  if (drag !== null && liveDelta !== null && drag.anchorStart !== undefined) {
    base = Vector3.add(drag.anchorStart, liveDelta)
  }

  // Constant screen-size: scale purely with camera distance (× FACTOR), so the
  // gizmo holds a fixed fraction of the viewport and never grows/shrinks as you
  // approach or leave the model. The clamp is just a far-range safety net.
  const dist = camT === null ? 8 : Vector3.distance(camT.position, base)
  const s = Math.min(GIZMO_MAX_SCALE, Math.max(GIZMO_MIN_SCALE, dist * GIZMO_SCALE_FACTOR))

  // Nudge a hair toward the camera (proportional to the gizmo's own size, not
  // the model's) so the handles aren't buried in the mesh surface.
  let pos = base
  if (camT !== null) {
    const toCam = Vector3.subtract(camT.position, base)
    const len = Vector3.length(toCam)
    if (len > 0.01) {
      const off = Math.min(s * 0.5, len * 0.5)
      pos = Vector3.add(base, Vector3.scale(toCam, off / len))
    }
  }

  const t = Transform.getMutable(gizmoRoot)
  t.position = { ...pos }
  t.rotation = Quaternion.Identity() // world-aligned, opendcl style
  t.scale = Vector3.create(s, s, s)
}

// Map a snapshot world position to its live in-drag position (overlays follow
// the drag before the snapshot settles). Identity when not dragging.
export function liveWorldPos(id: string, snapshotWorld: Vector3): Vector3 {
  if (drag === null || liveDelta === null || liveRoots === null) return snapshotWorld
  let cur: string | null = id
  while (cur !== null) {
    if (liveRoots.has(cur)) return Vector3.add(snapshotWorld, liveDelta)
    cur = parentOf(state.snapshot, cur)
  }
  return snapshotWorld
}

export function setupGizmo(): void {
  engine.addSystem(gizmoSystem)
}
