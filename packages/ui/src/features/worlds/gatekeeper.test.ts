import { describe, it, expect, beforeEach, vi } from 'vitest'

// A scope is the address of ONE scene. Every streaming key, admin list and ban
// list in this feature is written against it, and a world holds several scenes —
// so a scope built from the wrong ground manages a neighbour's scene while
// wearing this one's name. These tests pin the two ways that can happen: an
// invented parcel, and a base that sits outside the scene's own footprint.

// signed-fetch reads the stored identity at import time; nothing here signs anything
const signed = vi.fn()
vi.mock('./signed-fetch', () => ({ signedFetch: (...args: unknown[]) => signed(...args) }))

import { isSceneNotIndexed, listSceneAdmins, listSceneBans, sceneScopeOf } from './gatekeeper'
import type { WorldScene } from './inventory'

const scene = (over: Partial<WorldScene> = {}): WorldScene => ({
  x: 10,
  y: 10,
  parcels: ['10,10'],
  title: 'Arena',
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: 'bafyArena',
  size: null,
  status: 'DEPLOYED',
  authoritativeMultiplayer: false,
  ...over
})

beforeEach(() => {
  vi.unstubAllGlobals()
  // endpoints.ts picks the stack from localStorage — this project runs in node
  vi.stubGlobal('localStorage', { getItem: () => null })
})

describe('sceneScopeOf', () => {
  it('addresses the scene by its own entity, in the lowercased world', () => {
    expect(sceneScopeOf('Boedo.DCL.eth', scene())).toEqual({
      sceneId: 'bafyArena',
      realmName: 'boedo.dcl.eth',
      parcel: '10,10'
    })
  })

  // The server does not require a scene's base to be a member of its footprint,
  // so the base is not proof of where the scene stands — a parcel of the
  // footprint is.
  it('takes a parcel the scene stands on when its base sits outside its footprint', () => {
    expect(sceneScopeOf('boedo.dcl.eth', scene({ x: 0, y: 0, parcels: ['24,-8', '25,-8' ] }))?.parcel).toBe('24,-8')
  })

  it('forgives whitespace in a parcel, because the signed request must carry one spelling', () => {
    expect(sceneScopeOf('boedo.dcl.eth', scene({ parcels: [' 24, -8 '] }))?.parcel).toBe('24,-8')
  })

  it('falls back to the located base, and never to a parcel nobody published', () => {
    expect(sceneScopeOf('boedo.dcl.eth', scene({ x: 24, y: -8, parcels: [] }))?.parcel).toBe('24,-8')
    expect(sceneScopeOf('boedo.dcl.eth', scene({ x: 24, y: -8, parcels: ['nowhere'] }))?.parcel).toBe('24,-8')
  })

  // 0,0 is real ground somebody publishes on. A scope that invents it does not
  // fail — it succeeds against the wrong scene, silently.
  it('never invents 0,0 for a scene that does not stand there', () => {
    const nowhere = scene({ x: 24, y: -8, parcels: ['nowhere'], title: null })
    expect(sceneScopeOf('boedo.dcl.eth', nowhere)?.parcel).not.toBe('0,0')
  })

  it('is null for a scene with no entity id, so the caller can say why', () => {
    expect(sceneScopeOf('boedo.dcl.eth', scene({ entityId: null }))).toBeNull()
  })
})

// A scene published minutes ago is not in the Places index yet, and the
// gatekeeper resolves scenes through it. Both list calls answer 404 then, and
// neither has a "no row yet" reading that would make 404 mean an empty list —
// so the class has to survive the call for a panel to say "not indexed yet"
// instead of printing the status code at a creator who owns the world.
describe('a 404 from a list call is the Places index', () => {
  const scope = { sceneId: 'bafyArena', realmName: 'boedo.dcl.eth', parcel: '10,10' }

  beforeEach(() => {
    signed.mockResolvedValue(new Response(null, { status: 404 }))
  })

  it('marks the admin list', async () => {
    await expect(listSceneAdmins(scope)).rejects.toSatisfy(isSceneNotIndexed)
  })

  it('marks the ban list', async () => {
    await expect(listSceneBans(scope)).rejects.toSatisfy(isSceneNotIndexed)
  })
})
