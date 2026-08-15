import { describe, expect, it, vi } from 'vitest'
import type { WorldEntry, WorldScene } from './inventory'
import { mount } from '../../test/render'

vi.mock('./signed-fetch', () => ({ signedFetch: () => Promise.reject(new Error('no network in a render test')) }))
vi.mock('../account/auth', () => ({ getAccount: () => '0xowner' }))

import { StorageTab } from './StorageTab'

const scene = (x: number, y: number, over: Partial<WorldScene> = {}): WorldScene => ({
  x,
  y,
  parcels: [`${x},${y}`],
  title: null,
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: `bafy${x}_${y}`,
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

// The gate reads every scene, so it can only say "none of them" about a world it
// read in full. A page that failed, or a scene the server counted and this app
// could not place, leaves a scene that may well be running a Multiplayer Server —
// and telling that creator to publish one is a flat false claim about a world
// that may already have storage in it.
describe('StorageTab availability gate', () => {
  it('says the world read short rather than that nothing is published here', () => {
    const view = mount(<StorageTab w={world({ sceneCount: { known: false } })} />)
    expect(view.text()).toContain("Part of boedo.dcl.eth couldn't be read, so this list may be missing scenes.")
    expect(view.text()).not.toContain('Publish a scene')
    view.unmount()
  })

  it('says the world read short rather than that no scene runs a Multiplayer Server', () => {
    const w = world({ scenes: [scene(0, 0)], sceneCount: { known: true, total: 2 } })
    const view = mount(<StorageTab w={w} />)
    expect(view.text()).toContain("Part of boedo.dcl.eth couldn't be read, so this list may be missing scenes.")
    expect(view.text()).not.toContain('runs a Multiplayer Server')
    view.unmount()
  })

  it('asks for a publish only when it read the whole world and found it empty', () => {
    const view = mount(<StorageTab w={world()} />)
    expect(view.text()).toBe(
      'Server storage needs a scene running a Multiplayer Server. Publish a scene to boedo.dcl.eth first.'
    )
    view.unmount()
  })

  it('names the missing flag when every scene in the world was read and none runs one', () => {
    const w = world({ scenes: [scene(0, 0), scene(4, 1)], sceneCount: { known: true, total: 2 } })
    const view = mount(<StorageTab w={w} />)
    expect(view.text()).toContain('No scene in boedo.dcl.eth runs a Multiplayer Server, so there is no server storage.')
    view.unmount()
  })

  // Storage's true scope is unproven, so the panel stays world-level and its copy
  // may not claim otherwise — not "your scene", which asserts one of several.
  it('opens for a world where any scene runs one, and claims no scope in its copy', () => {
    const w = world({
      scenes: [scene(0, 0), scene(4, 1, { authoritativeMultiplayer: true })],
      sceneCount: { known: true, total: 2 }
    })
    const view = mount(<StorageTab w={w} />)
    expect(view.byText('Server storage')).not.toBeNull()
    expect(view.text()).not.toContain('your scene')
    view.unmount()
  })
})
