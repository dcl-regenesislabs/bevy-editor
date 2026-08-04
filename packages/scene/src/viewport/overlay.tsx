import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import {
  engine,
  inputSystem,
  InputAction,
  PointerEventType,
  PrimaryPointerInfo
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { state, applyBoxSelection } from '../state'
import { computeWorldPositions, shouldMark } from '../world-pos'
import { projectWorldToScreen } from '../camera/camera-projection'
import { liveWorldPos, gizmoCameraEntity } from './gizmo'
import { pickAtPointer } from './click-select'
import { relationsCameraEntity } from './relations'

const BOX_ADD = Color4.create(0.35, 0.9, 0.45, 1)
const BOX_REMOVE = Color4.create(1, 0.4, 0.35, 1)
const BOX_REPLACE = Color4.create(0.4, 0.7, 1, 1)

// Screen positions (px) of the box-select candidates, for box hit-testing.
const lastMarkers = new Map<string, { x: number; y: number }>()

// In the scene, IaModifier is shift and IaWalk is ctrl.
function clickModifiers(): { shift: boolean; ctrl: boolean } {
  return {
    shift: inputSystem.isPressed(InputAction.IA_MODIFIER),
    ctrl: inputSystem.isPressed(InputAction.IA_WALK)
  }
}

function pointerXY(): { x: number; y: number } | null {
  const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenCoordinates
  return p === undefined ? null : { x: p.x, y: p.y }
}

// Commit the drag-box and clear it. Idempotent (no-op once cleared).
function finishBox(): void {
  const box = state.selectBox
  if (box === null) return
  state.selectBox = null
  // A no-drag tap is a model pick, not an empty box-select.
  if (Math.abs(box.curX - box.startX) < 4 && Math.abs(box.curY - box.startY) < 4) {
    pickAtPointer(box.add, box.remove)
    return
  }
  const minX = Math.min(box.startX, box.curX)
  const maxX = Math.max(box.startX, box.curX)
  const minY = Math.min(box.startY, box.curY)
  const maxY = Math.max(box.startY, box.curY)
  const ids: string[] = []
  for (const [id, p] of lastMarkers) {
    if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) ids.push(id)
  }
  applyBoxSelection(ids, box.add, box.remove)
}

// Drive the drag-box from the live pointer-pressed state rather than UI up/drag
// events: those are missed when the release lands on a marker (which renders on
// top of the surface), wedging the box. onMouseDown still starts it (so we know
// the press began on empty space); this updates and finalizes it.
export function startSelectBox(): void {
  engine.addSystem(() => {
    const box = state.selectBox
    if (box === null) {
      // There is no box surface (a blocking UI plane would shadow the engine's
      // world raycast and break click-to-pick) — start the box from raw input
      // instead. DOM panel clicks never reach the canvas, so this only fires
      // for viewport presses.
      if (
        // playing: clicks belong to the running scene, not box-select
        state.frozen &&
        state.activeAction === 'select' &&
        !state.gizmoDragging &&
        state.gizmoHover === null &&
        inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)
      ) {
        const xy = pointerXY()
        if (xy !== null) {
          const { shift, ctrl } = clickModifiers()
          state.selectBox = { startX: xy.x, startY: xy.y, curX: xy.x, curY: xy.y, add: shift, remove: ctrl }
        }
      }
      return
    }
    if (inputSystem.isPressed(InputAction.IA_POINTER)) {
      const xy = pointerXY()
      if (xy !== null) {
        box.curX = xy.x
        box.curY = xy.y
      }
      // Track the modifier live so add/remove reflect the state at release, not
      // at press (and the rubber-band colour updates as you hold shift/ctrl).
      const { shift, ctrl } = clickModifiers()
      box.add = shift
      box.remove = ctrl
    } else {
      finishBox()
    }
  })
}

// The rubber-band rectangle while a drag-box is in progress.
function selectionBox(): ReactEcs.JSX.Element | [] {
  const b = state.selectBox
  if (b === null) return []
  const color = b.remove ? BOX_REMOVE : b.add ? BOX_ADD : BOX_REPLACE
  return (
    <UiEntity
      key="selbox"
      uiTransform={{
        positionType: 'absolute',
        position: { left: Math.min(b.startX, b.curX), top: Math.min(b.startY, b.curY) },
        width: Math.abs(b.curX - b.startX),
        height: Math.abs(b.curY - b.startY),
        borderWidth: 1,
        borderColor: color,
        pointerFilter: 'none'
      }}
      uiBackground={{ color: { ...color, a: 0.15 } }}
    />
  )
}

// Box-select support for the 'select' action. Models are clicked directly
// (pickAtPointer) and selection is shown by the gizmo + the model's highlight
// outline, so nothing is drawn per entity — this overlay records candidate
// screen positions for box hit-testing and draws the rubber-band rectangle.
// The container passes the pointer through (`pointerFilter: 'none'`).
export function overlayUi(): ReactEcs.JSX.Element | null {
  if (state.status !== 'ready') return null

  // With a host-page UI attached, models are clicked directly (pickAtPointer) —
  // no marker buttons. Only subtle rings on selected entities remain as
  const selecting = state.activeAction === 'select'

  const worldPositions = computeWorldPositions(state.snapshot)
  if (worldPositions === null) return null

  lastMarkers.clear()
  for (const [id, world] of worldPositions) {
    if (!shouldMark(state.snapshot, id)) continue
    // Follow live in-drag positions while a gizmo drag is in progress.
    const screen = projectWorldToScreen(liveWorldPos(id, world))
    if (screen === null || !screen.onScreen) continue
    lastMarkers.set(id, { x: screen.left, y: screen.top })
  }

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
    >
      {selecting ? selectionBox() : []}
    </UiEntity>
  )
}

// Root UI renderer for the scene (set via ReactEcsRenderer in index.ts). The
// host-page React app (packages/ui) is the editor's only panel UI; the scene
// renders ONLY the viewport layers it must own because they need engine camera
// projection: the parent/child relations overlay and the select-tool drag-box.
export function inspectorUi(): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
    >
      {relationsPanel() ?? []}
      {overlayUi() ?? []}
      {gizmoPanel() ?? []}
    </UiEntity>
  )
}

// The transform gizmo: a dedicated camera (gizmo.ts, GIZMO_LAYER) renders the
// handles to a texture with no depth-of-field; paint it over the viewport (above
// the relations lines and markers) so the handles read on top and stay crisp.
// pointerFilter 'none' — the gizmo resolves hover/grab analytically from the raw
// pointer (gizmoSystem), not from UI events, so the panel must pass clicks through.
function gizmoPanel(): ReactEcs.JSX.Element | null {
  const tool = state.activeAction
  if (state.status !== 'ready' || state.activeEntity === null) return null
  if (tool !== 'translate' && tool !== 'rotate' && tool !== 'scale') return null
  const cam = gizmoCameraEntity()
  if (cam === null) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
      uiBackground={{ textureMode: 'stretch', videoTexture: { videoPlayerEntity: cam } }}
    />
  )
}

// Parent/child links: a dedicated camera (relations.ts) renders the link lines to
// a texture; paint it over the viewport while something is selected.
function relationsPanel(): ReactEcs.JSX.Element | null {
  if (state.selected.size === 0) return null
  const cam = relationsCameraEntity()
  if (cam === null) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
      uiBackground={{ textureMode: 'stretch', videoTexture: { videoPlayerEntity: cam } }}
    />
  )
}
