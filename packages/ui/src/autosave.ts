// Creator-hub style auto-save: every mutation marks the scene dirty; after a
// short quiet period the composite is rebuilt (same pipeline as manual save)
// and written straight to the project's assets/scene/main.composite through
// the dev server's data-layer. No Save button involved.
import { state } from '../../scene/src/state'
import { saveCompositeDirect, setCompositeWriter, isLocalScene } from '../../scene/src/inspector'
import { dataLayerSaveFile, probeDataLayer, dataLayerAvailable } from './datalayer'
import { bump } from './store'

export type AutoSaveStatus = 'off' | 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 1200
const COMPOSITE_PATH = 'assets/scene/main.composite'

let status: AutoSaveStatus = 'off'
let timer: ReturnType<typeof setTimeout> | null = null
let saving = false
let queued = false

export function autoSaveStatus(): AutoSaveStatus {
  return status
}

function setStatus(s: AutoSaveStatus): void {
  if (status === s) return
  status = s
  bump()
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
      bump()
    }
    return
  }
  if (!autoSaveEnabled()) return
  setStatus('dirty')
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runSave()
  }, DEBOUNCE_MS)
}

// Dismiss the play-mode-edit warning; persist the opt-out if asked.
export function dismissPlayEditWarning(dontShowAgain: boolean): void {
  state.playEditWarn = false
  if (dontShowAgain) localStorage.setItem(PLAY_WARN_KEY, '1')
  bump()
}

// Run any pending debounced save NOW (awaitable). Called before entering play so
// edit-mode changes are persisted at the clean pre-play state — otherwise the
// debounce could fire mid-play and capture runtime drift.
export async function flushPendingSave(): Promise<void> {
  if (timer === null) return
  clearTimeout(timer)
  timer = null
  await runSave()
}

async function runSave(): Promise<void> {
  if (saving) {
    queued = true
    return
  }
  saving = true
  setStatus('saving')
  try {
    await saveCompositeDirect()
    setStatus('saved')
  } catch {
    setStatus('error')
  } finally {
    saving = false
    if (queued) {
      queued = false
      void runSave()
    }
  }
}

// Discard pending work (used by scene restart, where runtime edits are gone).
export function clearDirty(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  queued = false
  if (status === 'dirty') setStatus('idle')
}
