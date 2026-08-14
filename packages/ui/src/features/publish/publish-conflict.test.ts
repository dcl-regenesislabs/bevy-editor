import { describe, it, expect, vi, beforeEach } from 'vitest'

// The rules this module has to get right, in the order they cost the most:
// republishing your own scene is not a conflict (and it is recognised by the
// entity we published, not by wallet-and-parcels — every project starts on 0,0,
// so a second project of yours would look exactly like the first coming back),
// anything else on your parcels always is, a row whose status the server didn't
// state is treated as live rather than dropped, the lease notices anything that
// moved while the dialog was open, and the proposed move lands on free ground
// with its shape intact and inside the world.

import {
  conflictsFor,
  fetchScenesAt,
  footprintOf,
  leaseChanged,
  leaseOf,
  nearestFreeFootprint
} from './publish-conflict'
import type { OccupyingScene } from './publish-conflict'

const SERVER = 'https://worlds-content-server.decentraland.org'

interface RawScene {
  entityId?: string
  deployer?: string
  status?: string
  parcels?: string[]
  entity?: unknown
}

const raw = (over: Partial<RawScene> = {}, parcels: string[] = ['9,9'], title = 'Arena'): RawScene => ({
  entityId: 'bafyArena',
  deployer: '0xABCDEF',
  status: 'DEPLOYED',
  entity: { timestamp: 1754870400000, metadata: { display: { title }, scene: { parcels, base: parcels[0] } } },
  ...over
})

const occupant = (over: Partial<OccupyingScene> = {}): OccupyingScene => ({
  entityId: 'bafyArena',
  deployer: '0xabcdef',
  title: 'Arena',
  base: '9,9',
  parcels: ['9,9', '9,10'],
  timestamp: 1754870400000,
  ...over
})

