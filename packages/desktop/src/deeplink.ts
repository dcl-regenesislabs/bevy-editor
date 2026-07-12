// Deep-link protocol for the decentraland.org/auth sign-in bounce-back (the
// creator-hub flow, PR decentraland/creator-hub#1338): the auth dapp finishes a
// `flow=deeplink` request by navigating to `<scheme>://open?signin=<identityId>`,
// which the OS routes to this app. Pure parsing helpers — the app lifecycle
// wiring (single-instance lock, open-url, second-instance) lives in main.ts,
// which owns the window.
//
// Two schemes: `dcl-editor` is ours (pending a one-line PR to decentraland/auth
// adding it to the dapp's client-side targetConfigs map); until that lands the
// renderer sends targetConfigId=creator-hub, whose registered bounce-back is
// `dcl-creator-hub://` — so we accept and register both. If the real Creator
// Hub is installed the OS may route that scheme to it instead; the fix is
// landing the dapp PR and flipping TARGET_CONFIG_ID in ui/src/auth.ts.
export const DEEPLINK_PROTOCOLS = ['dcl-editor', 'dcl-creator-hub'] as const

export function isDeeplink(arg: string): boolean {
  return typeof arg === 'string' && DEEPLINK_PROTOCOLS.some((p) => arg.startsWith(`${p}://`))
}

// Extract the sign-in payload from `<scheme>://open?signin=<id>`; null for any
// other/malformed deep-link (unknown actions are ignored, not errors). The dapp
// may also echo the originating authRequestId — forwarded so the renderer can
// bind the callback to the request it actually started (anti session-fixation).
export interface SigninDeeplink {
  identityId: string
  authRequestId: string | null
}

export function parseSignin(url: string): SigninDeeplink | null {
  try {
    const u = new URL(url)
    if (!DEEPLINK_PROTOCOLS.some((p) => u.protocol === `${p}:`)) return null
    if (u.hostname !== 'open') return null
    const signin = u.searchParams.get('signin')
    if (signin === null || signin === '') return null
    return { identityId: signin, authRequestId: u.searchParams.get('authRequestId') }
  } catch {
    return null
  }
}
