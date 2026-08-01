// Hide the edited scene's own SDK7 UI (its UiTransform trees) while editing —
// without any engine change. Each UI root gets `display: NONE` written over the
// same /set_component path every inspector edit uses; toggling back restores
// the exact previous value. Runtime-only by construction: UI entities are
// code-spawned, so save-diff never persists them, and Stop reloads the scene
// with whatever its code renders.
//
// The writes are wrapped in history suppression — hiding chrome to look at the
// world isn't an edit, and must not become a ⌘Z step.
import { reactive } from './store'
import { state } from '../../scene/src/state'
import { writeComponent } from '../../scene/src/inspector'
import { withHistorySuppressed } from './history'

const UI_TRANSFORM = 'UiTransform'
// PBUiTransform.display (YGDisplay): 0 = flex, 1 = none. The engine's inspect
// serialization (prost + plain serde) carries enums as numbers.
const DISPLAY_NONE = 1

export const sceneUi = reactive({ hidden: false })

const saved = new Map<string, unknown>()

// A UI root: has a UiTransform, and its parent doesn't (or is the scene root).
// Hiding roots hides the whole tree — yoga display:none culls descendants.
function uiRoots(): string[] {
  const snap = state.snapshot
  return Object.keys(snap).filter((id) => {
    const t = snap[id]?.[UI_TRANSFORM] as { parent?: number } | undefined
    if (t === undefined) return false
    return snap[String(t.parent ?? 0)]?.[UI_TRANSFORM] === undefined
  })
}

export async function toggleSceneUi(auto = false): Promise<void> {
  // A hide/show the creator asked for outranks anything automatic for the rest
  // of the session — nothing should quietly undo a deliberate choice.
  if (!auto) userOverride = true
  try {
    if (sceneUi.hidden) {
      sceneUi.hidden = false
      await withHistorySuppressed(async () => {
        for (const [id, t] of saved) {
          if (state.snapshot[id]?.[UI_TRANSFORM] === undefined) continue
          await writeComponent(id, UI_TRANSFORM, JSON.stringify(t))
        }
      })
      saved.clear()
      state.saveStatus = 'scene UI restored'
      return
    }
    const roots = uiRoots()
    if (roots.length === 0) {
      // no UiTransform anywhere: either the scene has no UI, or its code builds
      // the UI later than tick 0 — say so instead of silently doing nothing
      state.saveStatus = 'no scene UI found to hide (does this scene build its UI on ▶ play?)'
      return
    }
    sceneUi.hidden = true
    await withHistorySuppressed(async () => {
      for (const id of roots) {
        const t = state.snapshot[id]?.[UI_TRANSFORM]
        if (t === undefined) continue
        saved.set(id, JSON.parse(JSON.stringify(t)))
        await writeComponent(id, UI_TRANSFORM, JSON.stringify({ ...(t as Record<string, unknown>), display: DISPLAY_NONE }))
      }
    })
    state.saveStatus = `scene UI hidden (${saved.size} root${saved.size === 1 ? '' : 's'}) — runtime only, Stop restores it`
  } catch (e) {
    sceneUi.hidden = false
    saved.clear()
    state.saveStatus = `could not toggle the scene UI: ${String(e)}`
  }
}

// After a restart the scene redraws its UI from code — the hide is gone and the
// saved values point at entity ids that may no longer exist.
export function resetSceneUi(): void {
  saved.clear()
  sceneUi.hidden = false
  autoHidden = false
}

// Hiding the scene's UI is an EDITING affordance: while stopped it covers the
// viewport with chrome that isn't selectable or movable. The moment the scene
// runs, that UI IS the game — so the automatic hide is released on Play and
// re-applied on Pause. A hide the creator chose is never touched.
let userOverride = false

export async function releaseAutoHiddenSceneUi(): Promise<void> {
  if (userOverride || !autoHidden || !sceneUi.hidden) return
  autoHidden = false
  await toggleSceneUi(true)
}

// The scene's own HUD covers the viewport while editing, so the editor starts
// with it hidden. UI roots only exist once the scene's code has run, so poll
// briefly rather than racing it.
let autoHidden = false
export function autoHideSceneUi(): void {
  if (userOverride || autoHidden || sceneUi.hidden) return
  let tries = 0
  const tick = (): void => {
    if (userOverride || autoHidden || sceneUi.hidden) return
    if (uiRoots().length > 0) {
      autoHidden = true
      void toggleSceneUi(true)
      return
    }
    if (++tries < 20) setTimeout(tick, 500)
  }
  setTimeout(tick, 800)
}
