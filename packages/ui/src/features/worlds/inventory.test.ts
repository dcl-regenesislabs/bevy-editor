import { describe, it, expect, vi, beforeEach } from 'vitest'

// fetchWorldScenes widened /world/{name}/scenes from "the first scene" to "every
// scene", and the first-scene half is now gone: nothing reads a single
// representative row any more, because the server orders the list created_at
// ASC and that row is the world's OLDEST scene.
//
// The scene list has to be honest about three things the old parse
// got wrong: a scene whose base won't parse still stands on its parcels, an
// UNDEPLOYED row is a tombstone rather than a scene, and a world with more
// scenes than one page holds is not a world with one page of scenes. When any
// page can't be read the count comes back `{ known: false }` — "I couldn't
// check" must never reach the UI as "nothing was there".

vi.mock('./signed-fetch', () => ({ signedFetch: vi.fn() }))

import { fetchWorldPermissions, fetchWorldScenes, sceneCoordinate, scopeKey, type WorldScene } from './inventory'

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

// The answer is a list and a count, and nothing that stands in for the world.
// A single representative row is the shape this feature had to lose: whatever
// the field was called, it was `scenes[0]`, and `scenes[0]` is the world's
// oldest scene under a heading that said "world".
describe('fetchWorldScenes — the shape of the answer', () => {
  it('answers with the scenes and the count, and nothing else', async () => {
    respond([arena, lobby, garden])
    const got = await fetchWorldScenes('Boedo.dcl.eth')
    expect(Object.keys(got).sort()).toEqual(['sceneCount', 'scenes'])
  })

  it('reads an empty world as empty, whether the body says so or says nothing', async () => {
    respond([])
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({
      scenes: [],
      sceneCount: { known: true, total: 0 }
    })
    respond(undefined)
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({
      scenes: [],
      sceneCount: { known: true, total: 0 }
    })
  })

  it('leaves out a row with no entity at all, and still counts it', async () => {
    respond([{ entityId: 'bafyGhost' }, lobby])
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes.map((s) => s.entityId)).toEqual(['bafyLobby'])
    expect(sceneCount).toEqual({ known: true, total: 2 })
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
        status: 'DEPLOYED',
        authoritativeMultiplayer: true
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
        status: 'DEPLOYED',
        authoritativeMultiplayer: false
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
        status: 'DEPLOYED',
        authoritativeMultiplayer: false
      }
    ])
  })

  // Storage and Logs are gated on this flag per scene. Reading it off the
  // world's first scene answered for every other one: a world whose oldest
  // scene runs a Multiplayer Server offered server logs for a scene that has
  // none, and hid them for a scene that does.
  it("reads each scene's own Multiplayer Server flag, and defaults it to false", async () => {
    const off = {
      entityId: 'bafyOff',
      entity: { metadata: { scene: { base: '8,8', parcels: ['8,8'] }, authoritativeMultiplayer: false } }
    }
    respond([arena, off, lobby])
    const { scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes.map((s) => s.authoritativeMultiplayer)).toEqual([true, false, false])
  })

  it('takes the footprint from the server index when it disagrees with the metadata', async () => {
    respond([{ ...arena, parcels: ['1,0', '2,0'] }])
    const { scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes[0].parcels).toEqual(['1,0', '2,0'])
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
    const { scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes.map((s) => s.entityId)).toEqual(['bafyArena', 'bafyLobby'])
    expect(scenes[0]).toMatchObject({ x: 9, y: 10, parcels: ['9,10', '9,9'] })
  })

  it('drops a scene that has no readable coordinate at all, but still counts it', async () => {
    respond([{ entityId: 'bafyNowhere', entity: { timestamp: 1, metadata: { display: { title: 'Nowhere' } } } }])
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([])
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
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({ scenes: [], sceneCount: { known: false } })
  })

  it('reports an unknown count when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([])
    expect(sceneCount).toEqual({ known: false })
  })

  it('keeps the scenes it did read when a later page fails, and admits the count is unknown', async () => {
    respondPages([{ scenes: filler(100), total: 150 }, { status: 503 }])
    const { scenes, sceneCount } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toHaveLength(100)
    expect(scenes[0].entityId).toBe('bafyFill0')
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
    authoritativeMultiplayer: false,
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

// A world is gated one of four ways, and only one of them is a list anyone can
// add a wallet to. Flattened to {type, wallets} they all looked alike, so an
// NFT-gated world got an add-wallet row that could never take effect.
describe('permission gates — which four the server serves', () => {
  function respondPermission(access: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ owner: '0xOWNER', permissions: { access } })))
    )
  }

  it("tells the four apart, and carries an allow-list's wallets and communities", async () => {
    respondPermission({ type: 'unrestricted' })
    expect((await fetchWorldPermissions('boedo.dcl.eth'))?.access).toEqual({
      type: 'unrestricted',
      raw: 'unrestricted',
      wallets: [],
      communities: []
    })

    respondPermission({ type: 'shared-secret', secret: 'hashed' })
    expect((await fetchWorldPermissions('boedo.dcl.eth'))?.access.type).toBe('shared-secret')

    respondPermission({ type: 'nft-ownership', nft: 'urn:decentraland:collection' })
    expect((await fetchWorldPermissions('boedo.dcl.eth'))?.access.type).toBe('nft-ownership')

    respondPermission({ type: 'allow-list', wallets: ['0xAAA'], communities: ['c-1', 'c-2'] })
    expect((await fetchWorldPermissions('boedo.dcl.eth'))?.access).toEqual({
      type: 'allow-list',
      raw: 'allow-list',
      wallets: ['0xaaa'],
      communities: ['c-1', 'c-2']
    })
  })

  it("calls a gate it does not recognise unknown, and keeps the server's word for it", async () => {
    respondPermission({ type: 'token-gated' })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.access.type).toBe('unknown')
    expect(p?.access.raw).toBe('token-gated')
  })

  it('reads a permission the server stores no row for as the open gate', async () => {
    respondPermission(undefined)
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.access).toEqual({ type: 'unrestricted', raw: 'unrestricted', wallets: [], communities: [] })
    expect(p?.streaming.type).toBe('unrestricted')
  })

  it('keeps a list it cannot read empty rather than half-reading it', async () => {
    respondPermission({ type: 'allow-list', wallets: '0xAAA', communities: [{ id: 'c-1' }] })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.access).toMatchObject({ type: 'allow-list', wallets: [], communities: [] })
  })
})

