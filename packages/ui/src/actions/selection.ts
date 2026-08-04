// Selection, tool and camera. Each change mirrors to the scene over the bus so
// the gizmos stay in sync with what the panels show.
import { state, selectionClick, setActiveAction, clearSelection } from '@scene/state'
import { type EditorTool, type CameraMode } from '@scene/bridge-protocol'
import { sendToScene } from '../engine/bus'

export function syncSelectionToScene(): void {
  void sendToScene({
    type: 'set-selection',
    selected: [...state.selected],
    active: state.activeEntity
  })
}

export function uiSelectEntity(id: string, additive: boolean, toggle: boolean): void {
  selectionClick(id, additive, toggle)
  syncSelectionToScene()
}

export function uiClearSelection(): void {
  clearSelection()
  syncSelectionToScene()
}

export function uiSetTool(tool: EditorTool): void {
  setActiveAction(tool)
  void sendToScene({ type: 'set-tool', tool: state.activeAction as EditorTool })
}

export function uiSetCamera(mode: CameraMode, axis?: string): void {
  state.camMode = mode === 'off' ? 'none' : mode
  void sendToScene({ type: 'set-camera', mode, axis })
}

export function uiFocusEntity(id: string): void {
  state.camMode = 'free' // focus flies the free camera to it; it never orbits
  void sendToScene({ type: 'focus', entity: id })
}

// A fresh entity wants its gizmo: hop from the select tool to move so the
// just-created/imported model can be placed immediately.
export function ensureTransformTool(): void {
  if (state.activeAction === 'select') uiSetTool('translate')
}

// Whatever was just dropped lands at the parcel centre — fly the camera to it so
// it's actually visible (otherwise it lands off-screen and feels like nothing happened).
export function focusPlaced(): void {
  if (state.activeEntity === null) return
  state.camMode = 'free'
  void sendToScene({ type: 'focus', entity: state.activeEntity, orbit: false })
}
