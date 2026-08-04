import { cmd } from '../cmd'
import { isFrozenStatus } from '../commands'
import { state } from '../state'
import { sleep } from '../utils'
import { reloadSnapshot } from './writes'

// The page drives the transport (Play/Pause/Stop/Step) but the SCENE's copy of
// state.frozen gates avatar input and the free camera — and the scene only ever
// samples the engine once, at boot. So a transition has to be announced: the page
// wires this to a bus send, the scene's own copy of this module never sets it.
type FrozenObserver = (frozen: boolean) => void
let onFrozenChanged: FrozenObserver | null = null
// what the observer was last told — NOT state.frozen, which the page writes
// optimistically at scene-ready. Comparing against that would swallow the first
// announcement whenever the optimistic guess happened to be right.
let announcedFrozen: boolean | null = null
export function setFrozenObserver(fn: FrozenObserver): void {
  onFrozenChanged = fn
}

export function setFrozen(frozen: boolean): void {
  state.frozen = frozen
  if (announcedFrozen === frozen) return
  announcedFrozen = frozen
  onFrozenChanged?.(frozen)
}

// Say it again even if nothing changed. The announcement is fire-and-forget over
// the bus, and a scene that reloaded (or wasn't listening yet) starts from its own
// default — with no re-announce the two disagree for the rest of the session, and
// a scene that wrongly believes it's frozen leaves the avatar unable to move.
export function announceFrozen(): void {
  announcedFrozen = state.frozen
  onFrozenChanged?.(state.frozen)
}

// Sync the local frozen flag from the pinned scene's actual status (it may
// differ from our last action after a scene change or external freeze).
export async function syncFrozenState(): Promise<void> {
  try {
    const stats = await cmd.sceneStats()
    setFrozen(isFrozenStatus(stats))
  } catch {
    // leave the flag as-is
  }
}

// --- transport controls (freeze / tick / unfreeze the pinned scene) ---

// Editing happens at midday with the clock stopped, so a long session doesn't
// drift into night; Play hands the scene its real day/night behaviour back —
// a creator testing time-of-day logic needs the cycle to actually run. Speed 12
// is the engine's own default (visuals/src/day_night.rs start_clock).
const EDITOR_HOUR = 12
const ENGINE_DAY_SPEED = 12
export function pinTimeOfDay(running: boolean): void {
  void cmd.time(EDITOR_HOUR, running ? ENGINE_DAY_SPEED : 0).catch(() => {})
}

// Returns whether the scene is frozen now. Callers must not infer that from
// state.frozen: the page sets it optimistically at boot, so a failed freeze would
// read as a successful one.
export async function pauseScene(): Promise<boolean> {
  try {
    await cmd.freezeScene()
    setFrozen(true)
    pinTimeOfDay(false)
    return true
  } catch (e) {
    // someone else (e.g. the host page) froze it first — same outcome
    if (String(e).includes('already frozen')) {
      setFrozen(true)
      return true
    }
    console.error('freeze_scene failed:', e)
    return false
  }
}

export async function playScene(): Promise<void> {
  try {
    await cmd.unfreezeScene()
    setFrozen(false)
    pinTimeOfDay(true)
  } catch (e) {
    const msg = String(e)
    if (msg.includes('not frozen')) {
      setFrozen(false)
      return
    }
    // Stale pin: the inspected scene entity changed (e.g. after a Stop/reload),
    // so /unfreeze_scene can't resolve it and Play silently no-ops. Re-pin the
    // scene by hash and retry once.
    const hash = state.scene?.hash
    if (msg.includes('no longer exists') && hash !== undefined) {
      try {
        await cmd.setScene(hash)
        await cmd.unfreezeScene()
        setFrozen(false)
        pinTimeOfDay(true)
        return
      } catch (e2) {
        state.saveStatus = `play failed: ${String(e2)}`
        return
      }
    }
    state.saveStatus = `play failed: ${msg}`
    console.error('unfreeze_scene failed:', e)
  }
}

// Advance the frozen scene by `count` ticks, then re-pull the snapshot so the
// tree reflects the stepped frame. The scene re-freezes itself after the ticks.
export async function stepScene(count = 1): Promise<void> {
  try {
    await cmd.tickScene(count)
    setFrozen(true)
    await sleep(150)
    await reloadSnapshot()
  } catch (e) {
    console.error('tick_scene failed:', e)
  }
}
