// Play-mode HUD relay: the engine's hover stream + cursor-lock state → the host
// page, which draws the crosshair and the "press E to interact" prompts (the
// same feedback the explorer's react-web HUD shows in preview/prod — on web the
// engine itself never draws them, the page is the HUD).
//
// Ported from react-web's bridge-scene pointer domain. The hover stream is a
// super-user API and its receiver is a single slot per scene — this module must
// stay the only subscriber (same discipline as system-actions.ts for the system
// action stream).
import { engine, PointerLock, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { BevyApi } from './bevy-api'
import { state } from './state'
import { sendToPage } from './page-ui'
import { log } from './log'
import { zonesContaining } from './viewport/zone-inside'
import type { HoverHint } from './bridge-protocol'

const PET_DOWN = 1 // PointerEventType.PET_DOWN — only press entries make prompts
const TARGET_UI = 1 // PointerTargetType.Ui — hovers over engine UI aren't world hints
const MAX_HINTS = 7 // matches react-web's radial slot count
// Zone containment is a walking-speed fact and costs a snapshot walk per zone,
// so it is sampled, not run every frame.
const ZONE_EVERY = 6

export function startPlayHud(): void {
  // Cursor-lock → crosshair. The engine writes PbPointerLock.isPointerLocked to
  // the CAMERA entity whenever it grabs the mouse for camera-look; it does NOT
  // use the browser Pointer Lock API, so the page can't detect this itself.
  // (PrimaryPointerInfo.screenCoordinates is the window centre while locked, not
  // null — don't use it for lock detection.)
  let sentLocked: boolean | null = null
  engine.addSystem(() => {
    const locked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked === true
    if (locked !== sentLocked) {
      sentLocked = locked
      sendToPage({ type: 'cursor-lock', locked })
    }
  })

  engine.addSystem(zoneOccupancy)

  hoverLoop().catch((e) => {
    log.debug('hover stream ended', e)
  })
}

// Which zones the avatar is standing in → the page's "You're inside" chip. The
// zone's own script only ever learns this inside the played scene's runtime, so
// the editor derives it from the snapshot instead (viewport/zone-inside.ts).
//
// Membership stays out of it: whether a 'once ever' / 'once per player' entry has
// already been consumed lives in the played scene's Membership instance, which no
// CRDT component exposes — so the chip says where you are, never whether an entry
// would fire.
let zoneFrames = 0
let sentZones: string | null = null

function sendZones(inside: string[]): void {
  const key = inside.join('\u0000')
  if (key === sentZones) return
  sentZones = key
  sendToPage({ type: 'zones', inside })
}

function zoneOccupancy(): void {
  // frozen = edit mode: there is no avatar walking anywhere to report
  if (state.frozen) {
    sendZones([])
    return
  }
  zoneFrames += 1
  if (zoneFrames < ZONE_EVERY) return
  zoneFrames = 0
  const feet = Transform.getOrNull(engine.PlayerEntity)?.position
  sendZones(feet === undefined ? [] : zonesContaining(state.snapshot, Vector3.create(feet.x, feet.y, feet.z)))
}

let sentEmpty = false
function sendHover(actions: HoverHint[]): void {
  // the stream idles between changes, but re-sending "nothing hovered" is free
  // to suppress — the page keeps state between messages
  if (actions.length === 0 && sentEmpty) return
  sentEmpty = actions.length === 0
  sendToPage({ type: 'hover', actions })
}

async function hoverLoop(): Promise<void> {
  const stream = await BevyApi.getHoverStream()
  for await (const ev of stream) {
    // while frozen (edit mode) the page hides the HUD; don't accumulate hints
    if (state.frozen) {
      sendHover([])
      continue
    }
    if (!ev.entered || ev.targetType === TARGET_UI) {
      sendHover([])
      continue
    }
    const actions: HoverHint[] = ev.actions
      .filter((a) => a.eventType === PET_DOWN && a.eventInfo?.showFeedback !== false)
      .slice(0, MAX_HINTS)
      .map((a) => ({
        button: a.eventInfo?.button ?? 1,
        text: a.eventInfo?.hoverText ?? 'Interact',
        enabled: a.enabled !== false,
        // maxPlayerDistance configured → the entry is range-gated by player
        // distance; otherwise the camera rule (incl. the implicit 10m default)
        tooFarReason:
          a.enabled === false ? (a.eventInfo?.maxPlayerDistance == null ? 'camera' : 'player') : undefined
      }))
    sendHover(actions)
  }
}
