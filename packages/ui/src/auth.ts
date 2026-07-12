// "Sign in with Decentraland" — the client-login deep-link flow. Sequence:
//   1. Open {auth-dapp}/requests/client-login?targetConfigId=…&flow=deeplink&
//      authRequestId=<nonce> in the user's browser. `client-login` is a pseudo
//      request-id with NO backing auth-server request (decentraland/auth
//      RequestPage isClientLoginFlow) — the user just logs in there.
//   2. The dapp builds the AuthIdentity (its own ephemeral keypair), POSTs it to
//      the auth server for an identityId, and navigates to
//      `<scheme>://open?signin=<identityId>&authRequestId=<nonce>`. The OS routes
//      that deep-link to our app; main pushes { identityId, authRequestId }.
//   3. We accept ONLY a callback echoing the nonce we generated (anti
//      session-fixation), then GET {auth-server}/identities/<identityId> for the
//      full, self-contained AuthIdentity and persist it via the SSO client.
// No tokens (auth is the DCL AuthChain), and no ephemeral key is generated here
// — it arrives inside the fetched identity.
import { useEffect, useState } from 'react'
import type { AuthIdentity } from '@dcl/crypto'
import * as sso from '@dcl/single-sign-on-client'

const STORAGE_KEY_ADDRESS = 'auth-server-provider-address'

// The auth dapp resolves targetConfigId → its bounce-back scheme CLIENT-SIDE
// (decentraland/auth src/hooks/targetConfig.ts). 'creator-hub' maps to
// dcl-creator-hub:// (which the desktop shell also registers), so sign-in works
// today; switch to 'dcl-editor' once the one-line PR adding it to the dapp's
// targetConfigs map lands. Unknown ids silently fall back to no deep-link.
export const TARGET_CONFIG_ID = 'creator-hub'

// prod by default; flip to the .zone pair for testing against Sepolia with
// localStorage.setItem('dcl-auth-env', 'zone').
const ENVS = {
  prod: { server: 'https://auth-api.decentraland.org', dapp: 'https://decentraland.org/auth' },
  zone: { server: 'https://auth-api.decentraland.zone', dapp: 'https://decentraland.zone/auth' }
}
function env(): { server: string; dapp: string } {
  return localStorage.getItem('dcl-auth-env') === 'zone' ? ENVS.zone : ENVS.prod
}

export type SignInErrorReason = 'not_found' | 'expired' | 'network' | 'unknown'

export class SignInError extends Error {
  constructor(
    readonly reason: SignInErrorReason,
    message: string
  ) {
    super(message)
    this.name = 'SignInError'
  }
}

// `authRequestId` is our own random nonce — the dapp echoes it into the callback
// (decentraland/auth shared/locations.ts AUTH_REQUEST_ID_PARAM), which is what
// binds the callback to the sign-in this app started. Independent of any
// auth-server request id (that concept is being deprecated).
function getAuthDappUrl(nonce: string): string {
  const q = new URLSearchParams({ targetConfigId: TARGET_CONFIG_ID, flow: 'deeplink', authRequestId: nonce })
  return `${env().dapp}/requests/client-login?${q.toString()}`
}

const ADDRESS_RE = /^0x[a-f0-9]{40}$/

// The identity is single-use and self-contained (it includes the ephemeral key
// pair the dapp generated); the deep-link only carries its lookup id.
async function fetchIdentity(identityId: string): Promise<{ identity: AuthIdentity; signer: string }> {
  const response = await fetch(`${env().server}/identities/${encodeURIComponent(identityId)}`)
  if (response.status === 404) throw new SignInError('not_found', 'Sign-in identity not found')
  if (response.status === 410) throw new SignInError('expired', 'The sign-in expired — try again')
  if (response.status === 403) throw new SignInError('network', 'Sign-in network mismatch')
  if (!response.ok) throw new SignInError('unknown', `Failed to fetch the identity (${response.status})`)
  const { identity } = (await response.json()) as { identity: AuthIdentity }
  const payload = identity?.authChain?.[0]?.payload
  // must be a real address: the SSO client throws on anything else, and a
  // persisted garbage address would crash every subsequent render
  if (typeof payload !== 'string' || !ADDRESS_RE.test(payload.toLowerCase())) {
    throw new SignInError('unknown', 'Malformed identity response')
  }
  return { identity, signer: payload.toLowerCase() }
}

async function applyDeepLinkIdentity(identityId: string): Promise<string> {
  const { identity, signer } = await fetchIdentity(identityId)
  // store the identity FIRST — only mark the address once the identity actually
  // persisted, so a throw can't leave a poisoned address behind
  sso.localStorageStoreIdentity(signer, identity)
  localStorage.setItem(STORAGE_KEY_ADDRESS, signer)
  return signer
}

export function getAccount(): string | null {
  return localStorage.getItem(STORAGE_KEY_ADDRESS)
}

// sso returns nothing for an expired identity, so this covers expiry too. The
// sso calls throw on a non-address key — degrade to signed-out instead of
// crashing every render if bad data ever lands in localStorage.
export function hasValidIdentity(): boolean {
  const account = getAccount()
  if (account === null) return false
  try {
    const id = sso.localStorageGetIdentity(account)
    return id !== null && id !== undefined
  } catch {
    return false
  }
}

