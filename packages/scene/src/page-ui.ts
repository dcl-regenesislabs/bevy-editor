// Scene-side bridge to the host page's React UI, over a same-origin
// BroadcastChannel (editor-channel.ts). Replaces the /editor_send + /editor_poll
// console-command bus, which only existed in our patched engine — BroadcastChannel
// is exposed to the super-user scene by upstream (#843), so this works on stock main.
//
// Inbound: the page drives viewport state (tool, flags, selection, camera) and
// pokes us to re-pull the snapshot after it writes components. Outbound: we
// notify selection changes (world clicks / box select), tool changes and gizmo
// drags, and answer system-api rpcs (login, liveSceneInfo) the page can't make
// itself. While a page UI is attached (state.pageUi) the in-scene panels hide.
import { engine } from '@dcl/sdk/ecs'
import { BevyApi } from './bevy-api'
import { log, setSceneDebug } from './log'
import { state, setActiveAction, topLevelSelected, setSelectionAndActive, type SpawnPointSpec } from './state'
import {
  reloadSnapshot,
  overlayEditorChangelog,
  applyExternalComponentWrite,
  applyExternalComponentDelete,
  applyExternalEntityDelete
} from './inspector'
import { setCamMode, orientToAxis, frameEntityOnce, adjustFlySpeed, cameraDropLocal } from './camera/free-cam'
import { endGizmoDrag } from './viewport/gizmo'
import { forceCursorUnlock } from './system-actions'
import { pickApplied, synthesized } from './viewport/pick-layer'
import { resetAnimationHold } from './viewport/animation-hold'
import { resetHidden, pickAtPointer } from './viewport/click-select'
import { EDITOR_BUS_CHANNEL, type BusEnvelope } from './editor-channel'
import { trace, replayTrace } from './boot-trace'
import {
  type PageToSceneMessage,
  type SceneToPageMessage,
  type EditorTool,
  PROTOCOL_KINDS
} from './bridge-protocol'

// BroadcastChannel is a global exposed to the super-user scene sandbox; it isn't in
// the scene's TS lib, so declare the minimal surface we use (module-scoped, so it
// doesn't clash with the host page's DOM lib).
declare const BroadcastChannel: { new (name: string): {
  postMessage(msg: unknown): void
  onmessage: ((ev: { data: unknown }) => void) | null
} }

const POLL_INTERVAL_S = 0.1

// Inbound page→scene messages, enqueued from the channel callback and drained on
// the scene tick (so handling stays on the scene's frame, not a stray callback).
const channel = new BroadcastChannel(EDITOR_BUS_CHANNEL)
const inbound: PageToSceneMessage[] = []
channel.onmessage = (ev): void => {
  const env = ev.data as BusEnvelope<PageToSceneMessage> | null
  if (env !== null && typeof env === 'object' && env.to === 'scene') inbound.push(env.msg)
}

// system-api methods the page may invoke through the bus (proxied to BevyApi)
const RPC_METHODS = new Set([
  'getPreviousLogin',
  'loginPrevious',
  'loginGuest',
  'liveSceneInfo'
])

// scene-local rpc methods (computed here, not on BevyApi) — e.g. the camera-aware
// drop point for imports, which needs the live engine.CameraEntity transform.
const LOCAL_RPC: Record<string, (...args: unknown[]) => unknown> = {
  cameraDrop: () => cameraDropLocal()
}

let readyAnnounced = false
let foundAnnounced = false
let lastSelectionSig = ''
let lastTool = ''
let lastDragging = false
let lastDragSig = ''

export function startPageUiBridge(): void {
  // When the page was opened with ?editorUi the host React UI WILL attach —
  // suppress the in-scene panels from the first frame instead of flashing
  // them until the bus handshake lands.
  BevyApi.getParams()
    .then((params) => {
      if (params !== null && typeof params === 'object') {
        if ('editorUi' in params) state.pageUi = true
        // ?editorDebug turns on the scene's debug logging (per-frame picking,
        // highlight, bus-poll traces) — off by default to keep runs quiet.
        if ('editorDebug' in params) setSceneDebug(true)
      }
    })
    .catch((e) => log.debug('getParams failed (editorUi autodetect)', e))

  let elapsed = 0
  let busy = false
  engine.addSystem((dt: number) => {
    elapsed += dt
    if (elapsed < POLL_INTERVAL_S || busy) return
    elapsed = 0
    busy = true
    tick()
      .catch((e) => log.debug('bus tick failed', e))
      .then(() => {
        busy = false
      })
  })
}

