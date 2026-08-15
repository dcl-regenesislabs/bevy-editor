// Pins the sentences a creator reads before their scene replaces someone's
// work. Wording is the deliverable here: "Live: X" on a world holding five
// scenes is the sentence that made publishing feel like an overwrite, and
// "replaces it" vs "replaces them" is the difference between a warning that
// matches what is on screen and one that doesn't.
import { describe, expect, it } from 'vitest'
import type { WorldEntry, WorldScene } from '../worlds/inventory'
import type { OccupyingScene } from './publish-conflict'
import {
  conflictConsequence,
  conflictRows,
  moveLine,
  pickTimeLine,
  recoveryLine,
  successLine,
  worldRowLine
} from './publish-copy'

const MINUTE = 60_000
const now = Date.now()

const scene = (over: Partial<WorldScene> = {}): WorldScene => ({
  x: 0,
  y: 0,
  parcels: ['0,0'],
  title: null,
  deployer: null,
  timestamp: now - MINUTE,
  thumbnail: null,
  entityId: null,
  size: null,
  status: 'DEPLOYED',
  authoritativeMultiplayer: false,
  ...over
})

const world = (over: Partial<WorldEntry> = {}): WorldEntry => ({
  name: 'cozyfarm.dcl.eth',
  role: 'owner',
  size: null,
  scenes: [],
  sceneCount: { known: true, total: 0 },
  settings: null,
  image: null,
  userCount: null,
  ...over
})

const occupying = (over: Partial<OccupyingScene> = {}): OccupyingScene => ({
  entityId: 'bafy2',
  deployer: '0xbbbb',
  title: 'Museum',
  base: '4,4',
  parcels: ['4,4', '4,5'],
  timestamp: now - MINUTE,
  ...over
})

describe('worldRowLine', () => {
  it('says Empty for a world holding nothing', () => {
    expect(worldRowLine(world())).toBe('Empty')
  })

  it('names the scene only when the world holds exactly one', () => {
    const w = world({ sceneCount: { known: true, total: 1 }, scenes: [scene({ title: 'Cozy Farm' })] })
    expect(worldRowLine(w)).toBe('Live: Cozy Farm · just now')
  })

  it('counts them instead of naming any one of them when the world holds several', () => {
    const w = world({
      sceneCount: { known: true, total: 3 },
      scenes: [scene({ title: 'Cozy Farm' }), scene({ x: 1, timestamp: now - 5 * MINUTE })]
    })
    expect(worldRowLine(w)).toBe('3 scenes · updated just now')
  })

  // The scenes arrive created_at ASC, so the head of the list is the world's
  // OLDEST scene. Naming it dates the world by whatever was published first.
  it('dates the world by its newest scene, not by the first one the server sent', () => {
    const w = world({
      sceneCount: { known: true, total: 2 },
      scenes: [scene({ timestamp: now - 60 * MINUTE }), scene({ x: 1, timestamp: now - MINUTE })]
    })
    expect(worldRowLine(w)).toBe('2 scenes · updated just now')
  })

  it('says it could not read the world rather than calling it empty', () => {
    expect(worldRowLine(world({ sceneCount: { known: false } }))).toBe("Couldn't read this world")
  })

  it('does not trail off when no scene in the world carries a timestamp', () => {
    const w = world({ sceneCount: { known: true, total: 3 }, scenes: [scene({ timestamp: null })] })
    expect(worldRowLine(w)).toBe('3 scenes')
  })

  // A scene with no readable coordinate is counted but never located, so the
  // world can hold one scene and list none. "1 scenes" is the tell.
  it('counts a scene it could not locate without mangling the plural', () => {
    expect(worldRowLine(world({ sceneCount: { known: true, total: 1 }, scenes: [] }))).toBe('1 scene')
  })
})

describe('moveLine', () => {
  it('is singular for the one-parcel scene every template ships with', () => {
    expect(moveLine({ base: '1,0', parcels: ['1,0'] })).toBe(
      'Your scene moves to 1,0 · 1 parcel. This is saved in scene.json.'
    )
  })

  it('is plural for a bigger footprint', () => {
    expect(moveLine({ base: '1,0', parcels: ['1,0', '2,0'] })).toBe(
      'Your scene moves to 1,0 · 2 parcels. This is saved in scene.json.'
    )
  })
})

describe('pickTimeLine', () => {
  it('is singular for one scene', () => {
    expect(pickTimeLine('cozyfarm.dcl.eth', 1, '10,10')).toBe('cozyfarm.dcl.eth already has 1 scene. Yours goes to 10,10.')
  })

  it('is plural for several', () => {
    expect(pickTimeLine('cozyfarm.dcl.eth', 4, '10,10')).toBe('cozyfarm.dcl.eth already has 4 scenes. Yours goes to 10,10.')
  })

  it('drops the destination when the scene could not be read', () => {
    expect(pickTimeLine('cozyfarm.dcl.eth', 2, null)).toBe('cozyfarm.dcl.eth already has 2 scenes.')
  })
})

describe('the conflict step', () => {
  it('agrees with itself about how many scenes go', () => {
    expect(conflictConsequence('My Scene', 'cozyfarm.dcl.eth', 1)).toBe(
      'Publishing “My Scene” to cozyfarm.dcl.eth replaces it.'
    )
    expect(conflictConsequence('My Scene', 'cozyfarm.dcl.eth', 2)).toBe(
      'Publishing “My Scene” to cozyfarm.dcl.eth replaces them.'
    )
  })

  it('names the wallet only when the scene is not the creator’s own', () => {
    const rows = conflictRows([occupying({ deployer: '0x1234567890abcdef1234' })], '0xffff')
    expect(rows[0].line).toBe('“Museum” · 2 parcels · published just now')
    expect(rows[0].by).toBe('Published by 0x1234…1234 — not you.')
    expect(conflictRows([occupying({ deployer: '0xFFFF' })], '0xffff')[0].by).toBe(null)
  })

  it('says how to bring the replaced scene back', () => {
    expect(recoveryLine([occupying()])).toBe(
      "To bring “Museum” back you'd publish it again from its own project folder."
    )
  })
})

describe('successLine', () => {
  it('places the scene and counts the world', () => {
    expect(successLine('My Scene', '10,10', 'cozyfarm.dcl.eth', 3)).toBe(
      '“My Scene” is live at 10,10. cozyfarm.dcl.eth now has 3 scenes.'
    )
  })
})
