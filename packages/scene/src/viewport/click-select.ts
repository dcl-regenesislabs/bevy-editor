// Click-to-select on the actual models (host-page UI mode). A clean canvas tap
// resolves the engine's raycast target (/pointer_target — anything with a
// collider) into the selection; shift adds, ctrl/cmd toggles. Taps are detected
// scene-side from the engine's pointer input (see startGizmoPick / overlay.tsx),
// not from the DOM bus tap, which is unreliable in the iframed host.
//
// Selection is sticky: a tap that hits nothing (sky, another scene, a spot
// with no collider) keeps the current selection — deselection is explicit
// (hierarchy, or toggling the selected model).
import {
  engine,
  inputSystem,
  InputAction,
  PointerEventType,
  PrimaryPointerInfo
} from '@dcl/sdk/ecs'
import { cmd } from '../cmd'
import { state, selectionClick, setActiveAction, parentOf } from '../state'
import { NAME_COMPONENT } from '../custom-components'

// Only authored entities (those carrying a Name) are selectable: a click on a
// child mesh resolves to its nearest named ancestor; a hit with no named
// ancestor is ignored (selection stays sticky).
function namedAncestor(id: string): string | null {
  let cur: string | null = id
  while (cur !== null && cur !== '0') {
    if (state.snapshot[cur]?.[NAME_COMPONENT] !== undefined) return cur
    cur = parentOf(state.snapshot, cur)
  }
  return null
}

export function pickAtPointer(add: boolean, toggle: boolean): void {
  cmd.pointerTarget()
    .then((t) => {
      if (t === null || t.scene !== state.scene?.hash) return
      const hit = String(t.entity)
      if (!(hit in state.snapshot)) return
      // never select UI nodes or reserved entities (leaderboard rows etc.)
      if (Number(hit) < 512) return
      const id = namedAncestor(hit)
      if (id === null) return
      selectionClick(id, add, toggle)
      // clicking a model means you want to manipulate it — bring up the move
      // gizmo right away (the page learns of the tool change via the bus)
      if (state.selected.has(id) && state.activeAction === 'select') {
        setActiveAction('translate')
      }
    })
    .catch(() => {})
}

// Tap-to-pick while a transform gizmo is up (translate/rotate/scale). Select
// mode has its own engine-input tap path (overlay.tsx's box-select); the gizmo
// modes had none, so clicking a DIFFERENT model while a gizmo showed did nothing
// (the reported bug). This drives the pick from the engine's pointer input.
//
// A press that lands on a gizmo handle starts a DRAG, not a pick: detected by
// the press beginning while a handle is hovered (state.gizmoHover) and by
// cancelling any pending tap once a drag goes live (state.gizmoDragging).
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
    // a drag began on a handle between press and release — never a selection pick
    if (state.gizmoDragging) pickDownXY = null

    const p = PrimaryPointerInfo.getOrNull(engine.RootEntity)?.screenCoordinates

    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN)) {
      // pressing while hovering a handle is a drag, not a pick
      pickDownXY = state.gizmoHover === null && p !== undefined ? { x: p.x, y: p.y } : null
      return
    }
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_UP)) {
      const down = pickDownXY
      pickDownXY = null
      if (down === null) return
      // a press that moved is a camera look / gizmo drag, not a clean tap
      if (p !== undefined && (Math.abs(p.x - down.x) > 4 || Math.abs(p.y - down.y) > 4)) return
      const add = inputSystem.isPressed(InputAction.IA_MODIFIER)
      const toggle = inputSystem.isPressed(InputAction.IA_WALK)
      pickAtPointer(add, toggle)
    }
  })
}

// Mirror the selection into the engine's outline highlight (/highlight) so the
// picked models read as selected in the viewport, whatever path changed the
// selection (world click, hierarchy, box select, undo).
export function startSelectionHighlight(): void {
  let lastSig = ''
  engine.addSystem(() => {
    if (state.status !== 'ready') return
    const ids = [...state.selected].sort()
    const sig = ids.join(',')
    if (sig === lastSig) return
    lastSig = sig
    cmd.highlight(ids).catch(() => {})
  })
}
