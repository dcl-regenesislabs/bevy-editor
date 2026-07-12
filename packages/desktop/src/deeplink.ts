// Deep-link protocol for the decentraland.org/auth sign-in bounce-back (the
// creator-hub flow, PR decentraland/creator-hub#1338): the auth dapp finishes a
// `flow=deeplink` request by navigating to `<scheme>://open?signin=<identityId>`,
// which the OS routes to this app. Pure parsing helpers — the app lifecycle
// wiring (single-instance lock, open-url, second-instance) lives in main.ts,
// which owns the window.
//
// We reuse the Creator Hub's scheme + its `creator-hub` targetConfigId
// (ui/src/auth.ts), so sign-in needs no change to the auth dapp. Caveat: if the
// standalone Creator Hub is installed, the OS may route this scheme to it
// instead — the fix (if that becomes a problem) is to give the editor its own
// scheme + a `dcl-editor` targetConfig via a one-line PR to decentraland/auth.
export const DEEPLINK_PROTOCOLS = ['dcl-creator-hub'] as const

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
