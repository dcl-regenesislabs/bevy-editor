import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as SignedFetchModule from './signed-fetch'

// Two things are pinned here above all: the request is scene-scoped — it never
// addresses /entities/, the whole-world undeploy — and no failure escapes as a
// throw, because the caller reports it inline next to a scene that is still on
// screen. The rest is the status map, which decides what the creator is told to
// do next.

// Only the request is replaced; SIGN_IN_REQUIRED stays the real constant so the
// signed-out branch is exercised against the sentence signed-fetch throws.
const send = vi.fn()
vi.mock('./signed-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof SignedFetchModule>()),
  signedFetch: (url: string, init?: RequestInit) => send(url, init)
}))
// auth.ts reads localStorage while it loads, which node has not got yet at
// import time; signed-fetch only ever asks it for the identity.
vi.mock('../account/auth', () => ({ getIdentity: () => null }))

import { undeployScene } from './undeploy'
import { SIGN_IN_REQUIRED } from './signed-fetch'

const SERVER = 'https://worlds-content-server.decentraland.org'

function answers(status: number): void {
  send.mockResolvedValue(new Response(status === 204 ? null : '', { status }))
}

beforeEach(() => {
  send.mockReset()
  vi.unstubAllGlobals()
  // endpoints.ts picks the stack from localStorage — this project runs in node
  vi.stubGlobal('localStorage', { getItem: () => null })
})

describe('undeployScene — the request', () => {
  it('deletes one scene, addressed by its coordinate', async () => {
    answers(200)
    await undeployScene('Boedo.DCL.eth', '9,-9')
    const [url, init] = send.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${SERVER}/world/boedo.dcl.eth/scenes/${encodeURIComponent('9,-9')}`)
    expect(init.method).toBe('DELETE')
  })

  it('never addresses the whole-world undeploy', async () => {
    answers(200)
    await undeployScene('boedo.dcl.eth', '0,0')
    const [url] = send.mock.calls[0] as [string]
    expect(url).toContain('/world/boedo.dcl.eth/scenes/')
    expect(url).not.toContain('/entities')
  })

  it('sends nothing at all when the coordinate is unreadable', async () => {
    const r = await undeployScene('boedo.dcl.eth', '9, 9')
    expect(r).toMatchObject({ ok: false, reason: 'bad-coordinate' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('undeployScene — the answer', () => {
  it('is ok on any success status the server uses', async () => {
    for (const status of [200, 204]) {
      answers(status)
      await expect(undeployScene('boedo.dcl.eth', '0,0')).resolves.toEqual({ ok: true })
    }
  })

  it('separates a permission refusal from a scene that is already gone', async () => {
    answers(403)
    await expect(undeployScene('boedo.dcl.eth', '0,0')).resolves.toMatchObject({ reason: 'not-allowed' })
    answers(401)
    await expect(undeployScene('boedo.dcl.eth', '0,0')).resolves.toMatchObject({ reason: 'not-allowed' })
    answers(404)
    await expect(undeployScene('boedo.dcl.eth', '0,0')).resolves.toMatchObject({ reason: 'gone' })
  })

  it('reports any other status as the server refusing, with the number', async () => {
    answers(500)
    const r = await undeployScene('boedo.dcl.eth', '0,0')
    expect(r).toMatchObject({ ok: false, reason: 'server' })
    expect(r.ok ? '' : r.message).toContain('500')
  })

  it('tells a signed-out wallet to sign in, not to check its connection', async () => {
    send.mockRejectedValue(new Error(SIGN_IN_REQUIRED))
    await expect(undeployScene('boedo.dcl.eth', '0,0')).resolves.toEqual({
      ok: false,
      reason: 'signed-out',
      message: SIGN_IN_REQUIRED
    })
  })

  it('turns a transport failure into a result rather than a throw', async () => {
    send.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(undeployScene('boedo.dcl.eth', '0,0')).resolves.toMatchObject({ reason: 'unreachable' })
  })
})
