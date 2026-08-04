// Signed fetch (ADR-44): authenticated calls carry x-identity-* headers signed
// with the AuthIdentity from the account feature's auth.ts — signing stays in
// the renderer, like everything identity-related.
// payload = method:path:timestamp:metadata, lowercased, signed with the identity;
// each auth-chain link travels as an x-identity-auth-chain-<i> header. The
// storage API's CORS allowlist rejects localhost origins, so those requests
// relay through main (storageFetch) — signed here either way.
import { Authenticator } from '@dcl/crypto'
import { getIdentity } from '../account/auth'
import { signedFetchPayload } from '../../lib/adr44'

export async function signedFetch(url: string, init?: RequestInit, metadata: Record<string, unknown> = {}): Promise<Response> {
  const identity = getIdentity()
  if (identity === null) throw new Error('Sign in to do this')
  const u = new URL(url)
  const timestamp = String(Date.now())
  const meta = JSON.stringify(metadata)
  const payload = signedFetchPayload(init?.method ?? 'GET', u.pathname, timestamp, meta)
  const chain = Authenticator.signPayload(identity, payload)
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
  chain.forEach((link, i) => {
    headers[`x-identity-auth-chain-${i}`] = JSON.stringify(link)
  })
  headers['x-identity-timestamp'] = timestamp
  headers['x-identity-metadata'] = meta
  const relay = window.editorShell?.storageFetch
  if (u.hostname.startsWith('storage.decentraland.') && relay !== undefined) {
    const body = typeof init?.body === 'string' ? init.body : undefined
    const r = await relay(url, { method: init?.method ?? 'GET', headers, body })
    // null-body statuses (204/205/304) reject any body, even ''
    return new Response(r.body === '' || [204, 205, 304].includes(r.status) ? null : r.body, { status: r.status })
  }
  return fetch(url, { ...init, headers })
}
