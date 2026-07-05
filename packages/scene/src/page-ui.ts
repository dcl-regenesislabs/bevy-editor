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
import { state, setActiveAction, topLevelSelected, setSelected } from './state'
import {
  reloadSnapshot,
  applyExternalComponentWrite,
  applyExternalEntityDelete
} from './inspector'
import { setCamMode, orientToAxis, focusOrbitOn, frameEntityOnce, adjustFlySpeed, cameraDropLocal } from './camera/free-cam'
import { endGizmoDrag } from './viewport/gizmo'
import { pickApplied, synthesized } from './viewport/pick-layer'
import { EDITOR_BUS_CHANNEL, type BusEnvelope } from './editor-channel'
import {
  type PageToSceneMessage,
  type SceneToPageMessage,
  type EditorTool,
  SCENE_BRIDGE_VERSION
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
let lastSelectionSig = ''
let lastTool = ''
let lastDragging = false

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
      break
    case 'set-tool':
      setActiveAction(msg.tool)
      break
    case 'set-flags':
      if (msg.orientGlobal !== undefined) state.orientGlobal = msg.orientGlobal
      if (msg.pivotEach !== undefined) state.pivotEach = msg.pivotEach
      if (msg.nodeDisplay !== undefined) state.nodeDisplay = msg.nodeDisplay
      if (msg.showLinks !== undefined) state.showLinks = msg.showLinks
      break
    case 'set-selection':
      setSelected(msg.selected)
      state.activeEntity = msg.active
      break
    case 'set-camera':
      setCamMode(msg.mode === 'off' ? 'none' : msg.mode)
      if (msg.axis !== undefined) {
        const sign = msg.axis.startsWith('-') ? -1 : 1
        const axis = msg.axis.replace(/^[+-]/, '') as 'x' | 'y' | 'z'
        if (axis === 'x' || axis === 'y' || axis === 'z') orientToAxis(axis, sign)
      }
      break
    case 'focus':
      setSelected([msg.entity])
      state.activeEntity = msg.entity
      if (msg.orbit === false) frameEntityOnce(msg.entity)
      else focusOrbitOn(msg.entity)
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
    case 'fly-speed':
      adjustFlySpeed(msg.factor)
      break
    case 'resync':
      // forced re-pull — after a restart the freeze-time CRDT is the fresh state.
      // The reloaded scene instance lost our engine-only pick colliders, so drop
      // the applied-markers too — the per-frame syncPickColliders re-writes them
      // (otherwise click-select raycasts hit nothing after Stop: no gizmo).
      pickApplied.clear()
      synthesized.clear()
      await reloadSnapshot()
      break
    case 'component-written':
      applyExternalComponentWrite(msg.entity, msg.name, msg.json)
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

// Watch for scene-side changes the page needs to mirror. Signature-based so it
// covers every mutation path (world clicks, box select, hotkeys, gizmo).
function notifyChanges(): void {
  if (!readyAnnounced && (state.status === 'ready' || state.status === 'no-scene' || state.status === 'error')) {
    readyAnnounced = true
    send({
      type: 'scene-ready',
      bridge: SCENE_BRIDGE_VERSION,
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
      send({ type: 'drag-start' })
    } else {
      // ship the dragged entities' final transforms (fireTransform kept the
      // local snapshot current) — the page can't refetch a frozen scene.
      const transforms: Record<string, unknown> = {}
      for (const id of topLevelSelected(state.snapshot)) {
        const t = state.snapshot[id]?.Transform
        if (t !== undefined) transforms[id] = t
      }
      send({ type: 'drag-end', transforms })
    }
  }
}

function selectionSig(): string {
  return `${[...state.selected].sort().join(',')}|${state.activeEntity ?? ''}`
}

function send(msg: SceneToPageMessage): void {
  channel.postMessage({ to: 'page', msg } satisfies BusEnvelope<SceneToPageMessage>)
}
