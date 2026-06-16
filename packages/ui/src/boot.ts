// Boot handshake: wait for the engine, start bus polling, announce the page UI
// to the scene, then adopt the scene's session (login + pinned scene happen
// scene-side) and pull the first snapshot.
import { state, markEdited, resetSaveChangelog } from '../../scene/src/state'
import {
  reloadSnapshot,
  loadComponentNames,
  pauseScene,
  setMutationObservers,
  mergeKeepingOrder
} from '../../scene/src/inspector'
import {
  type SceneToPageMessage,
  type EditorTool,
  SCENE_BRIDGE_VERSION
} from '../../scene/src/bridge-protocol'
import { engineReady } from './console'
import { cmd } from './cmd'
import {
  RESTART_PIN_ATTEMPTS,
  RESTART_PIN_INTERVAL_MS,
  AUTOPAUSE_ATTEMPTS,
  AUTOPAUSE_INTERVAL_MS
} from './config'
import { startBusPolling, onSceneMessage, sendToScene } from './bus'
import { bump } from './store'
import {
  pushHistory,
  isHistorySuppressed,
  installHistoryKeys,
  snapshotValue,
  type HistoryEntry
} from './history'
import { initAutoSave, markDirty, clearDirty } from './autosave'
import { startDevSceneReload, notifyDevSceneReady } from './dev-hmr'

export type BootPhase = 'waiting-engine' | 'waiting-scene' | 'ready'

let bootPhase: BootPhase = 'waiting-engine'
export function getBootPhase(): BootPhase {
  return bootPhase
}

