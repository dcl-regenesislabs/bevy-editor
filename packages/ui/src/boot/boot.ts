// Boot handshake: wait for the engine, start bus polling, announce the page UI
// to the scene, then adopt the scene's session (login + pinned scene happen
// scene-side) and pull the first snapshot.
import {
  state,
  markEdited,
  resetSaveChangelog,
  setSelectionAndActive,
  clearAllEdits,
  setSnapshotComponents,
  isRuntimeEntity,
  provenanceBaseline
} from '@scene/state'
import { notify } from '@scene/reactive'
import { isFrozenStatus } from '@scene/commands'
import { launchParam } from './launch-params'
import { uiSetTool, uiFocusEntity } from '../actions/selection'
import { uiDuplicateEntity } from '../actions/entities'
import {
  refresh,
  reloadSnapshot,
  loadInitialBaseline,
  loadComponentNames,
  pauseScene,
  setFrozen,
  setFrozenObserver,
  announceFrozen,
  setMutationObservers,
  mergeKeepingOrder
} from '@scene/inspector'
import {
  type SceneToPageMessage,
  type EditorTool,
  PROTOCOL_KINDS
} from '@scene/bridge-protocol'
import { engineReady } from '../engine/console'
import { cmd } from '../engine/cmd'
import {
  RESTART_PIN_ATTEMPTS,
  RESTART_PIN_INTERVAL_MS,
  AUTOPAUSE_ATTEMPTS,
  AUTOPAUSE_INTERVAL_MS
} from '../config'
import { startBusPolling, onSceneMessage, sendToScene } from '../engine/bus'
import { pageTrace, pageTraced, recordSceneTrace, printBootTimeline } from '../engine/boot-trace'
import {
  pushHistory,
  isHistorySuppressed,
  installHistoryKeys,
  undo,
  redo,
  snapshotValue,
  type HistoryEntry
} from '../core/history'
import { initAutoSave, markDirty, clearDirty, flushPendingSave, hasPendingSave } from '../core/autosave'
import { noteCodeOrigin, refreshCodeMove, resetCodeOrigins } from '../panels/code-move-offer'
import { clearPendingCodeMove, runStudioChord } from '../panels/ai-store'
import { revealInTree } from '../panels/reveal'
import { resetSceneUi, autoHideSceneUi } from '../engine/scene-ui'
import { awaitFreshBundle, noteSceneStale, noteSceneUpToDate } from '../features/editor/scene-health'
import { sendSpawnPoints } from '../spawn-points'
import { entityName } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import type { Snapshot } from '@scene/state'
import { startDevSceneReload, notifyDevSceneReady } from './dev-hmr'

export type BootPhase = 'waiting-engine' | 'waiting-scene' | 'ready'

let bootPhase: BootPhase = 'waiting-engine'
export function getBootPhase(): BootPhase {
  return bootPhase
}

// The engine has the scene and is drawing it. Separate from bootPhase on purpose:
// the viewport is watchable long before the editor holds the CRDT, and a scene
// whose own thread never answers /crdt_snapshot would otherwise sit behind a
// loading screen forever with a perfectly good picture underneath it.
let viewportReady = false
export function isViewportReady(): boolean {
  return viewportReady
}
// read via a selector in App — notify so the boot gate re-renders on transition
function setBootPhase(phase: BootPhase): void {
  bootPhase = phase
  notify()
}

// a code-spawned entity is never written to the composite (save-diff skips it) —
// scheduling a save for it would just flash "saved" for a no-op
function affectsSave(entity: string): boolean {
  return !isRuntimeEntity(entity, provenanceBaseline())
}

// An edit can cover both authored and code-spawned entities. The authored ones
// are already saved; record the last code-spawned one so the inspector can offer
// to push the change into the code, which is the only edit that survives a restart.
//
// Every write path lands here, not just the gizmo: typing a value in the inspector
// is exactly as unsaveable as dragging one, and the warning has to say so — while
// playing as well as stopped.
function capturePendingCodeMove(batch: HistoryEntry[]): void {
  const runtime = batch.filter((b) => !affectsSave(b.entityId))
  if (runtime.length === 0) return
  // the first `before` we ever see for a key is the value the code produced
  for (const b of runtime) noteCodeOrigin(b.entityId, b.name, b.before)
  const last = runtime[runtime.length - 1]
  updateCodeMove(last.entityId, last.name)
}

