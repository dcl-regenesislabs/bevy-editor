// Creator-hub style auto-save: every mutation marks the scene dirty; after a
// short quiet period the composite is rebuilt (same pipeline as manual save)
// and written straight to the project's assets/scene/main.composite through
// the dev server's data-layer. No Save button involved.
import { state } from '@scene/state'
import { notify } from '@scene/reactive'
import { saveCompositeDirect, setCompositeWriter, isLocalScene } from '@scene/inspector'
import { refreshAuthoredIds } from '../panels/authored-ids'
import { dataLayerSaveFile, probeDataLayer, dataLayerAvailable } from '../engine/datalayer'
import { regenerateSpawnables } from '../prefabs/generate'
import { regenerateGameConfig } from '../gameconfig/generate'
import { noteCompositeWritten } from '../features/editor/scene-health'
import { log } from '../log'

export type AutoSaveStatus = 'off' | 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 1200
const COMPOSITE_PATH = 'assets/scene/main.composite'

let status: AutoSaveStatus = 'off'
let timer: ReturnType<typeof setTimeout> | null = null
// Writes to main.composite are serialized onto one chain, so two saves can never
// interleave and a flush can await the whole tail instead of only the debounce
// timer. The chain never rejects — a failed write is counted, not thrown — so one
// error can't poison every save after it.
let chain: Promise<void> = Promise.resolve()
let inFlight = 0
let failures = 0

export function autoSaveStatus(): AutoSaveStatus {
  return status
}

function setStatus(s: AutoSaveStatus): void {
  if (status === s) return
  status = s
  notify() // status is read via a selector; nudge React to re-render the chip
}

export function autoSaveEnabled(): boolean {
  return dataLayerAvailable() === true && isLocalScene()
}

export async function initAutoSave(): Promise<void> {
  const ok = await probeDataLayer()
  if (ok) {
    // all composite saves (auto + manual) go to disk through the data layer;
    // when unavailable, the engine writer (directory picker) stays in place
    setCompositeWriter(async (composite) => {
      await dataLayerSaveFile(COMPOSITE_PATH, composite)
      return COMPOSITE_PATH
    })
  }
  setStatus(ok ? 'idle' : 'off')
}

const PLAY_WARN_KEY = 'eui:play-edit-warned'

export function markDirty(): void {
  // Edit/author mode only. While the scene is playing (unfrozen) edits are
  // RUNTIME state — they live in the CRDT and revert on Stop (the scene reloads
  // fresh), exactly like Unity play mode. Persisting them to main.composite would
  // bake transient state into the authored scene, so don't even schedule a save.
  if (!state.frozen) {
    // first such edit: warn once (unless the user opted out) that it won't persist
    if (!state.playEditWarn && localStorage.getItem(PLAY_WARN_KEY) !== '1') {
      state.playEditWarn = true
    }
    return
  }
  if (!autoSaveEnabled()) return
  setStatus('dirty')
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    enqueueSave()
  }, DEBOUNCE_MS)
}

// Dismiss the play-mode-edit warning; persist the opt-out if asked.
export function dismissPlayEditWarning(dontShowAgain: boolean): void {
  state.playEditWarn = false
  if (dontShowAgain) localStorage.setItem(PLAY_WARN_KEY, '1')
}

export interface FlushResult {
  /**
   * there was work to write — a debounce timer was armed, or a write was in flight.
   * NOT a "the composite changed" signal: a save the debounce already fired leaves
   * nothing to flush and reports false. Play reads scene-health's latches instead.
   */
  pending: boolean
  /** every write this flush waited on succeeded */
  ok: boolean
}

/** Is there unwritten work right now? Lets callers phrase their status before flushing. */
export function hasPendingSave(): boolean {
  return timer !== null || inFlight > 0
}

// Run any pending debounced save NOW and wait for it to reach disk. Called before
// entering play so edit-mode changes are persisted at the clean pre-play state
// (otherwise the debounce could fire mid-play and capture runtime drift), and
// before a restart, which discards anything still sitting in the debounce window.
export async function flushPendingSave(): Promise<FlushResult> {
  const armed = timer !== null
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (!armed && inFlight === 0) return { pending: false, ok: true }
  const before = failures
  if (armed) enqueueSave()
  await chain
  return { pending: true, ok: failures === before }
}

// src/scripts/spawnables.ts and src/scripts/game-config.ts are projections of
// what was just saved. Both passes are write-if-changed against the file already
// on disk, so the save one of them may dirty is a no-op on the next tick — that
// is what stops the regenerate → dirty → save → regenerate loop (R5). Neither
// may break saving: a failure is reported, never thrown into the save chain.
// Game Config first, and in that order on purpose: the registry side-effect-
// imports `./game-config` only when the file is already on disk, so running them
// concurrently would leave the import a save behind on the very first one.
function regenerateDerivedScripts(): void {
  void (async () => {
    try {
      await regenerateGameConfig()
    } catch (e) {
      log.error('game-config generation failed', e)
    }
    try {
      await regenerateSpawnables()
    } catch (e) {
      log.error('spawnables generation failed', e)
    }
  })()
}

function enqueueSave(): void {
  inFlight++
  setStatus('saving')
  chain = chain.then(async () => {
    try {
      await saveCompositeDirect()
      // the bundle does not embed this yet — Play waits for the rebuild before
      // it reloads, so it can't load the scene without what we just wrote
      noteCompositeWritten()
      // The save clears state.createdEntities — those ids are authored now, and
      // they are authored because they are IN main.composite. Re-read it, or the
      // hierarchy loses the only signal saying so and files them under code.
      refreshAuthoredIds()
      regenerateDerivedScripts()
      inFlight--
      if (inFlight === 0) setStatus('saved')
    } catch {
      failures++
      inFlight--
      setStatus('error')
    }
  })
}

// Discard pending work. Used after a scene restart has already flushed authored
// edits to disk — what's left in the window is runtime drift from the old instance.
export function clearDirty(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  if (status === 'dirty') setStatus('idle')
}
