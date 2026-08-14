import { describe, it, expect, vi, beforeEach } from 'vitest'

// fetchWorldScenes widened /world/{name}/scenes from "the first scene" to "every
// scene", and `deployment` is the half that must not have moved: WorldDetail's
// header sentence, the five Overview facts, WorldCover's thumbnail order,
// sceneScopeOf, StorageTab/LogsTab's `d` prop and WorldsSection's cards all read
// it. These tests pin its shape field by field, and pin that a scene the
// coordinate parse rejects leaves it untouched.

vi.mock('./signed-fetch', () => ({ signedFetch: vi.fn() }))

import { fetchWorldScenes } from './inventory'

const CONTENTS = 'https://worlds-content-server.decentraland.org/contents'

interface RawScene {
  deployer?: string
  entityId?: string
  size?: string
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

function respond(scenes: RawScene[] | undefined, status = 200): void {
  const body = scenes === undefined ? {} : { scenes }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
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

  it('is null when nothing is published, when the body has no scenes and when the request fails', async () => {
    respond([])
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({ deployment: null, scenes: [] })
    respond(undefined)
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({ deployment: null, scenes: [] })
    respond([arena], 404)
    await expect(fetchWorldScenes('boedo.dcl.eth')).resolves.toEqual({ deployment: null, scenes: [] })
  })

  it('is null when the first scene carries no entity', async () => {
    respond([{ entityId: 'bafyGhost' }])
    const { deployment } = await fetchWorldScenes('boedo.dcl.eth')
    expect(deployment).toBeNull()
  })
})

describe('fetchWorldScenes — scenes', () => {
  it('keeps every scene, in response order', async () => {
    respond([arena, lobby, garden])
    const { scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([
      { x: 9, y: 9, title: 'Arena', timestamp: 1754870400000, thumbnail: `${CONTENTS}/QmCover`, entityId: 'bafyArena' },
      { x: -3, y: -2, title: 'Lobby', timestamp: 1751000000000, thumbnail: null, entityId: 'bafyLobby' },
      { x: 0, y: 0, title: null, timestamp: 1752000000000, thumbnail: null, entityId: 'bafyGarden' }
    ])
  })

  it('drops a scene whose base is unreadable without disturbing the deployment', async () => {
    const spaced = { ...arena, entity: { ...(arena.entity as object), metadata: { scene: { parcels: ['9,9'], base: '9, 9' } } } }
    respond([spaced, lobby])
    const { deployment, scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes.map((s) => s.entityId)).toEqual(['bafyLobby'])
    expect(deployment?.base).toBe('9, 9')
    expect(deployment?.entityId).toBe('bafyArena')
  })

  it('is empty when every base is unreadable, even though the world is published', async () => {
    respond([{ entityId: 'bafyNowhere', entity: { timestamp: 1, metadata: { display: { title: 'Nowhere' } } } }])
    const { deployment, scenes } = await fetchWorldScenes('boedo.dcl.eth')
    expect(scenes).toEqual([])
    expect(deployment?.title).toBe('Nowhere')
  })

  it('asks the server for the lowercased world name', async () => {
    respond([arena])
    await fetchWorldScenes('Boedo.DCL.eth')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      'https://worlds-content-server.decentraland.org/world/boedo.dcl.eth/scenes'
    )
  })
})
