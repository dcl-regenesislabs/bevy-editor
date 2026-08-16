import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as SignedFetchModule from './signed-fetch'

// The traps this client exists to avoid: the pathname it signs must be the one
// the service receives, a scene's identity comes from what we sent rather than
// from what came back, an empty location list is a 400 and never a request, a
// failure becomes a sentence rather than a status, and one world costs one POST
// however many times the tab is opened.

// Only the request is replaced: SIGN_IN_REQUIRED stays the real constant, so the
// "signed out" branch is exercised against the sentence signed-fetch throws.
const post = vi.fn()
vi.mock('./signed-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof SignedFetchModule>()),
  signedFetch: (url: string, init?: RequestInit) => post(url, init)
}))

let wallet: string | null = '0xowner'
vi.mock('../account/auth', () => ({ getAccount: () => wallet }))

import { analyticsError, chunk, fetchWorldMetrics, sceneKey, sceneLocations, worldMetrics } from './analytics'
import { SIGN_IN_REQUIRED } from './signed-fetch'
import type { WorldEntry, WorldScene } from './inventory'

const scene = (x: number, y: number): WorldScene => ({
  x,
  y,
  parcels: [`${x},${y}`],
  title: null,
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: null,
  size: null,
  status: 'DEPLOYED',
  authoritativeMultiplayer: false
})

const world = (name: string, scenes: WorldScene[] = [scene(0, 0)]): WorldEntry => ({
  name,
  role: 'owner',
  size: null,
  scenes,
  sceneCount: { known: true, total: scenes.length },
  settings: null,
  image: null,
  userCount: null
})

const answer = (count: number, exported = '2026-08-12T00:17:01.099Z'): Response =>
  new Response(
    JSON.stringify({
      exported_at: exported,
      // every entry lies about who it is — the caller must not believe it
      locations: Array.from({ length: count }, () => ({
        location_key: 'somewhere|else',
        world: 'liar.dcl.eth',
        x: 999,
        y: 999,
        builder_project_id: null,
        metrics: {}
      }))
    }),
    { status: 200 }
  )

const body = (): { locations: unknown[] } => JSON.parse(post.mock.calls[0][1].body)