async function tick(): Promise<void> {
  while (inbound.length > 0) {
    const msg = inbound.shift() as PageToSceneMessage
    try {
      await handle(msg)
    } catch (e) {
      console.error('page-ui: failed to handle message', msg, e)
    }
  }
  if (state.pageUi) notifyChanges()
}

async function handle(msg: PageToSceneMessage): Promise<void> {
  switch (msg.type) {
    case 'init':
      state.pageUi = true
      readyAnnounced = false
      foundAnnounced = false
      // The page attaches its listener after our first steps have already run,
      // and BroadcastChannel doesn't buffer — so hand it the whole trace.
      replayTrace()
      break
    case 'set-tool':
      setActiveAction(msg.tool)
      break
    case 'set-flags':
      if (msg.orientGlobal !== undefined) state.orientGlobal = msg.orientGlobal
      if (msg.pivotEach !== undefined) state.pivotEach = msg.pivotEach
      if (msg.nodeDisplay !== undefined) state.nodeDisplay = msg.nodeDisplay
      if (msg.showLinks !== undefined) state.showLinks = msg.showLinks
      if (msg.snap !== undefined) state.snap = msg.snap
      if (msg.showSpawnAreas !== undefined) state.showSpawnAreas = msg.showSpawnAreas
      break
    case 'spawn-points':
      state.spawnPoints = msg.points as SpawnPointSpec[]
      break
    case 'set-selection':
      setSelectionAndActive(msg.selected, msg.active)
      break
    case 'set-camera':
      setCamMode(msg.mode === 'off' ? 'none' : msg.mode)
      if (msg.axis !== undefined) {
        const sign = msg.axis.startsWith('-') ? -1 : 1
        const axis = msg.axis.replace(/^[+-]/, '') as 'x' | 'y' | 'z'
        if (axis === 'x' || axis === 'y' || axis === 'z') orientToAxis(axis, sign)
      }
      break
    case 'set-frozen':
      state.frozen = msg.frozen
      // back to edit mode: a camera-look toggle from play must not survive
      if (msg.frozen) forceCursorUnlock()
      break
    case 'focus':
      setSelectionAndActive([msg.entity], msg.entity)
      // Focus never enters orbit mode now — see frameEntityOnce. Orbit is still
      // reachable, but only by asking for it (the camera menu's Target mode).
      frameEntityOnce(msg.entity)
      break
    case 'refresh':
      // a frozen scene's /crdt_snapshot is stale (pre-freeze) — refetching would
      // clobber the optimistic snapshot; mutations arrive via component-written.
      if (!state.frozen) await reloadSnapshot()
      break
    case 'pointer-up':
      // authoritative release signal from the page (DOM sees every mouseup).
      // Picking itself is engine-input-driven scene-side (overlay box-select +
      // startGizmoPick), not bus-driven — there's no 'pointer-tap'.
      if (state.gizmoDragging) endGizmoDrag()
      break
    case 'pick-at-pointer':
      // Alt+click from the engine host page — the deliberate editor pick, valid
      // in play mode too (plain clicks belong to the running scene there).
      if (state.status === 'ready' && state.pageUi) pickAtPointer(msg.add, msg.toggle)
      break
    case 'fly-speed':
      adjustFlySpeed(msg.factor)
      break
    case 'resync':
      // forced re-pull — after a restart the freeze-time CRDT is the fresh state.
      // The reloaded scene instance is a new engine instance carrying NONE of our
      // engine-only writes, so every "already applied" marker is now a lie. Drop
      // them all and let the per-frame syncs re-apply: pick colliders (otherwise
      // click-select raycasts hit nothing after Stop — no gizmo), the paused-
      // animation hold, and the hidden-entity overrides.
      pickApplied.clear()
      synthesized.clear()
      resetAnimationHold()
      resetHidden()
      await reloadSnapshot()
      // the pull is stale while frozen (a paused scene never ticks our writes in) —
      // without this, entities placed this session vanish here and lose their gizmo
      overlayEditorChangelog()
      break
    case 'component-written':
      applyExternalComponentWrite(msg.entity, msg.name, msg.json)
      break
    case 'component-deleted':
      applyExternalComponentDelete(msg.entity, msg.name)
      break
    case 'entity-deleted':
      applyExternalEntityDelete(msg.entity, msg.recursive)
      break
    case 'rpc':
      await handleRpc(msg)
      break
  }
}

