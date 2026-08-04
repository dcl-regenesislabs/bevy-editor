/// <reference types="vite/client" />
// Dev-only: when the editor scene's bin rebuilds, the dev server (scripts/dev.mjs)
// emits the `editor:reload-scene` HMR event. Scene code can't hot-swap (it runs in
// the engine sandbox, not the page), but we can reload ONLY the editor (super-user)
// scene IN PLACE via the engine's `/reload <hash>` — no engine reboot, no page
// reload, no "Connecting" overlay; the project scene + camera stay put.
//
// `import.meta.hot` is defined only in Vite dev; in the production build it's
// replaced with undefined, so everything here is dead-code-eliminated.
import type { LiveSceneInfo, EditorTool } from '@dcl-editor/contract'
import { sceneRpc, sendToScene } from '../engine/bus'
import { cmd } from '../engine/cmd'
import { state } from '@scene/state'
import { sendSpawnPoints } from '../spawn-points'

let watchdog: ReturnType<typeof setTimeout> | null = null

// Called by boot at the top of every scene-ready. Returns true if this scene-ready
// is the fresh instance from an in-place reload we triggered — in which case boot
// should NOT adopt the (blank) scene state; instead we re-push the page's current
// selection/tool/flags to the new instance and cancel the full-reload fallback.
export function notifyDevSceneReady(): boolean {
  if (watchdog === null) return false
  clearTimeout(watchdog)
  watchdog = null
  void sendToScene({ type: 'set-selection', selected: [...state.selected], active: state.activeEntity })
  void sendToScene({ type: 'set-tool', tool: state.activeAction as EditorTool })
  void sendToScene({
    type: 'set-flags',
    orientGlobal: state.orientGlobal,
    pivotEach: state.pivotEach,
    showLinks: state.showLinks,
    snap: state.snap,
    showSpawnAreas: state.showSpawnAreas
  })
  // the fresh instance defaults to frozen:false and an empty spawn list — the
  // spawn personas are gated on both, so without these a dev session that
  // rebuilds the editor scene "loses" its spawn markers until a full restart
  void sendToScene({ type: 'set-frozen', frozen: state.frozen })
  sendSpawnPoints()
  return true
}

export function startDevSceneReload(): void {
  if (import.meta.hot === undefined) return
  import.meta.hot.on('editor:reload-scene', () => void reloadEditorScene())
}

async function reloadEditorScene(): Promise<void> {
  try {
    const scenes = await sceneRpc<LiveSceneInfo[]>('liveSceneInfo')
    const sys = scenes.find((s) => s.isSuper)
    if (sys === undefined) {
      location.reload()
      return
    }
    console.log('[dev] reloading editor scene in place', sys.hash)
    await cmd.reload(sys.hash)
    // safety net: if the scene doesn't re-announce (the super scene didn't respawn),
    // the in-place path didn't work — fall back to a full page reload.
    watchdog = setTimeout(() => {
      watchdog = null
      console.log('[dev] in-place reload did not re-announce — full reload')
      location.reload()
    }, 4000)
  } catch (e) {
    console.warn('[dev] in-place editor-scene reload failed — full reload', e)
    location.reload()
  }
}
