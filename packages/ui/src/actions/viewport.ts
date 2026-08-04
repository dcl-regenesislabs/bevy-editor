// Viewport display toggles. These live scene-side (it owns the drag math and the
// debug draw), so each one travels over the bus or a console command rather than
// being read off the page's own copy of state.
import { state } from '@scene/state'
import { PICK_LAYER } from '@scene/viewport/pick-layer'
import { sendToScene } from '../engine/bus'
import { launchParam } from '../boot/launch-params'
import { cmd } from '../engine/cmd'
import { run } from './run'

// every collision layer except the editor's own pick overlay
const ALL_LAYERS_BUT_PICK = ~PICK_LAYER >>> 0

// Draw scene.json's spawn points in the viewport. Nothing authors them in this
// editor yet, so a scene made here has none to show — it earns its keep on
// imported projects, where walling off the spawn point is easy to do by accident.
export const uiToggleSpawnAreas = (): void => {
  state.showSpawnAreas = !state.showSpawnAreas
  void sendToScene({ type: 'set-flags', showSpawnAreas: state.showSpawnAreas })
  // scene.json without spawnPoints is the common case — the overlay then has
  // nothing to draw, which used to read as the toggle being broken
  if (state.showSpawnAreas && !hasAuthoredSpawnPoints()) {
    state.saveStatus = 'no spawn points in scene.json — the ghost figure marks the default spot. Add your own in Scene settings'
  }
}

function hasAuthoredSpawnPoints(): boolean {
  try {
    const parsed: unknown = JSON.parse(launchParam('spawnPoints') ?? '[]')
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

// Snap gizmo drags to the grid. The scene owns the drag math, so the flag has to
// travel over the bus — the page's own copy of state is a separate module
// instance. Holding Shift while dragging inverts whatever this is set to.
export const uiToggleSnap = (): void => {
  state.snap = !state.snap
  void sendToScene({ type: 'set-flags', snap: state.snap })
}

// Show/hide the engine's collider debug volumes. Masked to exclude the editor's
// own pick layer (PICK_LAYER, written engine-only onto every renderable so
// clicking works) — otherwise every model in the scene sprouts a debug box.
export const uiToggleColliders = async (): Promise<void> => {
  const on = !state.showColliders
  state.showColliders = on
  await run(cmd.debugColliders(on ? ALL_LAYERS_BUT_PICK : 0))
}
