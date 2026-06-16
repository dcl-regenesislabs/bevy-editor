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
}