// Rebuild the offer from the origin and the CURRENT value. Called for undo/redo
// writes too, where there is no history entry to build from and the answer may
// be "there is no difference left" — the only thing that takes the card away.
function updateCodeMove(entity: string, name: string): void {
  if (affectsSave(entity)) return
  const snapshot = state.snapshot as Snapshot
  refreshCodeMove(entity, name, snapshot[entity]?.[name], entityName(snapshot, entity) ?? null)
}

export async function boot(): Promise<void> {
  pageTrace('page boot')
  while (!engineReady()) {
    await new Promise((r) => setTimeout(r, 250))
  }
  pageTrace('engine console answering')
  setBootPhase('waiting-scene')

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
          const entry = { entityId: entity, name, before: prev, after: JSON.parse(json) }
          pushHistory([entry])
          capturePendingCodeMove([entry])
        } catch {
          /* unparseable write — skip history */
        }
      } else {
        // an undo/redo write: the value moved, so the offer has to be recomputed.
        // It goes away only when the entity is back where the code puts it — one
        // undo of three moves still leaves it somewhere the code never did.
        updateCodeMove(entity, name)
      }
      void sendToScene({ type: 'component-written', entity, name, json })
      if (affectsSave(entity)) {
        markDirty()
        // attach / detach / repoint — only takes effect when the scene reloads
        if (name === SCRIPT_COMPONENT) noteSceneStale()
      }
    },
    (entity, recursive) => {
      void sendToScene({ type: 'entity-deleted', entity, recursive })
      if (affectsSave(entity)) markDirty()
    },
    (entity, name, prev) => {
      // undo re-writes `before`, which puts the component back. Nothing to undo
      // when it wasn't there to begin with — don't spend the user's ⌘Z on a no-op.
      if (!isHistorySuppressed() && prev !== undefined) {
        pushHistory([{ entityId: entity, name, before: prev, after: undefined }])
      }
      void sendToScene({ type: 'component-deleted', entity, name })
      if (affectsSave(entity)) markDirty()
    }
  )
  // the scene can't see the transport we drive from here, and its own frozen flag
  // decides whether the avatar walks — tell it on every confirmed transition
  setFrozenObserver((frozen) => {
    void sendToScene({ type: 'set-frozen', frozen })
  })
  // Tool chords come from the MAIN process (before-input-event), so they work
  // whatever holds focus — the engine iframe grabs it the moment the viewport is
  // clicked, and a listener in this window would never see them then.
  window.editorShell?.onEditorChord?.((c) => {
    switch (c.action) {
      case 'tool':
        // ⌘W is the translate chord; with the Studio open it's "close tab" instead
        if (c.tool === 'translate' && runStudioChord('close-tab')) break
        uiSetTool(c.tool as EditorTool)
        break
      case 'focus':
        if (runStudioChord('find')) break
        if (state.activeEntity !== null) uiFocusEntity(state.activeEntity)
        break
      case 'undo':
        // ⌘Z in the Studio's code editor undoes TYPING; in any other text field
        // it must at least not undo the last scene edit mid-keystroke
        if (runStudioChord('undo') || isTypingInAField()) break
        void undo() // clears the code-move card itself — see history.ts
        break
      case 'redo':
        if (runStudioChord('redo') || isTypingInAField()) break
        void redo()
        break
      case 'duplicate':
        if (state.activeEntity !== null) void uiDuplicateEntity(state.activeEntity)
        break
    }
  })
  installHistoryKeys()
  void initAutoSave()

  // announce until the scene answers with scene-ready
  for (let announced = 0; bootPhase === 'waiting-scene'; announced++) {
    try {
      await sendToScene({ type: 'init' })
      // every 15s of silence, so a wedged attach leaves a trail in the console
      if (announced === 0 || announced % 15 === 14) {
        pageTrace('init announced', `${announced + 1}× — no scene-ready yet`)
      }
    } catch {
      /* engine may still be wiring the console — retry */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}

// The page's frozen flag, from the authoritative scene status (mirrors the
// scene's own syncFrozenState). Returns false when the status is unknown — the
// caller must not read state.frozen as an answer then, because boot optimistically
// sets it true to avoid a PLAYING flash on the first render.
async function syncFrozenFromStats(): Promise<boolean> {
  try {
    const stats = await cmd.sceneStats()
    setFrozen(isFrozenStatus(stats))
    return true
  } catch {
    return false
  }
}

// The editor freezes the inspected scene on attach so its systems stop ticking
// (runtime churn off, edits stable). Once per scene — pressing Play sticks.
//
// It retries because /freeze_scene fails while the pinned scene entity can't be
// resolved: right after attach the scene-side pin may not have landed yet, or the
// player isn't standing in the scene's parcels. Both clear on their own in a
// moment. Asset loading does NOT block a freeze — the engine just adds "frozen"
// to the same block set that already holds "gltfs loading".
let autoPausedHash: string | null = null
let autoPausing = false
async function autoPause(): Promise<void> {
  const hash = state.scene?.hash
  if (hash === undefined || autoPausedHash === hash || autoPausing) return
  autoPausing = true
  try {
    let frozen = false
    for (let i = 0; i < AUTOPAUSE_ATTEMPTS && !frozen; i++) {
      // an external freeze (or our own, on a re-entry) counts — nothing to do.
      // Only a SUCCESSFUL status read answers this; state.frozen alone is the
      // optimistic boot value and would pass a failed freeze off as a good one.
      if ((await syncFrozenFromStats()) && state.frozen) frozen = true
      else frozen = await pauseScene()
      if (!frozen) await new Promise((r) => setTimeout(r, AUTOPAUSE_INTERVAL_MS))
    }
    if (frozen) {
      autoPausedHash = hash
    } else {
      // don't claim the hash — a later scene-ready (dev scene reload, re-attach)
      // gets another go. Say so: an unfrozen scene means every edit from here is
      // runtime-only, which is not something to discover silently.
      setFrozen(false)
      state.saveStatus = 'the scene would not pause — press Pause before editing'
      console.warn('[editor-ui]', state.saveStatus)
    }
  } finally {
    autoPausing = false
  }
}

// Attach to the scene again without reloading the page: re-resolve and re-pin it,
// pull a fresh snapshot, freeze it, and have the scene-side editor re-pull too.
// A page reload does the same thing by starting over — but starting over throws
// the whole session away (the assistant's conversation, open files, camera, undo
// history) and puts the creator back on the loading screen they already left.
let reattaching = false
export async function reattachScene(): Promise<void> {
  if (reattaching) return
  reattaching = true
  try {
    await refresh() // re-resolve + re-pin + re-pull; sets status back to 'ready'
    autoPausedHash = null // the scene instance is new and running — freeze it again
    await autoPause()
    announceFrozen()
    await sendToScene({ type: 'resync' })
    void sendSpawnPoints()
  } catch (e) {
    console.warn('[editor-ui] re-attach failed', e)
  } finally {
    reattaching = false
  }
}

// Put the player back where the scene starts: the authored spawn point main
// resolved from scene.json. Does nothing when it couldn't be resolved — moving
// someone to a guessed parcel would strand them further from their scene than
// leaving them put. Best-effort otherwise: an engine without /move_player_to
// just leaves them be.
async function moveToSpawn(): Promise<void> {
  const spawn = (launchParam('spawn') ?? '').split(',').map(Number)
  if (spawn.length !== 3 || !spawn.every(Number.isFinite)) return
  try {
    await cmd.movePlayerTo(spawn[0], spawn[1], spawn[2])
  } catch (e) {
    console.warn('[editor-ui] could not return the player to spawn:', e)
  }
}

let restarting = false

// Stop = restart: reload the scene (fresh instance, tick 0), re-pin it, freeze
// it again, and resync both editors' snapshots. Unsaved runtime edits die with
// the old instance, so the session changelog is cleared too.
//
// Authored (edit-mode) changes are NOT runtime edits: an entity moved seconds
// before Stop is still sitting in autosave's debounce window, and the reload
// below would drop it. Flush first — Stop restarts the scene, it doesn't undo
// your work. If that write fails, abort rather than reload over it.
export async function restartScene(): Promise<void> {
  const hash = state.scene?.hash
  if (hash === undefined) return
  if (restarting) return
  restarting = true
  try {
    if (hasPendingSave()) state.saveStatus = 'saving…'
    const flushed = await flushPendingSave()
    if (!flushed.ok) {
      state.saveStatus = 'restart cancelled — your latest change could not be saved'
      return
    }
    state.saveStatus = 'restarting…'
    // …and the reload must not land on a bundle that predates that flush, or the
    // scene comes back showing the state from before the edit we just saved.
    await awaitFreshBundle()
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
    setFrozen(false)
    for (let i = 0; i < AUTOPAUSE_ATTEMPTS && !state.frozen; i++) {
      await pauseScene()
      if (!state.frozen) await new Promise((r) => setTimeout(r, AUTOPAUSE_INTERVAL_MS))
    }
    // If it refused to freeze, say so and leave the transport showing PLAYING —
    // it really is running, and claiming edit mode is what made Stop look broken.
    const paused = state.frozen
    // Stop despawns the old scene root and its colliders, so a player who walked
    // or fell during play is left standing on nothing. The engine only respawns
    // players it marked out-of-world (realm change / teleport), never on reload.
    await moveToSpawn()
    await reloadSnapshot()
    resetSaveChangelog()
    clearDirty()
    clearAllEdits()
    clearPendingCodeMove() // the scene just put every code-spawned entity back
    resetCodeOrigins() // ...from a fresh instance, so the remembered ones are gone
    resetSceneUi() // ...and redrew its UI from code, so the hide toggle is stale
    autoHideSceneUi()
    noteSceneUpToDate() // the restart loaded the current bundle
    await sendToScene({ type: 'resync' })
    state.saveStatus = paused ? 'restarted' : 'restarted, but the scene would not pause — press Pause'
  } catch (e) {
    state.saveStatus = `restart failed: ${String(e)}`
  } finally {
    restarting = false
  }
}

// Each dragged entity's transform as it was before the drag started, captured on
// the first drag-update that overwrites it. Undo has to restore the whole drag,
// not the last 100 ms of it.
const preDrag = new Map<string, unknown>()

// Is the caret in a text field? The inspector's number inputs are uncontrolled and
// remount when their value changes, so pushing live values into a focused one would
// yank it away mid-keystroke. Crosses shadow roots — the editor UI mounts in one.
function isTypingInAField(): boolean {
  let el = document.activeElement
  while (el?.shadowRoot?.activeElement != null) el = el.shadowRoot.activeElement
  if (el instanceof HTMLElement && el.isContentEditable) return true // CodeMirror
  return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA'
}

function handleSceneMessage(msg: SceneToPageMessage): void {
  switch (msg.type) {
    case 'scene-ready': {
      // dev in-place reload: the fresh editor-scene instance is up — re-push the
      // page's state to it and don't adopt its blank state (project scene + camera
      // are untouched, so nothing else to re-sync).
      if (notifyDevSceneReady()) {
        break
      }
      // the system scene the engine loaded may be an older cached build — edits
      // would desync (stale gizmo, transform snap-back). It reports the protocol
      // it knows, so we can name what's missing instead of just "it's old".
      const known = new Set(msg.kinds ?? [])
      const missing = PROTOCOL_KINDS.filter((kind) => !known.has(kind))
      if (missing.length > 0) {
        const detail =
          msg.kinds === undefined
            ? 'it predates the current message protocol'
            : `it does not know: ${missing.join(', ')}`
        // The engine reads the system scene's content mapping ONCE at launch
        // (engine-host.ts), so a scene rebuilt while the app was running is only
        // picked up on relaunch — that, not a browser cache, is the usual cause.
        state.saveStatus = `⚠ stale editor scene loaded — ${detail}. Quit and reopen the app to pick up the rebuilt scene`
        console.warn('[editor-ui]', state.saveStatus)
      }
      state.scene = msg.scene ?? undefined
      // Optimistically assume edit mode (frozen): the editor auto-pauses on
      // attach, and autoPause's own stats read corrects it a moment later.
      // Without this the first 'ready' render sees the default frozen=false and
      // flashes the "PLAYING" tint for a frame.
      state.frozen = true
      // msg.frozen is the scene's local cache and goes stale when the page
      // freezes directly via console — autoPause reads the authoritative status.
      // This scene instance may have missed every earlier set-frozen (it just
      // booted, or reloaded), and its copy of the flag gates avatar input — so
      // restate it. After the stats read, never from the optimistic value above:
      // telling a running scene it's frozen would leave the avatar unable to move.
      void (async () => {
        const wasBooting = bootPhase !== 'ready'
        await autoPause()
        await syncFrozenFromStats()
        announceFrozen()
        // Both sides attached while the scene's code was still spawning entities
        // — the editor resolves the scene the moment the engine registers it,
        // which on a big scene is several hundred entities early. The freeze-time
        // CRDT is the stable one, so re-pull once it lands: without this the
        // SCENE's snapshot (gizmo, picking, relations) can be a near-empty view
        // of a scene the hierarchy already lists in full.
        if (wasBooting && state.frozen) {
          await sendToScene({ type: 'resync' })
          await pageTraced('re-pull after freeze', reloadSnapshot)
        }
      })()
      // Same reasoning for the viewport flags: this scene instance may have
      // started after the user set them (or be a fresh one from Stop), and it
      // owns the gizmo, so a snap toggle it never heard simply does nothing.
      void sendToScene({
        type: 'set-flags',
        orientGlobal: state.orientGlobal,
        pivotEach: state.pivotEach,
        showLinks: state.showLinks,
        snap: state.snap
      })
      state.activeAction = msg.tool
      state.orientGlobal = msg.orientGlobal
      state.pivotEach = msg.pivotEach
      setSelectionAndActive(msg.selected, msg.active)
      if (bootPhase !== 'ready') {
        pageTrace('scene-ready received', `scene ${msg.scene?.title ?? 'none'}`)
        setBootPhase('ready')
        // The page pulls its OWN copy of the CRDT and the pre-code baseline — on
        // a scene this size that is the second-biggest cost of the attach, and it
        // runs after the spinner is gone, so nothing else would ever show it.
        void Promise.allSettled([
          pageTraced('page crdt_snapshot', reloadSnapshot),
          pageTraced('page crdt_initial', loadInitialBaseline),
          pageTraced('component_names', loadComponentNames)
        ]).then(() => {
          pageTrace('attach complete')
          printBootTimeline()
        })
        void sendSpawnPoints()
        autoHideSceneUi() // the scene's HUD covers the viewport; start with it hidden
        noteSceneUpToDate() // the engine just loaded this bundle — Play needn't wait
      }
      break
    }
    case 'scene-found': {
      if (state.scene === undefined) state.scene = msg.scene
      if (!viewportReady) {
        viewportReady = true
        pageTrace('viewport revealed', `${msg.scene.title} — editor tools still attaching`)
        notify()
      }
      break
    }
    case 'boot-trace': {
      recordSceneTrace(msg)
      break
    }
    case 'selection': {
      const changed = msg.active !== state.activeEntity
      if (changed) clearPendingCodeMove()
      setSelectionAndActive(msg.selected, msg.active)
      // Picked in the viewport: show it in the tree. The row can be collapsed
      // under an ancestor or inside a closed shelf, so selecting it alone would
      // highlight something the creator cannot see.
      if (changed && msg.active !== null) revealInTree(msg.active)
      break
    }
    case 'tool': {
      state.activeAction = msg.tool as EditorTool
      break
    }
    case 'drag-start': {
      state.gizmoDragging = true
      preDrag.clear()
      break
    }
    case 'drag-update': {
      // live values only: no markEdited, no history, no dirty mark — drag-end
      // still produces exactly one undo step for the whole drag. Skipped while a
      // Transform field is focused, since the inputs remount on value change and
      // would be pulled out from under the typist.
      if (isTypingInAField()) break
      setSnapshotComponents(
        Object.entries(msg.transforms).map(([id, t]) => {
          // remember where the drag started BEFORE overwriting it — this snapshot
          // is what drag-end records as the undo 'before'
          if (!preDrag.has(id)) preDrag.set(id, snapshotValue(id, 'Transform'))
          return { id, name: 'Transform', value: mergeKeepingOrder(state.snapshot[id]?.Transform, t) }
        })
      )
      break
    }
    case 'hover': {
      state.playHover = msg.actions
      break
    }
    case 'cursor-lock': {
      state.playCursorLocked = msg.locked
      break
    }
    case 'zones': {
      state.playZones = msg.inside
      break
    }
    case 'drag-end': {
      state.gizmoDragging = false
      // adopt the dragged transforms into our snapshot + changelog (no refetch —
      // the frozen scene's /crdt_snapshot wouldn't have them); one undo step
      // covers the whole drag
      const batch: HistoryEntry[] = []
      const snapshotUpdates: Array<{ id: string; name: string; value: unknown }> = []
      for (const [id, t] of Object.entries(msg.transforms)) {
        // the pre-drag pose, or the current one for a drag too short to have
        // ticked — never the mid-drag value, which would make undo a no-op
        const before = preDrag.has(id) ? preDrag.get(id) : snapshotValue(id, 'Transform')
        batch.push({ entityId: id, name: 'Transform', before, after: t })
        const merged = mergeKeepingOrder(state.snapshot[id]?.Transform, t)
        snapshotUpdates.push({ id, name: 'Transform', value: merged })
        markEdited(id, 'Transform', t)
      }
      preDrag.clear()
      setSnapshotComponents(snapshotUpdates) // one snapshot write for the whole drag
      pushHistory(batch)
      // dragging only code-spawned entities changes nothing the save would keep
      if (batch.some((b) => affectsSave(b.entityId))) markDirty()
      // …but the drag still measured a pose the creator wants. Keep the last
      // code-spawned one so the inspector can offer to put it into the code.
      capturePendingCodeMove(batch)
      break
    }
  }
}