beforeEach(() => {
  post.mockReset()
  wallet = '0xowner'
  vi.unstubAllGlobals()
  // endpoints.ts picks the stack from localStorage — this project runs in node
  vi.stubGlobal('localStorage', { getItem: () => null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sceneLocations', () => {
  it('asks about one location per scene, in the order the world lists them', () => {
    expect(sceneLocations(world('dafu.dcl.eth', [scene(0, 0), scene(9, 9), scene(-3, -2)]))).toEqual([
      { world: 'dafu.dcl.eth', x: 0, y: 0 },
      { world: 'dafu.dcl.eth', x: 9, y: 9 },
      { world: 'dafu.dcl.eth', x: -3, y: -2 }
    ])
  })

  it('has nothing to ask about for a world with no readable scene', () => {
    expect(sceneLocations(world('empty.dcl.eth', []))).toEqual([])
  })
})

describe('sceneKey', () => {
  it('keeps a plain .eth world distinct from the .dcl.eth one of the same name', () => {
    expect(sceneKey(world('silverbrainiac.eth'), scene(0, 0))).toBe('world:silverbrainiac.eth@0,0')
    expect(sceneKey(world('silverbrainiac.dcl.eth'), scene(0, 0))).toBe('world:silverbrainiac.dcl.eth@0,0')
  })

  it('is our own id, not the service key', () => {
    expect(sceneKey(world('cozyfarm.dcl.eth'), scene(0, 0))).not.toBe('cozyfarm.dcl.eth|0|0')
  })
})

describe('chunk', () => {
  it('splits one location over the limit into a full request and a remainder', () => {
    const parts = chunk(Array.from({ length: 101 }, (_, i) => i), 100)
    expect(parts.map((p) => p.length)).toEqual([100, 1])
    expect(chunk([1, 2, 3], 100).map((p) => p.length)).toEqual([3])
    expect(chunk([], 100)).toEqual([])
  })
})

describe('analyticsError', () => {
  it('says what happened and what to do, never a bare status', () => {
    expect(analyticsError(401, null)).toBe("Your sign-in wasn't recognised — sign out and back in.")
    expect(analyticsError(403, null)).toBe("Your sign-in wasn't recognised — sign out and back in.")
    expect(analyticsError(0, null)).toBe("Couldn't reach the analytics service — check your connection.")
    expect(analyticsError(429, null)).toBe(
      'Slowing down — the analytics service is rate-limiting, try again in a moment.'
    )
    expect(analyticsError(503, null)).toBe("The analytics service didn't answer (503) — try again.")
  })

  it('repeats the message the service sent for a request it refused', () => {
    expect(analyticsError(400, 'locations[0]: "Not A Name" is not a valid ENS name')).toBe(
      'locations[0]: "Not A Name" is not a valid ENS name'
    )
  })
})

describe('fetchWorldMetrics', () => {
  it('signs the /v2 pathname the service actually receives', async () => {
    post.mockImplementation(async () => answer(1))
    await fetchWorldMetrics(world('cozyfarm.dcl.eth'))
    const url = post.mock.calls[0][0] as string
    expect(url).toBe('https://creators-data.decentraland.org/v2/metrics')
    expect(new URL(url).pathname).toBe('/v2/metrics')
  })

  it('posts the locations and nothing else', async () => {
    post.mockImplementation(async () => answer(2))
    await fetchWorldMetrics(world('dafu.dcl.eth', [scene(0, 0), scene(9, 9)]))
    const init = post.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' })
    expect(body()).toEqual({
      locations: [
        { world: 'dafu.dcl.eth', x: 0, y: 0 },
        { world: 'dafu.dcl.eth', x: 9, y: 9 }
      ]
    })
  })

  it('keys by what we sent, however the response identifies itself', async () => {
    post.mockImplementation(async () => answer(2))
    const snap = await fetchWorldMetrics(world('dafu.dcl.eth', [scene(0, 0), scene(9, 9)]))
    expect(Object.keys(snap.byScene)).toEqual(['world:dafu.dcl.eth@0,0', 'world:dafu.dcl.eth@9,9'])
    expect(snap.exportedAt).toBe('2026-08-12T00:17:01.099Z')
    expect(snap.byScene['world:dafu.dcl.eth@0,0'].metrics).toEqual({})
  })

  it('refuses to pair a response of the wrong length', async () => {
    post.mockImplementation(async () => answer(1))
    await expect(fetchWorldMetrics(world('dafu.dcl.eth', [scene(0, 0), scene(9, 9)]))).rejects.toThrow(
      "answered 1 of 2 scenes, so the response can't be read."
    )
  })

  it('makes no request at all for a world with no locations', async () => {
    await expect(fetchWorldMetrics(world('empty.dcl.eth', []))).resolves.toEqual({ exportedAt: null, byScene: {} })
    expect(post).not.toHaveBeenCalled()
  })

  it('splits a world past the limit and takes the stamp from the first batch', async () => {
    post
      .mockImplementationOnce(async () => answer(100, '2026-08-12T00:17:01.099Z'))
      .mockImplementationOnce(async () => answer(1, '2026-01-01T00:00:00.000Z'))
    const scenes = Array.from({ length: 101 }, (_, i) => scene(i, 0))
    const snap = await fetchWorldMetrics(world('huge.dcl.eth', scenes))
    expect(post).toHaveBeenCalledTimes(2)
    expect(Object.keys(snap.byScene)).toHaveLength(101)
    expect(snap.exportedAt).toBe('2026-08-12T00:17:01.099Z')
  })

  it('turns a rejection into the sentence for its status', async () => {
    post.mockImplementation(async () => new Response('Not Authorized', { status: 401 }))
    await expect(fetchWorldMetrics(world('cozyfarm.dcl.eth'))).rejects.toThrow('sign out and back in.')

    post.mockImplementation(async () => new Response('', { status: 429 }))
    await expect(fetchWorldMetrics(world('cozyfarm.dcl.eth'))).rejects.toThrow('rate-limiting')

    post.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'Bad request', message: 'too many locations: 101 given' }), { status: 400 })
    )
    await expect(fetchWorldMetrics(world('cozyfarm.dcl.eth'))).rejects.toThrow('too many locations: 101 given')
  })

  it('reads an unreachable service as a connection problem, not as a status', async () => {
    post.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchWorldMetrics(world('cozyfarm.dcl.eth'))).rejects.toThrow("Couldn't reach the analytics service")
  })

  it('sends an expired identity to sign in again, not to check the connection', async () => {
    post.mockRejectedValue(new Error(SIGN_IN_REQUIRED))
    await expect(fetchWorldMetrics(world('cozyfarm.dcl.eth'))).rejects.toThrow(SIGN_IN_REQUIRED)
  })
})

describe('worldMetrics', () => {
  it('answers two concurrent openings of the same world with one request', async () => {
    post.mockImplementation(async () => answer(1))
    const w = world('flight.dcl.eth')
    const [a, b] = await Promise.all([worldMetrics(w), worldMetrics(w)])
    expect(post).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('costs nothing to re-enter, and nothing to switch scene rows', async () => {
    post.mockImplementation(async () => answer(2))
    const w = world('cached.dcl.eth', [scene(0, 0), scene(9, 9)])
    const first = await worldMetrics(w)
    expect(await worldMetrics(w)).toBe(first)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('never answers one world out of the snapshot of another', async () => {
    post.mockImplementation(async () => answer(1))
    await worldMetrics(world('one.dcl.eth'))
    await worldMetrics(world('two.dcl.eth'))
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('drops everything when the wallet changes, because the numbers are per wallet', async () => {
    post.mockImplementation(async () => answer(1))
    const w = world('shared.dcl.eth')
    await worldMetrics(w)
    await worldMetrics(w)
    expect(post).toHaveBeenCalledTimes(1)
    wallet = '0xsomebodyelse'
    await worldMetrics(w)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure, so Retry genuinely retries', async () => {
    post.mockImplementation(async () => new Response('', { status: 503 }))
    const w = world('flaky.dcl.eth')
    await expect(worldMetrics(w)).rejects.toThrow('503')
    post.mockImplementation(async () => answer(1))
    await expect(worldMetrics(w)).resolves.toMatchObject({ exportedAt: '2026-08-12T00:17:01.099Z' })
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('re-reads once the local date has changed — the only moment a new export can exist', async () => {
    post.mockImplementation(async () => answer(1))
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 14, 23, 50))
    const w = world('overnight.dcl.eth')
    await worldMetrics(w)
    await worldMetrics(w)
    expect(post).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date(2026, 7, 15, 0, 10))
    await worldMetrics(w)
    expect(post).toHaveBeenCalledTimes(2)
  })
})