export async function boot(): Promise<void> {
  while (!engineReady()) {
    await new Promise((r) => setTimeout(r, 250))
  }
  bootPhase = 'waiting-scene'
  bump()

  startBusPolling()
  startDevSceneReload() // dev-only: in-place editor-scene reload on rebuild (no-op in prod)
  onSceneMessage(handleSceneMessage)

  // The scene's UI misses pointer releases that land on the page's DOM panels,
  // leaving a gizmo ghost-drag. The DOM always sees the release — forward it.
  window.addEventListener(
    'pointerup',
    () => {
      if (state.gizmoDragging) void sendToScene({ type: 'pointer-up' })
    },
    { capture: true }
  )
  window.addEventListener('blur', () => {
    if (state.gizmoDragging) void sendToScene({ type: 'pointer-up' })
  })

  // True when an event targets the engine viewport (the host div) rather than a
  // UI panel inside the shadow root — scopes viewport-only gestures (the wheel
  // fly-speed below). Model picking is engine-input-driven scene-side, not here.
  const onCanvas = (e: Event): boolean => {
    const path = e.composedPath()
    const first = path[0]
    if (first instanceof HTMLElement && first.id === 'editor-ui-host') return true
    return !path.some((n) => n instanceof HTMLElement && n.id === 'editor-ui-host')
  }

  // scroll over the viewport while flying adjusts fly speed (creators-hub-pro
  // pattern); accumulated and flushed so a fast wheel doesn't flood the bus
  let wheelFactor = 1
  let wheelTimer: ReturnType<typeof setTimeout> | null = null
  window.addEventListener(
    'wheel',
    (e) => {
      if (state.camMode !== 'free' || !onCanvas(e)) return
      wheelFactor *= e.deltaY > 0 ? 0.9 : 1.1
      if (wheelTimer === null) {
        wheelTimer = setTimeout(() => {
          wheelTimer = null
          const f = wheelFactor
          wheelFactor = 1
          void sendToScene({ type: 'fly-speed', factor: f })
        }, 120)
      }
    },
    { capture: true, passive: true }
  )

  // mirror page-side writes/deletes into the scene's snapshot over the bus —
  // the scene can't refetch them while frozen (stale /crdt_snapshot) — and
  // record each write as an undo step
  setMutationObservers(
    (entity, name, json, prev) => {
      if (!isHistorySuppressed()) {
        try {
          pushHistory([{ entityId: entity, name, before: prev, after: JSON.parse(json) }])
        } catch {
          /* unparseable write — skip history */
        }
      }
      void sendToScene({ type: 'component-written', entity, name, json })
      markDirty()
    },
    (entity, recursive) => {
      void sendToScene({ type: 'entity-deleted', entity, recursive })
      markDirty()
    }
  )
  installHistoryKeys()
  void initAutoSave()

  // announce until the scene answers with scene-ready
  while (bootPhase === 'waiting-scene') {
    try {
      await sendToScene({ type: 'init' })
    } catch {
      /* engine may still be wiring the console — retry */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

// The page's frozen flag, from the authoritative scene status (mirrors the
// scene's own syncFrozenState).
async function syncFrozenFromStats(): Promise<void> {
  try {
    const stats = await cmd.sceneStats()
    state.frozen = /status:\s*blocked/i.test(stats)
  } catch {
    /* keep the current flag */
  }
}

// The editor freezes the inspected scene on attach so its systems stop ticking
// (runtime churn off, edits stable). Once per scene — pressing Play sticks.
let autoPausedHash: string | null = null
function autoPause(): void {
  const hash = state.scene?.hash
  if (hash === undefined || state.frozen || autoPausedHash === hash) return
  autoPausedHash = hash
  void pauseScene().then(bump)
}

// Stop = restart: reload the scene (fresh instance, tick 0), re-pin it, freeze
// it again, and resync both editors' snapshots. Unsaved runtime edits die with
// the old instance, so the session changelog is cleared too.
export async function restartScene(): Promise<void> {
  const hash = state.scene?.hash
  if (hash === undefined) return
  state.saveStatus = 'restarting…'
  bump()
  try {
    await cmd.reload(hash)
    // wait for the new instance to spawn, then re-pin it as the inspection target
    let pinned = false
    for (let i = 0; i < RESTART_PIN_ATTEMPTS && !pinned; i++) {
      await new Promise((r) => setTimeout(r, RESTART_PIN_INTERVAL_MS))
      try {
        await cmd.setScene(hash)
        pinned = true
      } catch {
        /* scene still booting */
      }
    }
    if (!pinned) throw new Error('scene did not come back after reload')
    // the reloaded scene starts running — pause it so Stop returns to edit mode
    // (Play shown). freeze_scene can be rejected for a beat right after reload,
    // so retry until the scene actually freezes.
    state.frozen = false
    for (let i = 0; i < AUTOPAUSE_ATTEMPTS && !state.frozen; i++) {
      await pauseScene()
      if (!state.frozen) await new Promise((r) => setTimeout(r, AUTOPAUSE_INTERVAL_MS))
    }
    state.frozen = true
    await reloadSnapshot()
    resetSaveChangelog()
    clearDirty()
    state.fieldEdits.clear()
    state.drafts.clear()
    await sendToScene({ type: 'resync' })
    state.saveStatus = 'restarted'
  } catch (e) {
    state.saveStatus = `restart failed: ${String(e)}`
  }
  bump()
}

function handleSceneMessage(msg: SceneToPageMessage): void {
  switch (msg.type) {
    case 'scene-ready': {
      // dev in-place reload: the fresh editor-scene instance is up — re-push the
      // page's state to it and don't adopt its blank state (project scene + camera
      // are untouched, so nothing else to re-sync).
      if (notifyDevSceneReady()) {
        bump()
        break
      }
      if ((msg.bridge ?? 0) < SCENE_BRIDGE_VERSION) {
        // the system scene the engine loaded is an older cached build — edits
        // will desync (stale gizmo, transform snap-back). Make it loud.
        state.saveStatus = `⚠ stale editor scene loaded (bridge v${msg.bridge ?? 0} < v${SCENE_BRIDGE_VERSION}) — clear the service worker / caches and reload`
        console.warn('[editor-ui]', state.saveStatus)
      }
      state.scene = msg.scene ?? undefined
      // Optimistically assume edit mode (frozen): the editor auto-pauses on
      // attach, and the async stats sync below corrects it before autoPause runs.
      // Without this the first 'ready' render sees the default frozen=false and
      // flashes the "PLAYING" tint for a frame.
      state.frozen = true
      // msg.frozen is the scene's local cache and goes stale when the page
      // freezes directly via console — read the authoritative status instead.
      void syncFrozenFromStats().then(() => {
        autoPause()
        bump()
      })
      state.activeAction = msg.tool
      state.orientGlobal = msg.orientGlobal
      state.pivotEach = msg.pivotEach
      state.selected = new Set(msg.selected)
      state.activeEntity = msg.active
      if (bootPhase !== 'ready') {
        bootPhase = 'ready'
        void reloadSnapshot().then(bump)
        void loadComponentNames().then(bump)
      }
      bump()
      break
    }
    case 'selection': {
      state.selected = new Set(msg.selected)
      state.activeEntity = msg.active
      bump()
      break
    }
    case 'tool': {
      state.activeAction = msg.tool as EditorTool
      bump()
      break
    }
    case 'drag-start': {
      state.gizmoDragging = true
      bump()
      break
    }
    case 'drag-end': {
      state.gizmoDragging = false
      // adopt the dragged transforms into our snapshot + changelog (no refetch —
      // the frozen scene's /crdt_snapshot wouldn't have them); one undo step
      // covers the whole drag
      const batch: HistoryEntry[] = []
      for (const [id, t] of Object.entries(msg.transforms)) {
        batch.push({ entityId: id, name: 'Transform', before: snapshotValue(id, 'Transform'), after: t })
        const entry = state.snapshot[id] ?? (state.snapshot[id] = {})
        entry.Transform = mergeKeepingOrder(entry.Transform, t)
        markEdited(id, 'Transform', t)
      }
      pushHistory(batch)
      markDirty()
      bump()
      break
    }
  }
}
