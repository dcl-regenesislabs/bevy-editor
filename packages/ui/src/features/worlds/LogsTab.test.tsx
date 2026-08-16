import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { streamServerLogs } from './logs'
import type { WorldEntry, WorldScene } from './inventory'
import { mount } from '../../test/render'

type StreamOpts = Parameters<typeof streamServerLogs>[0]

// A live stream never settles; a resolving stub would flip every console to
// "disconnected" before the test could look at it.
const stream = vi.fn((_opts: StreamOpts): Promise<void> => new Promise<void>(() => {}))

vi.mock('./logs', () => ({ streamServerLogs: (opts: StreamOpts) => stream(opts) }))

import { LogsTab } from './LogsTab'

const scene = (x: number, y: number, over: Partial<WorldScene> = {}): WorldScene => ({
  x,
  y,
  parcels: [`${x},${y}`],
  title: null,
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: 'bafy',
  size: null,
  status: 'DEPLOYED',
  authoritativeMultiplayer: true,
  ...over
})

const world = (scenes: WorldScene[]): WorldEntry => ({
  name: 'boedo.dcl.eth',
  role: 'owner',
  size: null,
  scenes,
  sceneCount: { known: true, total: scenes.length },
  settings: null,
  image: null,
  userCount: null
})

const connects = (view: ReturnType<typeof mount>): HTMLElement[] =>
  view.all('.eui-srvlog-center button').filter((b) => b.textContent === 'Connect')

describe('LogsTab', () => {
  beforeEach(() => {
    stream.mockClear()
  })

  it('asks for a publish, in the words of this surface, when the world is empty', () => {
    const view = mount(<LogsTab w={world([])} watching={[]} onWatch={() => undefined} />)
    expect(view.text()).toBe("Server logs come from a scene's server code. Publish a scene to boedo.dcl.eth first.")
    view.unmount()
  })

  it('names the one scene and connects to its own parcel, with no section chrome', () => {
    const w = world([scene(4, 1, { title: 'Cozy Farm', parcels: ['5,1', '4,1'] })])
    const view = mount(<LogsTab w={w} watching={[]} onWatch={() => undefined} />)
    expect(view.all('.eui-ds-pick')).toHaveLength(0)
    expect(view.text()).toContain(
      'Output from the server code of “Cozy Farm”. The process only runs while players are in the world.'
    )

    view.click(connects(view)[0])
    expect(stream.mock.calls[0][0].world).toBe('boedo.dcl.eth')
    expect(stream.mock.calls[0][0].parcel).toBe('5,1')
    view.unmount()
  })

  it('gives every scene its own console and streams as many at once as the creator opens', () => {
    const w = world([
      scene(0, 0, { title: 'Tower of Madness' }),
      scene(4, 1, { title: 'Tower of Madness' })
    ])
    const keys = [`world:${w.name}@0,0`, `world:${w.name}@4,1`]
    const view = mount(<LogsTab w={w} watching={keys} onWatch={() => undefined} />)
    expect(view.text()).toContain('Each scene runs its own server process.')
    expect(view.all('.eui-ds-pick .nm').map((el) => el.textContent)).toEqual([
      'Tower of Madness (0,0)',
      'Tower of Madness (4,1)'
    ])
    // the coordinate rides the sentence too — two sections named the same otherwise
    expect(view.text()).toContain('Output from the server code of “Tower of Madness” at 0,0.')

    view.click(connects(view)[0])
    view.click(connects(view)[0])
    expect(stream.mock.calls.map((c) => c[0].parcel)).toEqual(['0,0', '4,1'])
    expect(view.all('.eui-srvlog-bar')).toHaveLength(2)
    view.unmount()
  })

  it("explains a scene with no Multiplayer Server inside its own section, and leaves its neighbour watchable", () => {
    const w = world([
      scene(0, 0, { title: 'Tarot', authoritativeMultiplayer: false }),
      scene(4, 1, { title: 'Arena' })
    ])
    const keys = [`world:${w.name}@0,0`, `world:${w.name}@4,1`]
    const view = mount(<LogsTab w={w} watching={keys} onWatch={() => undefined} />)
    // the card says it before the click, and the body says what to do about it
    // only the scene that lacks one carries a note; the other card stays quiet
    expect(view.all('.eui-ds-pick .num').map((el) => el.textContent)).toEqual(['No server logs'])
    expect(view.text()).toContain(
      '“Tarot” at 0,0 doesn\'t run a Multiplayer Server, so it has no server logs. ' +
        'Set "authoritativeMultiplayer": true in its scene.json and publish again.'
    )
    expect(connects(view)).toHaveLength(1)

    view.click(connects(view)[0])
    expect(stream.mock.calls.map((c) => c[0].parcel)).toEqual(['4,1'])
    view.unmount()
  })
})
