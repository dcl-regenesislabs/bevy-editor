import { describe, it, expect, vi, beforeEach } from 'vitest'

// fetchWorldScenes widened /world/{name}/scenes from "the first scene" to "every
// scene", and `deployment` is the half that must not have moved: WorldDetail's
// header sentence, the five Overview facts, WorldCover's thumbnail order,
// sceneScopeOf, StorageTab/LogsTab's `d` prop and WorldsSection's cards all read
// it. These tests pin its shape field by field.
//
// The scene list itself now has to be honest about three things the old parse
// got wrong: a scene whose base won't parse still stands on its parcels, an
// UNDEPLOYED row is a tombstone rather than a scene, and a world with more
// scenes than one page holds is not a world with one page of scenes. When any
// page can't be read the count comes back `{ known: false }` — "I couldn't
// check" must never reach the UI as "nothing was there".

vi.mock('./signed-fetch', () => ({ signedFetch: vi.fn() }))

import { fetchWorldScenes, sceneCoordinate, type WorldScene } from './inventory'

const CONTENTS = 'https://worlds-content-server.decentraland.org/contents'
const SCENES = 'https://worlds-content-server.decentraland.org/world/boedo.dcl.eth/scenes'

interface RawScene {
  deployer?: string
  entityId?: string
  size?: string
  status?: string
  parcels?: string[]
  entity?: unknown
}

const arena: RawScene = {
  deployer: '0xABCDEF',
  entityId: 'bafyArena',
  size: '4096',
  entity: {
    timestamp: 1754870400000,
    content: [{ file: 'assets/cover.png', hash: 'QmCover' }],
    metadata: {
      display: { title: 'Arena', navmapThumbnail: 'assets/cover.png' },
      scene: { parcels: ['9,9', '9,10'], base: '9,9' },
      authoritativeMultiplayer: true
    }
  }
}

const lobby: RawScene = {
  deployer: '0x111',
  entityId: 'bafyLobby',
  entity: {
    timestamp: 1751000000000,
    metadata: { display: { title: 'Lobby' }, scene: { parcels: ['-3,-2'], base: '-3,-2' } }
  }
}

const garden: RawScene = {
  entityId: 'bafyGarden',
  entity: { timestamp: 1752000000000, metadata: { scene: { parcels: ['0,0'], base: '0,0' } } }
}

// one page's worth of throwaway scenes, so pagination has something to page over
function filler(n: number, offset = 0): RawScene[] {
  return Array.from({ length: n }, (_, i) => ({
    entityId: `bafyFill${offset + i}`,
    entity: { timestamp: 1, metadata: { scene: { parcels: [`${offset + i},50`], base: `${offset + i},50` } } }
  }))
}

// each entry is one page of the paginated endpoint, answered in request order
type Page = { scenes?: RawScene[]; total?: number; status?: number }

function respondPages(pages: Page[]): void {
  let call = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const p = pages[Math.min(call++, pages.length - 1)]
      const body: Record<string, unknown> = {}
      if (p.scenes !== undefined) body.scenes = p.scenes
      if (p.total !== undefined) body.total = p.total
      return new Response(JSON.stringify(body), { status: p.status ?? 200 })
    })
  )
}

function respond(scenes: RawScene[] | undefined, status = 200): void {
  respondPages([{ scenes, total: scenes?.length, status }])
}

beforeEach(() => {
  vi.unstubAllGlobals()
  // endpoints.ts picks the stack from localStorage — this project runs in node
  vi.stubGlobal('localStorage', { getItem: () => null })
})

