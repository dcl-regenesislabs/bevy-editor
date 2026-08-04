import { type LiveSceneInfo } from '../bevy-api/interface'
import { trace, traced } from '../boot-trace'
import { cmd } from '../cmd'
import { resolveInspectableScene } from '../current-scene'
import { forceLowGraphics } from '../graphics-preset'
import { log } from '../log'
import { autoLogin } from '../login'
import { state } from '../state'
import { sleep } from '../utils'
import { pinTimeOfDay, syncFrozenState } from './transport'
import { CMD_ATTEMPT_TIMEOUT_MS, SCENE_BOOT_RETRY_MS, SCENE_BOOT_TIMEOUT_MS, loadComponentNames, pullSnapshot, traceSceneStats, withTimeout } from './writes'

// Boot sequence: log in, then load the current scene's component state.
export async function startInspector(): Promise<void> {
  trace('inspector start')
  state.status = 'logging-in'
  await traced('login', autoLogin)
  await refresh()
  // Force graphics to Low to dodge the WebGPU shadow-pass crash on heavy scenes.
  // Done AFTER the scene is up (the render pipeline must exist for the Medium→Low
  // bounce to actually rebuild it). Best-effort, never blocks the editor.
  void forceLowGraphics()
  // Pin the sky to midday. The engine's day/night clock runs off real time at
  // speed 12 (a full cycle every ~2h) regardless of scene freeze, so a long
  // editing session silently turns to night. Same best-effort discipline.
  pinTimeOfDay(false)
  // Best-effort, independent of the scene — populates the add-component picker.
  loadComponentNames().catch(console.error)
}

// Boot resolution races a still-loading scene. A large scene (e.g. a Genesis
// Plaza plaza) isn't registered / the player isn't placed in it / its CRDT isn't
// queryable for the first several seconds after entry — so a single resolve+
// snapshot attempt lands on "no scene" or a transient /crdt_snapshot stall and,
// with no retry, wedges the editor at "Loading scene…" forever even though the
// exact same commands succeed a moment later. Retry until it lands, with a
// per-attempt timeout so a hanging command just triggers another try.
export async function refresh(): Promise<void> {
  state.status = 'loading-snapshot'
  state.error = ''
  const deadline = Date.now() + SCENE_BOOT_TIMEOUT_MS
  let resolvedEver = false

  for (let attempt = 1; ; attempt++) {
    let scene: LiveSceneInfo | undefined
    try {
      const resolved = await traced(
        `resolve #${attempt}`,
        async () => await withTimeout(resolveInspectableScene(), CMD_ATTEMPT_TIMEOUT_MS, 'resolve scene'),
        (v) =>
          v.scene !== undefined
            ? `found ${v.scene.title === '' ? v.scene.hash.slice(0, 8) : v.scene.title}`
            : `no match at parcel ${v.diag.parcel.x},${v.diag.parcel.y} — ${v.diag.live} live: ${v.diag.summary}`
      )
      scene = resolved.scene
    } catch {
      scene = undefined // traced() already recorded the failure and how long it took
    }

    if (scene !== undefined) {
      resolvedEver = true
      state.scene = scene
      const hash = scene.hash
      // Pin the inspection target so subsequent snapshots/edits stay on this
      // scene even if the player wanders out of its parcels.
      try {
        await traced('set_scene', async () => await cmd.setScene(hash))
      } catch (e) {
        console.error('set_scene failed:', e)
      }
      await syncFrozenState()
      if (await pullSnapshot()) {
        trace('editor ready', `attempt ${attempt}, scene ${hash}`)
        return
      }
      // The engine says this scene's code crashed. Its thread is gone, so it can
      // never answer /crdt_snapshot — retrying to the deadline would just stare at
      // a spinner for 90s. Report it now, with the logs that say what threw.
      if (scene.isBroken) {
        state.status = 'scene-broken'
        state.error = 'the scene’s code crashed on startup'
        trace('scene is broken', `${hash} — not retrying`)
        return
      }
    }
    // Whatever went wrong, the engine's own view of the scene explains it: still
    // pulling models, blocked, or ticking fine with the channel as the problem.
    await traceSceneStats()

    if (Date.now() > deadline) break
    // Fast at first, then back off: the usual miss is "the engine hasn't
    // registered the scene yet", which clears in a few hundred ms — a flat 1.5s
    // wait spends most of it idle in front of a loading screen.
    await sleep(Math.min(SCENE_BOOT_RETRY_MS, 250 * 2 ** (attempt - 1)))
  }

  // Timed out: distinguish "never found a scene" from "found it but the snapshot
  // kept failing" so the UI can label it correctly.
  if (!resolvedEver) {
    state.scene = undefined
    state.status = 'no-scene'
  } else {
    state.status = 'error'
  }
  trace('gave up', `${SCENE_BOOT_TIMEOUT_MS}ms elapsed, status ${state.status} (resolvedEver=${resolvedEver})`)
}
