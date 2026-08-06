// Global mute for everything the engine plays — scene AudioSources, streams,
// video textures — without touching the scene or the engine.
//
// Why not write volume: 0 onto the scene's audio components, the way scene-ui.ts
// hides UiTransform roots? Those components sit on AUTHORED entities, so a zeroed
// volume is a real edit: save-diff would see it and autosave would write silence
// into main.composite. Muting must leave the scene untouched, so it happens one
// level down, in the browser — the engine's AudioContext is suspended and its
// media elements muted. Nothing in the CRDT changes, nothing is saved, and a
// restart has nothing to restore.
//
// The engine document owns the audio and is same-origin (the desktop server puts
// the UI and the engine dir under one origin — ARCHITECTURE §5), so the host page
// can reach into it. ./audio-control.ts is the half that runs over there.
import { reactive } from '../core/store'
import { getEngineWindow } from './console'
import type { EngineAudioWindow } from './audio-control'

export const sceneAudio = reactive({ muted: false })

export function toggleSceneAudio(): void {
  const next = !sceneAudio.muted
  sceneAudio.muted = next
  const win = getEngineWindow() as EngineAudioWindow
  const control = win.__editorAudio
  if (control !== undefined) {
    control.setMuted(next)
    return
  }
  // The in-page editor attaches to an engine this bundle never booted, so the
  // constructor hook was never installed there. Media elements are still
  // reachable; say what didn't happen rather than report a mute that half worked.
  for (const el of win.document.querySelectorAll('audio, video')) {
    ;(el as HTMLMediaElement).muted = next
  }
  console.warn('[audio] engine audio control not installed — muted media elements only')
}