describe('fetchWorldScenes — deployment', () => {
  it('maps the first scene exactly as the single-scene parse always did', async () => {
    respond([arena, lobby, garden])
    const { deployment } = await fetchWorldScenes('Boedo.dcl.eth')
    expect(deployment).toEqual({
      title: 'Arena',
      deployer: '0xabcdef',
      timestamp: 1754870400000,
      entityId: 'bafyArena',
      thumbnail: `${CONTENTS}/QmCover`,
      parcels: 2,
      size: 4096,
      base: '9,9',
      authoritativeMultiplayer: true
    })
  })

  it('keeps every fallback the six consumers rely on', async () => {
    respond([{ entity: {} }])
    const { deployment } = await fetchWorldScenes('boedo.dcl.eth')
    expect(deployment).toEqual({
      title: 'Untitled scene',
      deployer: null,
      timestamp: null,
      entityId: null,
      thumbnail: null,
      parcels: 0,
      size: null,
      base: null,
      authoritativeMultiplayer: false
    })
  })

  it('is null when nothing is published and when the body has no scenes', async () => {
    respond([])
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({
      deployment: null,
      scenes: [],
      sceneCount: { known: true, total: 0 }
    })
    respond(undefined)
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toMatchObject({ deployment: null, scenes: [] })
  })

  it('is null when the first scene carries no entity', async () => {
    respond([{ entityId: 'bafyGhost' }])
    const { deployment } = await fetchWorldScenes('boedo.dcl.eth')
    expect(deployment).toBeNull()
  })

  it('skips an undeployed row rather than reporting it as what is live', async () => {
    respond([{ ...arena, status: 'UNDEPLOYED' }, lobby])
    const { deployment } = await fetchWorldScenes('boedo.dcl.eth')
    expect(deployment?.entityId).toBe('bafyLobby')
  })
})

