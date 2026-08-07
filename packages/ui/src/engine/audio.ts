// Global mute for everything the engine plays — scene AudioSources, streams,
// video textures — without touching the scene.
//
// Why not write volume: 0 onto the scene's audio components, the way scene-ui.ts
// hides UiTransform roots? Those components sit on AUTHORED entities, so a zeroed
// volume is a real edit: save-diff would see it and autosave would write silence
// into main.composite. The engine's own settings are the level below: "Master
// Volume" (AudioSettings.master in bevy-explorer) multiplies into every playback
// path — bevy audio and the scene's <video>/<audio> elements alike, which the
// engine re-volumes itself whenever the setting moves. It lives in the engine's
// config, not the scene, so the CRDT never changes and save-diff never fires.
//
// setSetting is the same ~system/BevyExplorerApi surface graphics-preset.ts
// already drives, proxied to the editor scene over the bus (page-ui.ts).
import { reactive } from '../core/store'
import { setStoredFlag, storedFlag } from '../core/persist'
import { BevyApi } from './bevy-api-web'

// Persisted because the engine persists too: master 0 lands in its config file,
// so a crash while muted would otherwise come back silent under an unmuted UI.
// Keeping the flag and re-asserting on scene-ready means the two can't drift.
const MUTED_KEY = 'scene-muted'

export const sceneAudio = reactive({ muted: storedFlag(MUTED_KEY, false) })

function apply(): void {
  BevyApi.setSetting('Master Volume', sceneAudio.muted ? 0 : 100).catch((e) => {
    console.warn('[audio] setSetting Master Volume failed:', e)
  })
}

export function toggleSceneAudio(): void {
  sceneAudio.muted = !sceneAudio.muted
  setStoredFlag(MUTED_KEY, sceneAudio.muted)
  apply()
}

// A scene instance that just booted (or came back from Stop) never heard the
// toggle, and the engine's persisted config may disagree with the flag (cleared
// storage, crash mid-toggle). boot.ts calls this from scene-ready, next to the
// set-flags restatement that exists for the same reason.
export function reassertSceneAudio(): void {
  apply()
}