describe('grant scope — how wide a permission really is', () => {
  function respondPermissions(summary: unknown): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            owner: '0xOWNER',
            permissions: { deployment: { type: 'allow-list', wallets: ['0xAAA'] } },
            summary
          })
        )
      )
    )
  }

  it('reads a narrowed grant from the summary', async () => {
    respondPermissions({ '0xAAA': { world_wide: false, parcel_count: 3 } })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.get(scopeKey('deployment', '0xAAA'))).toEqual({ worldWide: false, parcelCount: 3, parcels: [] })
  })

  // The flat shape names no permission, and a narrowing can only belong to a
  // publish or a stream grant — there is no per-parcel entry rule. Attributing
  // it to `access` too would draw a map of where a wallet may enter.
  it('reads an unattributed narrowing as publish and stream, never as entry', async () => {
    respondPermissions({ '0xAAA': { world_wide: false, parcel_count: 3 } })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.get(scopeKey('streaming', '0xAAA'))?.worldWide).toBe(false)
    expect(p?.scopes.get(scopeKey('access', '0xAAA'))).toBeUndefined()
  })

  it('reads it when the server nests it under the permission name', async () => {
    respondPermissions({ deployment: { '0xAAA': { world_wide: false, parcel_count: 3 } } })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.get(scopeKey('deployment', '0xAAA'))?.worldWide).toBe(false)
  })

  // Two grants to the same wallet, narrowed differently. Keyed by address alone
  // the second overwrites the first and the survivor is stated of both.
  it('keeps each kind\'s narrowing apart when the server names them', async () => {
    respondPermissions({
      deployment: { '0xAAA': { world_wide: false, parcel_count: 2, parcels: ['1,1', '1,2'] } },
      streaming: { '0xAAA': { world_wide: true } }
    })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.get(scopeKey('deployment', '0xAAA'))).toEqual({
      worldWide: false,
      parcelCount: 2,
      parcels: ['1,1', '1,2']
    })
    expect(p?.scopes.get(scopeKey('streaming', '0xAAA'))?.worldWide).toBe(true)
  })

  it('keeps a narrowed grant narrowed when the count is missing', async () => {
    respondPermissions({ '0xAAA': { world_wide: false } })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.get(scopeKey('deployment', '0xAAA'))).toEqual({
      worldWide: false,
      parcelCount: null,
      parcels: []
    })
  })

  it('reads the parcels a narrowed grant covers, dropping anything unreadable', async () => {
    respondPermissions({ '0xAAA': { world_wide: false, parcels: ['1, 2', '3,4', 'nope', 7] } })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.get(scopeKey('deployment', '0xAAA'))).toEqual({
      worldWide: false,
      parcelCount: 2,
      parcels: ['1,2', '3,4']
    })
  })

  it('says nothing at all when the shape is not the one documented', async () => {
    respondPermissions({ '0xAAA': { scope: 'parcels', parcels: ['0,0'] } })
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.size).toBe(0)
  })

  it('says nothing for a world with no grantees', async () => {
    respondPermissions({})
    const p = await fetchWorldPermissions('boedo.dcl.eth')
    expect(p?.scopes.size).toBe(0)
  })
})
