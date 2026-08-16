import { describe, expect, it, vi } from 'vitest'

// analytics.ts reaches the wallet at module scope; this suite only wants the id
// it builds, so the account module stands in and no browser storage is needed.
vi.mock('../account/auth', () => ({ getAccount: () => null }))

import { sceneKey } from './analytics'
import type { WorldEntry, WorldScene } from './inventory'
import {
  orderScenesByCoordinate,
  sceneKeyOf,
  sceneLabel,
  sceneLabelProse,
  sceneListShort,
  sceneToneOf,
  sceneTotalOf
} from './scene-label'

const scene = (x: number, y: number, over: Partial<WorldScene> = {}): WorldScene => ({
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
  authoritativeMultiplayer: false,
  ...over
})

const world = (over: Partial<WorldEntry> = {}): WorldEntry => ({
  name: 'boedo.dcl.eth',
  role: 'owner',
  size: null,
  scenes: [],
  sceneCount: { known: true, total: 0 },
  settings: null,
  image: null,
  userCount: null,
  ...over
})

describe('sceneKeyOf', () => {
  it('spells the id exactly as the metrics client does', () => {
    const w = world()
    const s = scene(-3, 12)
    expect(sceneKeyOf(w, s)).toBe('world:boedo.dcl.eth@-3,12')
    expect(sceneKeyOf(w, s)).toBe(sceneKey(w, s))
  })

  it('is the same key after a republish rotates the entityId', () => {
    const w = world()
    const before = sceneKeyOf(w, scene(0, 0, { entityId: 'bafyOLD', title: 'Tarot' }))
    const after = sceneKeyOf(w, scene(0, 0, { entityId: 'bafyNEW', title: 'Tarot v2' }))
    expect(after).toBe(before)
  })
})

describe('sceneLabel', () => {
  it('tells two scenes with the same title apart by their ground', () => {
    const a = scene(0, 0, { title: 'Tower of Madness' })
    const b = scene(4, 1, { title: 'Tower of Madness' })
    expect(sceneLabel(a, 2)).toBe('Tower of Madness (0,0)')
    expect(sceneLabel(b, 2)).toBe('Tower of Madness (4,1)')
    expect(sceneLabel(a, 2)).not.toBe(sceneLabel(b, 2))
  })

  it('names an untitled scene by where it sits', () => {
    expect(sceneLabel(scene(-1, 5), 3)).toBe('Scene at -1,5')
    expect(sceneLabel(scene(-1, 5), 1)).toBe('Untitled scene')
  })

  it('drops the coordinate when the world holds one scene', () => {
    expect(sceneLabel(scene(0, 0, { title: 'Cozy Farm' }), 1)).toBe('Cozy Farm')
  })
})

describe('sceneLabelProse', () => {
  it('names the scene inside a sentence, with the ground only when it distinguishes', () => {
    const s = scene(0, 0, { title: 'Tower of Madness' })
    expect(sceneLabelProse(s, 2)).toBe('“Tower of Madness” at 0,0')
    expect(sceneLabelProse(s, 1)).toBe('“Tower of Madness”')
    expect(sceneLabelProse(scene(7, -2), 2)).toBe('the scene at 7,-2')
  })
})

describe('sceneToneOf', () => {
  it('keeps a tone when a sibling is removed', () => {
    const scenes = [scene(0, 0), scene(4, 1), scene(-8, 3)]
    const before = scenes.map(sceneToneOf)
    const after = [scenes[0], scenes[2]].map(sceneToneOf)
    expect(after).toEqual([before[0], before[2]])
  })

  it('answers a tone parcelTone can cycle, for negative ground too', () => {
    for (const s of [scene(0, 0), scene(-140, -99), scene(150, 12)]) {
      const tone = sceneToneOf(s)
      expect(Number.isInteger(tone)).toBe(true)
      expect(tone).toBeGreaterThanOrEqual(0)
      expect(tone).toBeLessThan(6)
    }
  })
})

describe('orderScenesByCoordinate', () => {
  it('orders by ground rather than by server order, and leaves the input alone', () => {
    const scenes = [scene(4, 1), scene(0, 9), scene(0, -2)]
    expect(orderScenesByCoordinate(scenes).map((s) => `${s.x},${s.y}`)).toEqual(['0,-2', '0,9', '4,1'])
    expect(scenes.map((s) => `${s.x},${s.y}`)).toEqual(['4,1', '0,9', '0,-2'])
  })
})

// The server counts a scene mapScene cannot place, so the located list is a
// floor. Counting it as the world is how a two-scene world tells a creator it
// holds one — and a one-scene world drops the coordinate from every label and
// the "other scenes are unaffected" line from every destructive modal.
describe('counting the world rather than the list', () => {
  it('counts what the world holds when a scene could not be placed', () => {
    const w = world({ scenes: [scene(0, 0)], sceneCount: { known: true, total: 2 } })
    expect(sceneTotalOf(w)).toBe(2)
    expect(sceneLabel(w.scenes[0], sceneTotalOf(w))).toBe('Scene at 0,0')
    expect(sceneListShort(w)).toBe(true)
  })

  it('takes the located list as a floor when the count is unknown', () => {
    const w = world({ scenes: [scene(0, 0), scene(4, 1)], sceneCount: { known: false } })
    expect(sceneTotalOf(w)).toBe(2)
    expect(sceneListShort(w)).toBe(true)
  })

  it('never counts below what it can see', () => {
    const w = world({ scenes: [scene(0, 0), scene(4, 1)], sceneCount: { known: true, total: 1 } })
    expect(sceneTotalOf(w)).toBe(2)
  })

  it('is not short when the world read in full', () => {
    const w = world({ scenes: [scene(0, 0)], sceneCount: { known: true, total: 1 } })
    expect(sceneListShort(w)).toBe(false)
    expect(sceneTotalOf(w)).toBe(1)
  })
})
