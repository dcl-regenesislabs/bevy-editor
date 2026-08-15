import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as GatekeeperModule from './gatekeeper'
import type { WorldEntry, WorldScene } from './inventory'
import { mount, type Mounted } from '../../test/render'

// The lists are stubbed; sceneScopeOf stays real, so a section that addressed
// the wrong ground would show up as a scope built from the wrong parcel.
const admins = vi.fn()
const bans = vi.fn()
const banned = vi.fn()
const unadmin = vi.fn()

// The real predicate is pinned against a real 404 in gatekeeper.test.ts; here it
// only has to recognise the failure the stubs raise, so the panel's own wiring
// is what is under test.
const NOT_INDEXED_404 = 'not-indexed-404'

vi.mock('./gatekeeper', async (importOriginal) => {
  const actual = await importOriginal<typeof GatekeeperModule>()
  return {
    ...actual,
    isSceneNotIndexed: (e: unknown) => e instanceof Error && e.message === NOT_INDEXED_404,
    listSceneAdmins: (scope: GatekeeperModule.SceneScope) => admins(scope),
    listSceneBans: (scope: GatekeeperModule.SceneScope) => bans(scope),
    addSceneAdmin: () => Promise.resolve(),
    removeSceneAdmin: (scope: GatekeeperModule.SceneScope, admin: string) => unadmin(scope, admin),
    setSceneBan: (scope: GatekeeperModule.SceneScope, target: unknown, on: boolean) => banned(scope, target, on)
  }
})
vi.mock('./signed-fetch', () => ({ signedFetch: () => Promise.reject(new Error('no network in a render test')) }))

import { ModerationPanel } from './ModerationPanel'

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

const twoScenes = (): WorldEntry =>
  world({
    scenes: [scene(4, 1, { title: 'Tower of Madness' }), scene(0, 0, { title: 'Tower of Madness' })],
    sceneCount: { known: true, total: 2 }
  })

const oneScene = (): WorldEntry =>
  world({ scenes: [scene(0, 0, { title: 'Cozy Farm' })], sceneCount: { known: true, total: 1 } })

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'

beforeEach(() => {
  vi.clearAllMocks()
  admins.mockResolvedValue([{ admin: ADDRESS, name: '', canBeRemoved: true }])
  bans.mockResolvedValue({ bans: [], total: 0 })
  banned.mockResolvedValue(undefined)
  unadmin.mockResolvedValue(undefined)
})

