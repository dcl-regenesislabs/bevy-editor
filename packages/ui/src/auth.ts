// "Sign in with Decentraland" — the deep-link flow the Creator Hub ships today
// (decentraland/creator-hub main lib/auth.ts). Sequence:
//   1. POST {auth-server}/requests with a dcl_personal_sign ephemeral message →
//      { requestId }. The ephemeral keypair only forms the request body; the
//      identity that comes back is self-contained and NOT reused from here.
//   2. Open {auth-dapp}/requests/{requestId}?targetConfigId=…&flow=deeplink&
//      authRequestId=<nonce> in the user's browser. The user signs there.
//   3. The dapp POSTs the signed AuthIdentity to the auth server and navigates
//      to `<scheme>://open?signin=<identityId>&authRequestId=<nonce>`. The OS
//      routes that deep-link to our app; main pushes { identityId, authRequestId }.
//   4. We accept ONLY a callback echoing the nonce we generated (anti
//      session-fixation), then GET {auth-server}/identities/<identityId> for the
//      full, self-contained AuthIdentity and persist it via the SSO client.
// No tokens (auth is the DCL AuthChain). (client-login — a pseudo request-id —
// is an Explorer-session bridge, NOT a fresh web sign-in: opening it directly
// yields "request is not available".)
import { useEffect, useSyncExternalStore } from 'react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Authenticator, type AuthIdentity } from '@dcl/crypto'
import * as sso from '@dcl/single-sign-on-client'

const STORAGE_KEY_ADDRESS = 'auth-server-provider-address'

// The auth dapp resolves targetConfigId → its bounce-back scheme CLIENT-SIDE
// (decentraland/auth src/hooks/targetConfig.ts). We reuse the Creator Hub's
// 'creator-hub' config, which maps to dcl-creator-hub:// (the scheme the desktop
// shell registers). If the editor ever needs its own identity — e.g. to coexist
// with the standalone Creator Hub — add a 'dcl-editor' entry to that map (a
// one-line PR to decentraland/auth) and change this.
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

export type SignInErrorReason = 'not_found' | 'expired' | 'network' | 'cancelled' | 'unknown'

export class SignInError extends Error {
  constructor(
    readonly reason: SignInErrorReason,
    message: string
  ) {
    super(message)
    this.name = 'SignInError'
  }
}

const IDENTITY_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