async function handleRpc(msg: {
  id: number
  method: string
  args?: unknown[]
}): Promise<void> {
  let reply: SceneToPageMessage
  const local = LOCAL_RPC[msg.method]
  if (local === undefined && !RPC_METHODS.has(msg.method)) {
    reply = { type: 'rpc-reply', id: msg.id, ok: false, error: `unknown rpc ${msg.method}` }
  } else {
    try {
      const fn =
        local ??
        (BevyApi as unknown as Record<string, (...a: unknown[]) => unknown>)[msg.method]
      const result = await fn(...(msg.args ?? []))
      reply = { type: 'rpc-reply', id: msg.id, ok: true, result }
    } catch (e) {
      reply = { type: 'rpc-reply', id: msg.id, ok: false, error: String(e) }
    }
  }
  send(reply)
}

// Boot outcomes worth announcing: the page can't wait for 'ready' that will never
// come — a scene with no inspectable target, a failed snapshot, or crashed code.
const ANNOUNCE_STATUSES = new Set(['ready', 'no-scene', 'error', 'scene-broken'])

// Watch for scene-side changes the page needs to mirror. Signature-based so it
// covers every mutation path (world clicks, box select, hotkeys, gizmo).
function notifyChanges(): void {
  // Resolved is enough to draw: say so before the snapshot, which on a big scene
  // is many seconds later — and may never come if the scene's own thread wedges.
  if (!foundAnnounced && state.scene !== undefined) {
    foundAnnounced = true
    send({ type: 'scene-found', scene: state.scene })
  }
  if (!readyAnnounced && ANNOUNCE_STATUSES.has(state.status)) {
    readyAnnounced = true
    trace('announcing scene-ready', `status ${state.status}`)
    send({
      type: 'scene-ready',
      kinds: PROTOCOL_KINDS,
      scene: state.scene ?? null,
      frozen: state.frozen,
      tool: state.activeAction as EditorTool,
      orientGlobal: state.orientGlobal,
      pivotEach: state.pivotEach,
      selected: [...state.selected],
      active: state.activeEntity
    })
    lastSelectionSig = selectionSig()
    lastTool = state.activeAction
    lastDragging = state.gizmoDragging
    return
  }

  const sig = selectionSig()
  if (sig !== lastSelectionSig) {
    lastSelectionSig = sig
    send({ type: 'selection', selected: [...state.selected], active: state.activeEntity })
  }
  if (state.activeAction !== lastTool) {
    lastTool = state.activeAction
    send({ type: 'tool', tool: state.activeAction as EditorTool })
  }
  if (state.gizmoDragging !== lastDragging) {
    lastDragging = state.gizmoDragging
    if (state.gizmoDragging) {
      lastDragSig = ''
      send({ type: 'drag-start' })
    } else {
      // ship the dragged entities' final transforms (fireTransform kept the
      // local snapshot current) — the page can't refetch a frozen scene.
      send({ type: 'drag-end', transforms: draggedTransforms() })
    }
  } else if (state.gizmoDragging) {
    // Mid-drag: the scene's snapshot moves every frame but the page's used to move
    // only at drag-end, so the inspector's number fields sat still through the whole
    // drag and jumped on release. This tick is the throttle (0.1 s); the signature
    // check keeps a held-but-motionless gizmo from re-rendering the page for nothing.
    const transforms = draggedTransforms()
    const sig = JSON.stringify(transforms)
    if (sig !== lastDragSig) {
      lastDragSig = sig
      send({ type: 'drag-update', transforms })
    }
  }
}

function draggedTransforms(): Record<string, unknown> {
  const transforms: Record<string, unknown> = {}
  for (const id of topLevelSelected(state.snapshot)) {
    const t = state.snapshot[id]?.Transform
    if (t !== undefined) transforms[id] = t
  }
  return transforms
}

function selectionSig(): string {
  return `${[...state.selected].sort().join(',')}|${state.activeEntity ?? ''}`
}

function send(msg: SceneToPageMessage): void {
  channel.postMessage({ to: 'page', msg } satisfies BusEnvelope<SceneToPageMessage>)
}

// For modules that relay engine state to the page (play-hud.ts).
export function sendToPage(msg: SceneToPageMessage): void {
  send(msg)
}
