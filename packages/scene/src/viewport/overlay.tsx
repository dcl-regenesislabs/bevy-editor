import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import {
  engine,
  inputSystem,
  InputAction,
  PointerEventType,
  PrimaryPointerInfo
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  state,
  selectEntityInTree,
  selectionClick,
  applyBoxSelection,
  entityLabel
} from '../state'
import { computeWorldPositions, shouldMark } from '../world-pos'
import { projectWorldToScreen } from '../camera/camera-projection'
import { liveWorldPos, gizmoCameraEntity } from './gizmo'
import { pickAtPointer } from './click-select'
import { relationsCameraEntity } from './relations'

const CIRCLE_D = 16
const MARKER = Color4.create(0.4, 0.85, 1, 1)
const MARKER_HOVER = Color4.create(1, 0.85, 0.3, 1)
const MARKER_SELECTED = Color4.create(0.35, 0.9, 0.45, 1)
const MARKER_ACTIVE = Color4.create(1, 0.6, 0.2, 1)
const TIP_BG = Color4.create(0, 0, 0, 0.8)
const BOX_ADD = Color4.create(0.35, 0.9, 0.45, 1)
const BOX_REMOVE = Color4.create(1, 0.4, 0.35, 1)
const BOX_REPLACE = Color4.create(0.4, 0.7, 1, 1)

// Screen positions (px) of the markers as last rendered, for box hit-testing.
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
  // A no-drag tap in page-UI mode is a model pick, not an empty box-select.
  if (
    state.pageUi &&
    Math.abs(box.curX - box.startX) < 4 &&
    Math.abs(box.curY - box.startY) < 4
  ) {
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
      // Page-UI mode has no box surface (a blocking UI plane would shadow the
      // engine's world raycast and break click-to-pick) — start the box from
      // raw input instead. DOM panel clicks never reach the canvas, so this
      // only fires for viewport presses.
      if (
        state.pageUi &&
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

// A full-screen surface (behind the markers) that turns empty-space drags into a
// box-select. The markers, rendered on top, still take their own clicks.
function boxSurface(): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key="box-surface"
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'block'
      }}
      onMouseDown={() => {
        const xy = pointerXY()
        if (xy === null) return
        const { shift, ctrl } = clickModifiers()
        state.selectBox = { startX: xy.x, startY: xy.y, curX: xy.x, curY: xy.y, add: shift, remove: ctrl }
      }}
    />
  )
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

// Tooltip rendered as a top-level overlay child (not a child of the tiny
// circle, which would constrain its text box to ~1 char and wrap per-letter).
function tooltip(id: string, left: number, top: number): ReactEcs.JSX.Element {
  const text = entityLabel(id)
  const width = Math.max(56, text.length * 9 + 16)
  return (
    <UiEntity
      key="overlay-tooltip"
      uiTransform={{
        positionType: 'absolute',
        position: { left: left + CIRCLE_D / 2 + 4, top: top - 22 },
        width,
        height: 20,
        padding: { left: 6, right: 6 },
        alignItems: 'center'
      }}
      uiBackground={{ color: TIP_BG }}
      uiText={{
        value: text,
        fontSize: 13,
        color: Color4.White(),
        textAlign: 'middle-left'
      }}
    />
  )
}

function markerColor(id: string, hovered: boolean): Color4 {
  if (hovered) return MARKER_HOVER
  if (state.activeEntity === id) return MARKER_ACTIVE
  if (state.selected.has(id)) return MARKER_SELECTED
  return MARKER
}

function marker(
  id: string,
  left: number,
  top: number,
  hovered: boolean,
  interactive: boolean
): ReactEcs.JSX.Element {
  const color = markerColor(id, hovered)
  const selected = state.selected.has(id)
  return (
    <UiEntity
      key={`marker-${id}`}
      uiTransform={{
        width: CIRCLE_D,
        height: CIRCLE_D,
        positionType: 'absolute',
        position: { left: left - CIRCLE_D / 2, top: top - CIRCLE_D / 2 },
        borderRadius: 999,
        borderWidth: 2,
        borderColor: color,
        pointerFilter: interactive ? 'block' : 'none'
      }}
      uiBackground={{ color: { ...color, a: selected ? 0.6 : 0.35 } }}
      onMouseEnter={
        interactive
          ? () => {
              state.hoveredOverlay = id
            }
          : undefined
      }
      onMouseLeave={
        interactive
          ? () => {
              if (state.hoveredOverlay === id) state.hoveredOverlay = null
            }
          : undefined
      }
      onMouseDown={
        interactive
          ? () => {
              const { shift, ctrl } = clickModifiers()
              selectionClick(id, shift, ctrl)
              if (state.selected.has(id)) selectEntityInTree(state.snapshot, id)
            }
          : undefined
      }
    />
  )
}

// World-space markers for the 'select' action: a circle at each qualifying
// entity's origin, projected to screen. The container passes the pointer
// through (`pointerFilter: 'none'`); only the circles capture hover/click.
export function overlayUi(): ReactEcs.JSX.Element | null {
  if (state.status !== 'ready') return null

  // With a host-page UI attached, models are clicked directly (pickAtPointer) —
  // no marker buttons. Only subtle rings on selected entities remain as
  // feedback, plus the select tool's drag-box (hit-testing entity positions).
  const pageUi = state.pageUi
  // Select mode shows all nodes interactively; outside it, the node-display
  // setting governs whether markers appear (all / only selected / none).
  const selecting = state.activeAction === 'select'
  const showAll = !pageUi && (selecting || state.nodeDisplay === 'always')
  const showSelected = pageUi || state.nodeDisplay === 'selected'
  if (!showAll && !showSelected && !(pageUi && selecting)) return null

  const worldPositions = computeWorldPositions(state.snapshot)
  if (worldPositions === null) return null

  const markers: ReactEcs.JSX.Element[] = []
  let hoveredTip: ReactEcs.JSX.Element | null = null
  lastMarkers.clear()
  for (const [id, world] of worldPositions) {
    if (!shouldMark(state.snapshot, id)) continue
    // Follow live in-drag positions while a gizmo drag is in progress.
    const screen = projectWorldToScreen(liveWorldPos(id, world))
    if (screen === null || !screen.onScreen) continue
    // box-select hit-testing needs every candidate position, drawn or not
    lastMarkers.set(id, { x: screen.left, y: screen.top })
    if (!showAll && !state.selected.has(id)) continue
    if (pageUi) {
      // selection is already shown by the on-top gizmo at the origin and the
      // model's highlight outline — the origin ring + id badge were redundant
      // clutter, so we don't draw them.
      continue
    }
    const hovered = state.hoveredOverlay === id
    markers.push(marker(id, screen.left, screen.top, hovered, selecting))
    if (hovered && selecting) hoveredTip = tooltip(id, screen.left, screen.top)
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
      {selecting && !pageUi ? boxSurface() : []}
      {markers}
      {selecting ? selectionBox() : []}
      {hoveredTip ?? []}
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
