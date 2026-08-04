// Transport: play / pause / step, and the composite save that has to happen
// before the scene starts running.
import { state } from '@scene/state'
import { pauseScene, playScene, stepScene, saveCompositeDirect } from '@scene/inspector'
import { type CameraMode } from '@scene/bridge-protocol'
import { cmd } from '../engine/cmd'
import { flushPendingSave } from '../core/autosave'
import { awaitFreshBundle, noteSceneUpToDate, sceneNeedsReload, wireSceneHealth } from '../features/editor/scene-health'
import { refreshAuthoredIds } from '../panels/authored-ids'
import { autoHideSceneUi, releaseAutoHiddenSceneUi } from '../engine/scene-ui'
import { run } from './run'
import { uiSetCamera } from './selection'

// The editor camera active when Play was pressed, restored on Pause. Play hands
// control to the player camera: the pointer ray is cast from the ACTIVE camera
// and scene interactions default to a 10m camera-distance rule, so running the
// scene from a fly/orbit camera leaves every clickable out of range (and the
// avatar input-locked) — nothing like the real preview.
let prePlayCam: CameraMode | null = null

export const uiPause = async (): Promise<void> => {
  await run(pauseScene(), false)
  autoHideSceneUi() // back to editing: the HUD stops being the game again
  if (prePlayCam !== null) {
    uiSetCamera(prePlayCam)
    prePlayCam = null
  }
}

// how long a freshly reloaded scene gets to spawn before Play unfreezes it
const RELOAD_SETTLE_MS = 2_100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Play must never resume a scene instance older than the code it is about to run.
// Unfreezing only continues the instance the engine already has, and a script
// attached (or edited) since that instance loaded was never instantiated, so it
// silently does nothing.
//
// But only reload when something actually needs it. A nudged gizmo rewrites
// main.composite and rebuilds the bundle too, and its value is already in the
// running scene's CRDT — reloading for that would cost a respawn to show what is
// on screen already. sceneNeedsReload() is the whole decision.
async function waitForFreshBuild(): Promise<void> {
  wireSceneHealth()
  if (!sceneNeedsReload()) return
  state.saveStatus = 'rebuilding the scene before play…'
  await awaitFreshBundle()
  await cmd.reload().then(noteSceneUpToDate).catch(() => {})
  // give the fresh instance a beat to spawn; playScene re-pins if the old one died
  await sleep(RELOAD_SETTLE_MS)
  state.saveStatus = ''
}

export const uiPlay = async (): Promise<void> => {
  // persist edit-mode changes before the scene starts running — once playing,
  // edits become runtime-only (not saved), so this is the last authored save
  await flushPendingSave()
  await waitForFreshBuild()
  if (state.camMode !== 'none') {
    prePlayCam = state.camMode === 'free' ? 'free' : 'target'
    uiSetCamera('off')
  } else {
    prePlayCam = null
  }
  // the scene's UI is the game once it runs — never preview it with the HUD blanked
  await releaseAutoHiddenSceneUi()
  await run(playScene(), false)
}

export const uiStep = async (count = 1): Promise<void> => {
  await run(stepScene(count), false)
}

export const uiSave = async (): Promise<void> => {
  // failures land in state.saveStatus (shown as a toast)
  await run(saveCompositeDirect().catch(() => {}), false)
  // the composite just gained whatever was created this session — re-read the
  // authored set so those rows move out of "Made by your code"
  refreshAuthoredIds()
}