describe('ModerationPanel', () => {
  it('offers one card per scene and one Admins/Bans choice for the tab', async () => {
    const view = mount(<ModerationPanel w={twoScenes()} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.all('.eui-seg')).toHaveLength(1)
    expect(view.all('.eui-ds-pick')).toHaveLength(2)
    view.unmount()
  })

  it('teaches that the lists are per scene, and points elsewhere for entry to the world', () => {
    const view = mount(<ModerationPanel w={oneScene()} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toContain('Admins and bans are kept per scene.')
    expect(view.text()).toContain('Who can enter the world at all is set under Permissions → Who can visit.')
    view.unmount()
  })

  it('asks for a publish in per-scene words when nothing is published here', () => {
    const view = mount(<ModerationPanel w={world()} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toContain('Moderation is set per scene. Publish a scene to boedo.dcl.eth first.')
    view.unmount()
  })

  it('says so instead of guessing when a scene cannot be addressed', () => {
    const w = world({ scenes: [scene(0, 0, { entityId: null })], sceneCount: { known: true, total: 1 } })
    const view = mount(<ModerationPanel w={w} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toContain(
      "Admins and bans are kept per scene, and the scene at 0,0 hasn't finished publishing — try again in a few minutes."
    )
    expect(admins).not.toHaveBeenCalled()
    view.unmount()
  })

  it('addresses the picked scene, and only that one', async () => {
    const view = mount(<ModerationPanel w={twoScenes()} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(admins.mock.calls.map((c) => (c[0] as GatekeeperModule.SceneScope).parcel)).toEqual(['0,0'])
    view.unmount()
  })

  it('addresses the other scene once it is picked, without asking about the first', async () => {
    const w = twoScenes()
    const key = `world:${w.name}@4,1`
    const view = mount(<ModerationPanel w={w} picked={[key]} onPick={() => undefined} />)
    await view.settle()
    expect(admins.mock.calls.map((c) => (c[0] as GatekeeperModule.SceneScope).parcel)).toEqual(['4,1'])
    view.unmount()
  })
})

describe('ModerationPanel bans', () => {
  const openBans = async (w: WorldEntry): Promise<Mounted> => {
    const view = mount(<ModerationPanel w={w} picked={[]} onPick={() => undefined} />)
    view.click(view.byText('Bans', '.eui-seg-btn'))
    await view.settle()
    return view
  }

  // /about does not advertise per-scene comms adapters, so a scene-level ban is
  // provisioned but not proven to be what a visitor experiences. The copy may
  // say where a ban is STORED and must stop there — never that the person is
  // kept out.
  it('says where a ban is kept and never claims it keeps anyone out', async () => {
    const view = await openBans(twoScenes())
    const sections = view.all('.eui-world-scenebody').map((el) => el.textContent).join(' ')
    expect(sections).toContain('People banned from this scene. Other scenes in this world keep their own list.')
    expect(sections).toContain('Nobody is banned from this scene.')
    expect(sections).not.toMatch(/enter|blocked|kept out|can't get in|join/i)
    view.unmount()
  })

  it('names the scene it is about to ban someone from, and leaves the rest of the world alone', async () => {
    const view = await openBans(twoScenes())
    view.type(view.all('.eui-perm-add input')[0], ADDRESS)
    view.click(view.all('.eui-perm-add button')[0])
    expect(view.find('.eui-modal-head')?.textContent).toBe('Ban 0x1234…5678 from “Tower of Madness” at 0,0?')
    expect(view.find('.eui-modal-body')?.textContent).toContain('They stay banned until you unban them here.')
    expect(view.find('.eui-modal-body')?.textContent).toContain('The other scenes in this world are unaffected.')

    view.click(view.byText('Ban', '.eui-modal-foot button'))
    await view.settle()
    expect(banned).toHaveBeenCalledTimes(1)
    expect((banned.mock.calls[0][0] as GatekeeperModule.SceneScope).parcel).toBe('0,0')
    expect(banned.mock.calls[0][1]).toEqual({ address: ADDRESS })
    expect(banned.mock.calls[0][2]).toBe(true)
    view.unmount()
  })

  it('drops the coordinate and the other-scenes reassurance when the world holds one scene', async () => {
    const view = await openBans(oneScene())
    view.type(view.find('.eui-perm-add input'), ADDRESS)
    view.click(view.find('.eui-perm-add button'))
    expect(view.find('.eui-modal-head')?.textContent).toBe('Ban 0x1234…5678 from “Cozy Farm”?')
    expect(view.find('.eui-modal-body')?.textContent).not.toContain('other scenes')
    view.unmount()
  })

  // The server counted two scenes and this app could place one. Reading the
  // located list as the world would name the scene without its coordinate and
  // drop the reassurance — on a world that does hold a second scene.
  it('still counts the world when a scene could not be placed', async () => {
    const w = world({ scenes: [scene(0, 0, { title: 'Tarot' })], sceneCount: { known: true, total: 2 } })
    const view = await openBans(w)
    view.type(view.find('.eui-perm-add input'), ADDRESS)
    view.click(view.find('.eui-perm-add button'))
    expect(view.find('.eui-modal-head')?.textContent).toBe('Ban 0x1234…5678 from “Tarot” at 0,0?')
    expect(view.find('.eui-modal-body')?.textContent).toContain('The other scenes in this world are unaffected.')
    view.unmount()
  })

  it('keeps what was typed when the ban is called off', async () => {
    const view = await openBans(oneScene())
    view.type(view.find('.eui-perm-add input'), ADDRESS)
    view.click(view.find('.eui-perm-add button'))
    view.click(view.byText('Cancel', '.eui-modal-foot button'))
    expect((view.find('.eui-perm-add input') as HTMLInputElement).value).toBe(ADDRESS)
    expect(banned).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('ModerationPanel admins', () => {
  it('says what an admin can do here, and asks before taking it away by name', async () => {
    const view = mount(<ModerationPanel w={twoScenes()} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.text()).toContain('Admins can moderate a scene in-game: kick and ban visitors, manage its streams.')

    view.click(view.all('.eui-perm-row button')[0])
    expect(view.find('.eui-modal-head')?.textContent).toBe(
      'Remove 0x1234…5678 as an admin of “Tower of Madness” at 0,0?'
    )
    expect(view.find('.eui-modal-body')?.textContent).toContain(
      'Admins on the other scenes in this world are unaffected.'
    )

    view.click(view.byText('Remove', '.eui-modal-foot button'))
    await view.settle()
    expect((unadmin.mock.calls[0][0] as GatekeeperModule.SceneScope).parcel).toBe('0,0')
    expect(unadmin.mock.calls[0][1]).toBe(ADDRESS)
    view.unmount()
  })

  // The sections open by themselves, so this is what a creator sees seconds after
  // publishing a second scene — not something they clicked. The status code is an
  // accusation they can do nothing about: they do own the world, the index just
  // hasn't caught up.
  it('says a freshly published scene is not indexed yet instead of printing the status', async () => {
    admins.mockRejectedValue(new Error(NOT_INDEXED_404))
    const view = mount(<ModerationPanel w={oneScene()} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.text()).toContain("This scene isn't indexed yet — try again in a few minutes.")
    expect(view.text()).not.toContain('404')
    view.unmount()
  })

  it('names an empty list for the scene, not for the world', async () => {
    admins.mockResolvedValue([])
    const view = mount(<ModerationPanel w={oneScene()} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.text()).toContain('No extra admins for this scene.')
    view.unmount()
  })
})