// Create the auth request; resolves the requestId the dapp URL needs. The local
// keypair only forms a valid dcl_personal_sign body — the finished identity is
// fetched self-contained later, so this key is throwaway.
async function createSignInRequest(): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey())
  const expiration = new Date(Date.now() + IDENTITY_EXPIRATION_MS)
  const ephemeralMessage = Authenticator.getEphemeralMessage(account.address, expiration)
  const response = await fetch(`${env().server}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'dcl_personal_sign', params: [ephemeralMessage] })
  })
  if (!response.ok) throw new SignInError('unknown', `Failed to create the sign-in request (${response.status})`)
  const { requestId } = (await response.json()) as { requestId: string }
  return requestId
}

// `authRequestId` is our own random nonce, distinct from the auth-server
// requestId — the dapp echoes it into the callback (decentraland/auth
// shared/locations.ts AUTH_REQUEST_ID_PARAM), which is what binds the callback
// to the sign-in this app started.
function getAuthDappUrl(requestId: string, nonce: string): string {
  const q = new URLSearchParams({ targetConfigId: TARGET_CONFIG_ID, flow: 'deeplink', authRequestId: nonce })
  return `${env().dapp}/requests/${encodeURIComponent(requestId)}?${q.toString()}`
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

const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

// ---- sign-in state machine (a module singleton so the top-right avatar, the
// Home rail, and the Account section all read one source of truth) ----
export type SignInPhase = 'idle' | 'opening' | 'waiting' | 'error'

interface AuthStore {
  wallet: string | null
  profile: DclProfile | null
  phase: SignInPhase
  error: string | null
  errorReason: SignInErrorReason | null
}
let store: AuthStore = {
  wallet: hasValidIdentity() ? getAccount() : null,
  profile: null,
  phase: 'idle',
  error: null,
  errorReason: null
}
const listeners = new Set<() => void>()
function setStore(patch: Partial<AuthStore>): void {
  store = { ...store, ...patch }
  for (const l of listeners) l()
}

let inflight = false
let cancelInflight: (() => void) | null = null
let currentDappUrl: string | null = null // cached so "reopen browser" reuses the same request

async function loadProfile(address: string): Promise<void> {
  const p = await fetchProfile(address)
  if (store.wallet === address) setStore({ profile: p })
}

// Start a sign-in (no-op if one is already running). Drives the phase machine
// and sets wallet/profile on success.
//
// Anti session-fixation: our scheme is OS-registered, so any local app/page can
// fire a foreign identityId. Outside a pending sign-in there's no subscriber, so
// those are inert. During one, a callback echoing a DIFFERENT nonce is rejected;
// an ABSENT echo is accepted only because prod auth-site (4.20.0) doesn't echo
// yet — it can still only arrive inside this window (the shipping Creator Hub's
// own posture), and tightens to strict once prod ships the echo.
export function signIn(): void {
  if (inflight) return
  const shell = window.editorShell
  if (shell?.openExternal === undefined || shell.onSignIn === undefined) {
    setStore({ phase: 'error', error: 'Sign-in needs the desktop app', errorReason: 'unknown' })
    return
  }
  inflight = true
  currentDappUrl = null
  setStore({ phase: 'opening', error: null, errorReason: null })
  const nonce = crypto.randomUUID()
  let done = false
  const finish = (result: { signer: string } | { error: SignInError }): void => {
    if (done) return
    done = true
    unsubscribe()
    clearTimeout(timer)
    cancelInflight = null
    inflight = false
    if ('signer' in result) {
      setStore({ wallet: result.signer, phase: 'idle', error: null, errorReason: null })
      void loadProfile(result.signer)
    } else if (result.error.reason === 'cancelled') {
      setStore({ phase: 'idle', error: null, errorReason: null })
    } else {
      setStore({ phase: 'error', error: result.error.message, errorReason: result.error.reason })
    }
  }
  const toError = (e: unknown): SignInError =>
    e instanceof SignInError ? e : new SignInError('unknown', e instanceof Error ? e.message : String(e))
  const unsubscribe = shell.onSignIn(({ identityId, authRequestId }) => {
    if (authRequestId !== null && authRequestId !== nonce) return
    applyDeepLinkIdentity(identityId)
      .then((signer) => finish({ signer }))
      .catch((e: unknown) => finish({ error: toError(e) }))
  })
  const timer = setTimeout(() => finish({ error: new SignInError('expired', 'Sign-in timed out — try again') }), SIGN_IN_TIMEOUT_MS)
  cancelInflight = () => finish({ error: new SignInError('cancelled', 'Sign-in cancelled') })
  createSignInRequest()
    .then((requestId) => {
      currentDappUrl = getAuthDappUrl(requestId, nonce)
      setStore({ phase: 'waiting' })
      return shell.openExternal!(currentDappUrl)
    })
    .catch((e: unknown) => finish({ error: toError(e) }))
}

export function cancelSignIn(): void {
  cancelInflight?.()
}
// Re-open the browser to the SAME pending request (the tab may have been closed).
export function reopenSignInBrowser(): void {
  if (currentDappUrl !== null) void window.editorShell?.openExternal?.(currentDappUrl)
}
export function dismissError(): void {
  if (store.phase === 'error') setStore({ phase: 'idle', error: null, errorReason: null })
}
// Dev fallback: the OS can't route dcl-creator-hub:// to an unpackaged app, so
// the user pastes the callback URL and we hand it to main, which re-emits it on
// the same channel as a real deep-link (the inflight onSignIn subscriber, with
// its nonce gate, then applies it). Resolves false if the URL isn't valid.
export function submitSignInLink(url: string): Promise<boolean> {
  return window.editorShell?.submitSignInLink?.(url.trim()) ?? Promise.resolve(false)
}
function doSignOut(): void {
  signOut()
  setStore({ wallet: null, profile: null, phase: 'idle', error: null, errorReason: null })
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

// ---- React binding (all mounts share the module store above) ----
export interface AuthState {
  wallet: string | null
  profile: DclProfile | null
  phase: SignInPhase
  signingIn: boolean
  error: string | null
  errorReason: SignInErrorReason | null
  signIn: () => void
  signOut: () => void
  cancel: () => void
  reopen: () => void
  dismissError: () => void
  // dev-only paste-the-link fallback (see submitSignInLink)
  isDev: boolean
  submitLink: (url: string) => Promise<boolean>
}

export function useAuth(): AuthState {
  const snap = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => store
  )
  // restore-session profile: fetch once if we have a wallet but no profile yet
  useEffect(() => {
    if (snap.wallet !== null && snap.profile === null) void loadProfile(snap.wallet)
  }, [snap.wallet, snap.profile])

  return {
    wallet: snap.wallet,
    profile: snap.profile,
    phase: snap.phase,
    signingIn: snap.phase === 'opening' || snap.phase === 'waiting',
    error: snap.error,
    errorReason: snap.errorReason,
    signIn,
    signOut: doSignOut,
    cancel: cancelSignIn,
    reopen: reopenSignInBrowser,
    dismissError,
    isDev: window.editorShell?.isDev === true,
    submitLink: submitSignInLink
  }
}