describe('fetchWorldScenes — scenes', () => {
  it('keeps every scene, in response order, with its parcels, deployer and size', async () => {
    respond([arena, lobby, garden])
    const { scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([
      {
        x: 9,
        y: 9,
        parcels: ['9,9', '9,10'],
        title: 'Arena',
        deployer: '0xabcdef',
        timestamp: 1754870400000,
        thumbnail: `${CONTENTS}/QmCover`,
        entityId: 'bafyArena',
        size: 4096,
        status: 'DEPLOYED'
      },
      {
        x: -3,
        y: -2,
        parcels: ['-3,-2'],
        title: 'Lobby',
        deployer: '0x111',
        timestamp: 1751000000000,
        thumbnail: null,
        entityId: 'bafyLobby',
        size: null,
        status: 'DEPLOYED'
      },
      {
        x: 0,
        y: 0,
        parcels: ['0,0'],
        title: null,
        deployer: null,
        timestamp: 1752000000000,
        thumbnail: null,
        entityId: 'bafyGarden',
        size: null,
        status: 'DEPLOYED'
      }
    ])
  })

  it('takes the footprint from the server index when it disagrees with the metadata', async () => {
    respond([{ ...arena, parcels: ['1,0', '2,0'] }])
    const { scenes, deployment } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes[0].parcels).toEqual(['1,0', '2,0'])
    expect(deployment?.parcels).toBe(2)
  })

  it('coerces the size the server serializes as a string, and keeps null when it sends none', async () => {
    respond([{ ...arena, size: '1073741824' }, lobby])
    const { scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes[0].size).toBe(1073741824)
    expect(scenes[1].size).toBeNull()
  })

  it('locates a scene by its first parcel when the base will not parse', async () => {
    const spaced = { ...arena, entity: { ...(arena.entity as object), metadata: { scene: { parcels: ['9,10', '9,9'], base: '9, 9' } } } }
    respond([spaced, lobby])
    const { deployment, scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes.map((s) => s.entityId)).toEqual(['bafyArena', 'bafyLobby'])
    expect(scenes[0]).toMatchObject({ x: 9, y: 10, parcels: ['9,10', '9,9'] })
    expect(deployment?.base).toBe('9, 9')
    expect(deployment?.entityId).toBe('bafyArena')
  })

  it('drops a scene that has no readable coordinate at all, but still counts it', async () => {
    respond([{ entityId: 'bafyNowhere', entity: { timestamp: 1, metadata: { display: { title: 'Nowhere' } } } }])
    const { deployment, scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([])
    expect(deployment?.title).toBe('Nowhere')
    expect(sceneCount).toEqual({ known: true, total: 1 })
  })

  it('leaves undeployed rows out of the list and out of the count', async () => {
    respond([arena, { ...lobby, status: 'UNDEPLOYED' }, garden])
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes.map((s) => s.entityId)).toEqual(['bafyArena', 'bafyGarden'])
    expect(sceneCount).toEqual({ known: true, total: 2 })
  })

  it('asks the server for the lowercased world name, one page at a time', async () => {
    respond([arena])
    await fetchWorldScenes('Boedo.DCL.eth')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${SCENES}?limit=100&offset=0`)
  })
})

describe('fetchWorldScenes — pagination', () => {
  it('reads past the first page when the world holds more scenes than the limit', async () => {
    respondPages([
      { scenes: filler(100), total: 102 },
      { scenes: [arena, lobby], total: 102 }
    ])
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual([
      `${SCENES}?limit=100&offset=0`,
      `${SCENES}?limit=100&offset=100`
    ])
    expect(scenes).toHaveLength(102)
    expect(scenes[101].entityId).toBe('bafyLobby')
    expect(sceneCount).toEqual({ known: true, total: 102 })
  })

  it('stops on a full page with no total once the next page comes back empty', async () => {
    respondPages([{ scenes: filler(100) }, { scenes: [] }])
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toHaveLength(100)
    expect(sceneCount).toEqual({ known: true, total: 100 })
  })

  it('reports an unknown count — never an empty world — when the first page fails', async () => {
    respond([arena], 404)
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({
      deployment: null,
      scenes: [],
      sceneCount: { known: false }
    })
  })

  it('reports an unknown count when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([])
    expect(sceneCount).toEqual({ known: false })
  })

  it('keeps the scenes it did read when a later page fails, and admits the count is unknown', async () => {
    respondPages([{ scenes: filler(100), total: 150 }, { status: 503 }])
    const { deployment, scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toHaveLength(100)
    expect(deployment?.entityId).toBe('bafyFill0')
    expect(sceneCount).toEqual({ known: false })
  })

  it('gives up rather than looping forever on a server that keeps sending full pages', async () => {
    respondPages([{ scenes: filler(100), total: 100000 }])
    const { sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(20)
    expect(sceneCount).toEqual({ known: false })
  })
})

// Removal is addressed by a coordinate, and the wrong coordinate removes the
// wrong scene: the server resolves whichever scene occupies it, and it does not
// require a scene's base to be a member of its own footprint.
describe('sceneCoordinate', () => {
  const scene = (over: Partial<WorldScene> = {}): WorldScene => ({
    x: 0,
    y: 0,
    parcels: ['0,0'],
    title: 'Museum',
    deployer: null,
    timestamp: null,
    thumbnail: null,
    entityId: 'bafyMuseum',
    size: null,
    status: 'DEPLOYED',
    ...over
  })

  it('addresses the scene by a parcel it actually stands on, not by its base', () => {
    // base 0,0 is outside this footprint — 0,0 is another scene's ground
    expect(sceneCoordinate(scene({ x: 0, y: 0, parcels: ['10,10', '11,10'] }))).toBe('10,10')
  })

  it('canonicalises, because a spaced parcel is rejected before the request is sent', () => {
    expect(sceneCoordinate(scene({ parcels: [' 10, 10 '] }))).toBe('10,10')
  })

  it('skips a parcel it cannot read and takes the next one', () => {
    expect(sceneCoordinate(scene({ parcels: ['nowhere', '10,10'] }))).toBe('10,10')
  })

  it('falls back to the located base when the footprint is empty or unreadable', () => {
    expect(sceneCoordinate(scene({ x: 4, y: 5, parcels: [] }))).toBe('4,5')
    expect(sceneCoordinate(scene({ x: 4, y: 5, parcels: ['nowhere'] }))).toBe('4,5')
  })
})