function respond(scenes: RawScene[] | undefined, status = 200): void {
  const body = scenes === undefined ? {} : { scenes }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchScenesAt', () => {
  it('asks the world for exactly the parcels we are about to occupy', async () => {
    respond([])
    await fetchScenesAt(SERVER, 'Boedo.DCL.eth', ['9,10', '9, 9', '9,9'])
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${SERVER}/world/boedo.dcl.eth/scenes`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ coordinates: ['9,10', '9,9'] })
  })

  it('asks about the readable parcels rather than letting one stray entry 400 the whole check', async () => {
    respond([])
    await fetchScenesAt(SERVER, 'boedo.dcl.eth', ['9,9', 'not-a-parcel', '9,10'])
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ coordinates: ['9,10', '9,9'] })
  })

  it('reports unreadable when no parcel is in a shape the world can be asked about', async () => {
    respond([])
    await expect(fetchScenesAt(SERVER, 'boedo.dcl.eth', ['not-a-parcel'])).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps a row to what the dialog has to say about it', async () => {
    respond([raw({}, ['9,9', '9,10'])])
    await expect(fetchScenesAt(SERVER, 'boedo.dcl.eth', ['9,9'])).resolves.toEqual([
      {
        entityId: 'bafyArena',
        deployer: '0xabcdef',
        title: 'Arena',
        base: '9,9',
        parcels: ['9,10', '9,9'],
        timestamp: 1754870400000
      }
    ])
  })

  it('takes the footprint from the server index, not from the deployer’s metadata', async () => {
    respond([raw({ parcels: ['1,0', '2,0'] }, ['9,9'])])
    const rows = await fetchScenesAt(SERVER, 'boedo.dcl.eth', ['1,0'])
    expect(rows[0].parcels).toEqual(['1,0', '2,0'])
  })

  it('drops undeployed rows and keeps a row that states no status at all', async () => {
    respond([
      raw({ entityId: 'bafyGone', status: 'UNDEPLOYED' }),
      raw({ entityId: 'bafyQuiet', status: undefined }),
      raw({ entityId: 'bafyLive' })
    ])
    const rows = await fetchScenesAt(SERVER, 'boedo.dcl.eth', ['9,9'])
    expect(rows.map((r) => r.entityId)).toEqual(['bafyQuiet', 'bafyLive'])
  })

  it('never asks when there is nothing to ask about', async () => {
    respond([])
    await expect(fetchScenesAt(SERVER, 'boedo.dcl.eth', [])).resolves.toEqual([])
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('throws when the world could not be read — "no scenes" must not be a guess', async () => {
    respond([raw()], 503)
    await expect(fetchScenesAt(SERVER, 'boedo.dcl.eth', ['9,9'])).rejects.toThrow(/boedo\.dcl\.eth \(503\)/)
  })

  it('reads a body with no scenes key as an empty world', async () => {
    respond(undefined)
    await expect(fetchScenesAt(SERVER, 'boedo.dcl.eth', ['9,9'])).resolves.toEqual([])
  })
})

describe('footprints', () => {
  it('canonicalises, dedupes and sorts, so whitespace is never a conflict', () => {
    expect(footprintOf(['9, 9', '9,9', '9,10'])).toEqual(['9,10', '9,9'])
  })

  it('keeps an unreadable parcel instead of silently shrinking the shape', () => {
    expect(footprintOf(['9,9', 'nowhere'])).toEqual(['9,9', 'nowhere'])
  })
})

describe('conflictsFor — the republish filter', () => {
  it('is not a conflict when the row is the entity this folder published here', () => {
    expect(conflictsFor([occupant()], 'bafyArena')).toEqual([])
  })

  it('is still not a conflict after you rename or resize the scene', () => {
    expect(conflictsFor([occupant({ title: 'Arena II' })], 'bafyArena')).toEqual([])
    expect(conflictsFor([occupant({ parcels: ['9,9'] })], 'bafyArena')).toEqual([])
  })

  it('is a conflict when another project of YOURS stands on the same parcels', () => {
    // the failure the wallet+parcels test used to wave through: same wallet,
    // same 0,0 every template ships with, a completely different scene
    const gallery = occupant({ entityId: 'bafyGallery', title: 'Gallery', base: '0,0', parcels: ['0,0'] })
    expect(conflictsFor([gallery], 'bafyParty')).toHaveLength(1)
  })

  it('is a conflict when another wallet holds the same parcels', () => {
    expect(conflictsFor([occupant({ entityId: 'bafyTheirs', deployer: '0x999' })], 'bafyArena')).toHaveLength(1)
  })

  it('is a conflict for every row when we have never published this folder here', () => {
    expect(conflictsFor([occupant()], null)).toHaveLength(1)
  })

  it('never exempts a row the server gave no entity id for', () => {
    expect(conflictsFor([occupant({ entityId: null })], null)).toHaveLength(1)
  })

  it('keeps the neighbours and drops only our own row', () => {
    const rows = [occupant(), occupant({ entityId: 'bafyOther', deployer: '0x999' })]
    expect(conflictsFor(rows, 'bafyArena').map((r) => r.entityId)).toEqual(['bafyOther'])
  })
})

describe('the lease', () => {
  it('does not change when the server reorders the same scenes', () => {
    const a = [occupant(), occupant({ entityId: 'bafyB', parcels: ['1,1'] })]
    expect(leaseChanged(leaseOf(a), leaseOf([...a].reverse()))).toBe(false)
  })

  it('changes when a scene was replaced, moved, added or removed', () => {
    const before = leaseOf([occupant()])
    expect(leaseChanged(before, leaseOf([occupant({ entityId: 'bafyNew' })]))).toBe(true)
    expect(leaseChanged(before, leaseOf([occupant({ parcels: ['9,9'] })]))).toBe(true)
    expect(leaseChanged(before, leaseOf([occupant(), occupant({ entityId: 'bafyB' })]))).toBe(true)
    expect(leaseChanged(before, leaseOf([]))).toBe(true)
  })

  it('ignores everything the creator was not shown a claim about', () => {
    const before = leaseOf([occupant()])
    expect(leaseChanged(before, leaseOf([occupant({ title: 'Renamed', timestamp: 2 })]))).toBe(false)
  })
})

describe('nearestFreeFootprint', () => {
  it('leaves the scene where it is when nothing is in the way', () => {
    expect(nearestFreeFootprint('0,0', ['0,0', '1,0'], [])).toEqual({ base: '0,0', parcels: ['0,0', '1,0'] })
  })

  it('steps one parcel out, straight before diagonal', () => {
    expect(nearestFreeFootprint('0,0', ['0,0'], ['0,0'])).toEqual({ base: '-1,0', parcels: ['-1,0'] })
  })

  it('moves the whole footprint, keeping its shape', () => {
    const moved = nearestFreeFootprint('0,0', ['0,0', '1,0', '0,1'], ['0,0'])
    expect(moved).toEqual({ base: '0,1', parcels: ['0,1', '1,1', '0,2'] })
  })

  it('walks outward until the footprint clears a whole occupied block', () => {
    const taken = ['0,0', '1,0', '2,0', '0,1', '1,1', '2,1', '0,-1', '1,-1', '2,-1']
    const moved = nearestFreeFootprint('0,0', ['0,0', '1,0'], taken)
    expect(moved).toEqual({ base: '-2,0', parcels: ['-2,0', '-1,0'] })
  })

  it('never proposes a parcel outside the world', () => {
    const corner = ['149,149', '149,150', '150,149', '150,150']
    const moved = nearestFreeFootprint('150,150', ['150,150'], corner)
    expect(moved).toEqual({ base: '148,150', parcels: ['148,150'] })
  })

  it('pulls a footprint that already hangs over the edge back inside', () => {
    const moved = nearestFreeFootprint('150,0', ['150,0', '151,0'], [])
    expect(moved).toEqual({ base: '149,0', parcels: ['149,0', '150,0'] })
  })

  it('is null when the footprint is wider than the world', () => {
    expect(nearestFreeFootprint('-160,0', ['-160,0', '142,0'], [])).toBeNull()
  })

  it('is null when every parcel of the world is taken', () => {
    const full: string[] = []
    for (let x = -150; x <= 150; x++) for (let y = -150; y <= 150; y++) full.push(`${x},${y}`)
    expect(nearestFreeFootprint('0,0', ['0,0'], full)).toBeNull()
  })

  it('is null when the shape cannot be read', () => {
    expect(nearestFreeFootprint('0,0', ['0,0', 'nowhere'], [])).toBeNull()
    expect(nearestFreeFootprint('nowhere', ['0,0'], [])).toBeNull()
    expect(nearestFreeFootprint('0,0', [], [])).toBeNull()
  })

  it('reads occupied parcels as forgivingly as it reads ours', () => {
    expect(nearestFreeFootprint('0,0', ['0,0'], [' 0, 0 '])).toEqual({ base: '-1,0', parcels: ['-1,0'] })
  })
})
