import type { Vector2 } from '@dcl/sdk/math'

export type LiveSceneInfo = {
  hash: string
  base_url?: string
  title: string
  parcels: Vector2[]
  isPortable: boolean
  isBroken: boolean
  isBlocked: boolean
  isSuper: boolean
  sdkVersion: string
}

// The subset of the explorer's `~system/BevyExplorerApi` surface this scene uses.
export type BevyApiInterface = {
  getPreviousLogin: () => Promise<{ userId: string | null }>
  loginPrevious: () => Promise<{ success: boolean; error: string }>
  loginGuest: () => void

  liveSceneInfo: () => Promise<LiveSceneInfo[]>

  // Run an arbitrary console command and await its reply via the per-invocation
  // response channel. `cmd` is the command name without the leading slash.
  // Resolves with the reply string on success, rejects with the failure message.
  consoleCommand: (cmd: string, args?: string[]) => Promise<string>

  // The explorer's launch params (on web: the page's URL query parameters).
  getParams: () => Promise<Record<string, string>>

  // Subscribe to the system action stream (super-user scenes only). Yields
  // `{ action, pressed }` events; `action` is the SystemAction variant name
  // (e.g. 'CameraLock', bound to right-click). Returns an async-iterable.
  getSystemActionStream: () => Promise<
    AsyncIterable<{ action: string; pressed: boolean }>
  >

  // Subscribe to the engine's hover stream (super-user scenes only): fires when
  // the pointer target changes or a target's action set / enabled flags change.
  // NOTE: like every SystemApi stream, the receiver is a single slot PER SCENE —
  // subscribe from exactly one place (play-hud.ts) or the streams clobber.
  getHoverStream: () => Promise<AsyncIterable<HoverStreamEvent>>

  // Graphics/quality settings — the same surface the explorer's settings menu
  // drives. `getSettings` returns each setting with its current value and its
  // enumerated variants (a named setting's value is an index into namedVariants).
  // `setSetting` applies one by (human) name + value. The "Graphics Preset"
  // dropdown is NOT an engine setting — it's a scene-side bundle that applies a
  // column of these; we replicate that in graphics-preset.ts.
  getSettings: () => Promise<EngineSetting[]>
  setSetting: (name: string, value: number) => Promise<void>
}

export type EngineSetting = {
  name: string
  value: number
  namedVariants: Array<{ name: string }>
}

// Hover stream wire shapes (system_api_types HoverEvent/HoverAction, camelCase
// serde). An action is a flattened PBPointerEvents Entry + the engine's verdict
// on whether its distance gates pass right now.
export type HoverStreamAction = {
  eventType: number // PointerEventType (1 = PET_DOWN)
  eventInfo?: {
    button?: number
    hoverText?: string
    maxDistance?: number
    maxPlayerDistance?: number
    showFeedback?: boolean
  }
  enabled: boolean
}

export type HoverStreamEvent = {
  entered: boolean
  targetType: number // PointerTargetType (1 = UI)
  actions: HoverStreamAction[]
}