export function getIdentity(): AuthIdentity | null {
  const account = getAccount()
  if (account === null) return null
  try {
    return sso.localStorageGetIdentity(account) ?? null
  } catch {
    return null
  }
}

export function signOut(): void {
  const account = getAccount()
  if (account !== null) {
    try {
      sso.localStorageClearIdentity(account)
    } catch {
      /* bad stored address — removing our key below is the actual sign-out */
    }
  }
  localStorage.removeItem(STORAGE_KEY_ADDRESS)
}

// Run one sign-in: mint a nonce, subscribe to the deep-link callback FIRST (so
// an early bounce isn't missed), then open the browser. Resolves the signer
// address; rejects on SignInError, shell absence, or the 15-min safety timeout
// (the user may abandon the browser tab).
//
// Anti session-fixation: any local app/webpage can fire our OS-registered
// scheme with a foreign identityId. Outside a pending signIn() there is no
// subscriber, so unsolicited deep-links are inert. During one, we STRICTLY
// require the callback to echo the nonce we generated — a callback without it
// (or with a different one) is not ours and is ignored (we keep waiting), so an
// attacker can't race the window by omitting the parameter. Cold-start
// callbacks (app relaunched by the deep-link) have no pending nonce and are
// dropped by design.
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

// One flow at a time, module-scoped: a remounting Account section rejoins the
// in-flight sign-in instead of stacking a second subscriber/browser tab.
let inflightSignIn: Promise<string> | null = null

export async function signIn(): Promise<string> {
  if (inflightSignIn !== null) return await inflightSignIn
  const shell = window.editorShell
  if (shell?.openExternal === undefined || shell.onSignIn === undefined) {
    throw new SignInError('unknown', 'Sign-in needs the desktop app')
  }
  const nonce = crypto.randomUUID()
  inflightSignIn = new Promise<string>((resolve, reject) => {
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      unsubscribe()
      clearTimeout(timer)
      fn()
    }
    const unsubscribe = shell.onSignIn!(({ identityId, authRequestId }) => {
      // strict binding: only the callback echoing OUR nonce counts
      if (authRequestId !== nonce) return
      applyDeepLinkIdentity(identityId)
        .then((signer) => finish(() => resolve(signer)))
        .catch((e: unknown) => finish(() => reject(e)))
    })
    const timer = setTimeout(
      () => finish(() => reject(new SignInError('expired', 'Sign-in timed out — try again'))),
      SIGN_IN_TIMEOUT_MS
    )
    shell.openExternal!(getAuthDappUrl(nonce)).catch((e: unknown) => finish(() => reject(e)))
  })
  try {
    return await inflightSignIn
  } finally {
    inflightSignIn = null
  }
}

export function isSigningIn(): boolean {
  return inflightSignIn !== null
}

// ---- profile (avatar) ----
export interface DclProfile {
  name: string
  hasClaimedName: boolean
  face256: string | null
}

const PEER_URL = 'https://peer.decentraland.org'

export async function fetchProfile(address: string): Promise<DclProfile | null> {
  try {
    const res = await fetch(`${PEER_URL}/lambdas/profiles/${address}`)
    if (!res.ok) return null
    const profile = (await res.json()) as {
      avatars?: Array<{ name?: string; hasClaimedName?: boolean; avatar?: { snapshots?: { face256?: string } } }>
    }
    const a = profile.avatars?.[0]
    if (a === undefined) return null
    return {
      name: a.name ?? '',
      hasClaimedName: a.hasClaimedName === true,
      face256: a.avatar?.snapshots?.face256 ?? null
    }
  } catch {
    return null
  }
}

// ---- React binding ----
export interface AuthState {
  wallet: string | null
  profile: DclProfile | null
  signingIn: boolean
  error: string | null
  signIn: () => void
  signOut: () => void
}

export function useAuth(): AuthState {
  const [wallet, setWallet] = useState<string | null>(() => (hasValidIdentity() ? getAccount() : null))
  const [profile, setProfile] = useState<DclProfile | null>(null)
  const [signingIn, setSigningIn] = useState(isSigningIn) // rejoin an in-flight flow on remount
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (wallet === null) {
      setProfile(null)
      return
    }
    let live = true
    void fetchProfile(wallet).then((p) => {
      if (live) setProfile(p)
    })
    return () => {
      live = false
    }
  }, [wallet])

  const doSignIn = (): void => {
    if (signingIn) return
    setSigningIn(true)
    setError(null)
    signIn()
      .then((signer) => setWallet(signer))
      .catch((e: unknown) => {
        setError(e instanceof SignInError && e.reason === 'expired' ? 'The sign-in expired — try again.' : String(e instanceof Error ? e.message : e))
      })
      .finally(() => setSigningIn(false))
  }
  const doSignOut = (): void => {
    signOut()
    setWallet(null)
    setError(null)
  }

  return { wallet, profile, signingIn, error, signIn: doSignIn, signOut: doSignOut }
}
