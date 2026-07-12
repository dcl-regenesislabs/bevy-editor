// "Sign in with Decentraland" — the deep-link flow, ported from the creator-hub
// (decentraland/creator-hub#1338, lib/auth.ts). Sequence:
//   1. POST {auth-server}/requests with a dcl_personal_sign ephemeral message →
//      { requestId }. (The ephemeral keypair only forms the request body; the
//      identity that comes back is self-contained and generated dapp-side.)
//   2. Open {auth-dapp}/requests/{requestId}?targetConfigId=…&flow=deeplink in
//      the user's browser (via the Electron shell). The user signs there.
//   3. The dapp POSTs the signed AuthIdentity to the auth server and navigates
//      to `<scheme>://open?signin=<identityId>` — the OS routes that deep-link
//      to our app; main pushes the identityId over AUTH_SIGNIN_CHANNEL.
//   4. GET {auth-server}/identities/{identityId} → the full AuthIdentity, which
//      we persist via @dcl/single-sign-on-client (localStorage). No tokens —
//      auth is the DCL AuthChain, usable later to sign deployments.
import { useEffect, useState } from 'react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Authenticator, type AuthIdentity } from '@dcl/crypto'
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

const IDENTITY_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

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

// POST the sign request; resolves the requestId the auth dapp URL needs plus
// the verification code the dapp shows the user (we display it too so they can
// confirm the numbers match — same trust cue as the creator-hub).
async function createSignInRequest(): Promise<{ requestId: string; code?: number }> {
  const account = privateKeyToAccount(generatePrivateKey())
  const expiration = new Date(Date.now() + IDENTITY_EXPIRATION_MS)
  const ephemeralMessage = Authenticator.getEphemeralMessage(account.address, expiration)
  const response = await fetch(`${env().server}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'dcl_personal_sign', params: [ephemeralMessage] })
  })
  if (!response.ok) throw new SignInError('unknown', `Failed to create the sign-in request (${response.status})`)
  return (await response.json()) as { requestId: string; code?: number }
}

function getAuthDappUrl(requestId: string): string {
  return `${env().dapp}/requests/${requestId}?targetConfigId=${TARGET_CONFIG_ID}&flow=deeplink`
}

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
  if (typeof payload !== 'string') throw new SignInError('unknown', 'Malformed identity response')
  return { identity, signer: payload.toLowerCase() }
}

async function applyDeepLinkIdentity(identityId: string): Promise<string> {
  const { identity, signer } = await fetchIdentity(identityId)
  localStorage.setItem(STORAGE_KEY_ADDRESS, signer)
  sso.localStorageStoreIdentity(signer, identity)
  return signer
}

export function getAccount(): string | null {
  return localStorage.getItem(STORAGE_KEY_ADDRESS)
}

// sso returns nothing for an expired identity, so this covers expiry too.
export function hasValidIdentity(): boolean {
  const account = getAccount()
  if (account === null) return false
  return sso.localStorageGetIdentity(account) !== null
}

export function getIdentity(): AuthIdentity | null {
  const account = getAccount()
  return account !== null ? sso.localStorageGetIdentity(account) : null
}

export function signOut(): void {
  const account = getAccount()
  if (account !== null) sso.localStorageClearIdentity(account)
  localStorage.removeItem(STORAGE_KEY_ADDRESS)
}

// Run one sign-in: subscribe to the deep-link callback FIRST (so an early
// bounce isn't missed), then create the request and open the browser. Resolves
// the signer address; rejects on SignInError, shell absence, or the 15-min
// safety timeout (the user may simply abandon the browser tab).
//
// Anti session-fixation: any app/webpage can fire our scheme with a foreign
// identityId. Outside a pending signIn() there is no subscriber, so unsolicited
// deep-links are inert; during one, a callback that echoes an authRequestId for
// a different request is ignored (the dapp echoes it when available).
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

export async function signIn(onCode?: (code: number) => void): Promise<string> {
  const shell = window.editorShell
  if (shell?.openExternal === undefined || shell.onSignIn === undefined) {
    throw new SignInError('unknown', 'Sign-in needs the desktop app')
  }
  return await new Promise<string>((resolve, reject) => {
    let done = false
    let ourRequestId: string | null = null
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      unsubscribe()
      clearTimeout(timer)
      fn()
    }
    const unsubscribe = shell.onSignIn!(({ identityId, authRequestId }) => {
      if (authRequestId !== null && ourRequestId !== null && authRequestId !== ourRequestId) return
      applyDeepLinkIdentity(identityId)
        .then((signer) => finish(() => resolve(signer)))
        .catch((e: unknown) => finish(() => reject(e)))
    })
    const timer = setTimeout(
      () => finish(() => reject(new SignInError('expired', 'Sign-in timed out — try again'))),
      SIGN_IN_TIMEOUT_MS
    )
    createSignInRequest()
      .then(({ requestId, code }) => {
        ourRequestId = requestId
        if (code !== undefined) onCode?.(code)
        return shell.openExternal!(getAuthDappUrl(requestId))
      })
      .catch((e: unknown) => finish(() => reject(e)))
  })
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
  verificationCode: number | null
  error: string | null
  signIn: () => void
  signOut: () => void
}

export function useAuth(): AuthState {
  const [wallet, setWallet] = useState<string | null>(() => (hasValidIdentity() ? getAccount() : null))
  const [profile, setProfile] = useState<DclProfile | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const [verificationCode, setVerificationCode] = useState<number | null>(null)
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
    setVerificationCode(null)
    setError(null)
    signIn(setVerificationCode)
      .then((signer) => setWallet(signer))
      .catch((e: unknown) => {
        setError(e instanceof SignInError && e.reason === 'expired' ? 'The sign-in expired — try again.' : String(e instanceof Error ? e.message : e))
      })
      .finally(() => {
        setSigningIn(false)
        setVerificationCode(null)
      })
  }
  const doSignOut = (): void => {
    signOut()
    setWallet(null)
    setError(null)
  }

  return { wallet, profile, signingIn, verificationCode, error, signIn: doSignIn, signOut: doSignOut }
}
