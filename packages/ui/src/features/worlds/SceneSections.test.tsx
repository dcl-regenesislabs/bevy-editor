import { describe, expect, it, vi } from 'vitest'
import type { WorldEntry, WorldScene } from './inventory'
import { mount, type Mounted } from '../../test/render'
import { SceneSections } from './SceneSections'

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

const PUBLISH_FIRST = 'Streaming keys belong to a scene. Publish a scene to boedo.dcl.eth and its key appears here.'

const body = (s: WorldScene): JSX.Element => <p className="body">body of {s.x},{s.y}</p>

const nine = (): WorldEntry =>
  world({
    scenes: Array.from({ length: 9 }, (_, i) => scene(i, 0, { title: `Scene ${i}` })),
    sceneCount: { known: true, total: 9 }
  })

// Filtered-out sections stay mounted and hidden, so "what the creator sees" is
// the visible ones — never every section in the tree.
const shown = (view: Mounted): string[] =>
  view.all('.eui-wsec:not([hidden]) .eui-shelf-head .t').map((el) => el.textContent ?? '')

describe('SceneSections', () => {
  it('renders the surface bare at one scene — no section header, no map', () => {
    const w = world({ scenes: [scene(0, 0, { title: 'Cozy Farm' })], sceneCount: { known: true, total: 1 } })
    const view = mount(<SceneSections w={w} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.all('.eui-shelf')).toHaveLength(0)
    expect(view.find('.eui-ds-map')).toBeNull()
    expect(view.text()).toBe('body of 0,0')
    view.unmount()
  })

  it('gives every scene its own named section when the world holds several', () => {
    const w = world({
      scenes: [scene(4, 1, { title: 'Tower of Madness' }), scene(0, 0, { title: 'Tower of Madness' })],
      sceneCount: { known: true, total: 2 }
    })
    const view = mount(<SceneSections w={w} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.all('.eui-shelf-head .t').map((el) => el.textContent)).toEqual([
      'Tower of Madness (0,0)',
      'Tower of Madness (4,1)'
    ])
    expect(view.all('.body').map((el) => el.textContent)).toEqual(['body of 0,0', 'body of 4,1'])
    expect(view.find('.eui-ds-map')).not.toBeNull()
    view.unmount()
  })

  it('never asks a collapsed section for its body', () => {
    const w = world({ scenes: [scene(0, 0), scene(4, 1)], sceneCount: { known: true, total: 2 } })
    const render = vi.fn(body)
    const view = mount(<SceneSections w={w} publishFirst={PUBLISH_FIRST} render={render} />)
    render.mockClear()

    view.click(view.all('.eui-shelf-head')[0])
    expect(render).not.toHaveBeenCalledWith(w.scenes[0])
    expect(view.all('.body').map((el) => el.textContent)).toEqual(['body of 4,1'])

    view.click(view.all('.eui-shelf-head')[0])
    expect(view.all('.body').map((el) => el.textContent)).toEqual(['body of 0,0', 'body of 4,1'])
    view.unmount()
  })

  it('opens at most three sections and lets the map open one more', () => {
    const scenes = [scene(0, 0), scene(1, 0), scene(2, 0), scene(3, 0)]
    const w = world({ scenes, sceneCount: { known: true, total: 4 } })
    const view = mount(<SceneSections w={w} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.all('.body')).toHaveLength(3)

    const cell = view.all('.eui-ds-map-cell.on').at(-1)
    view.click(cell ?? null)
    expect(view.all('.body').map((el) => el.textContent)).toContain('body of 3,0')
    view.unmount()
  })

  it('keeps what the creator opened when another scene is removed', () => {
    const kept = scene(0, 0, { title: 'Keep' })
    const gone = scene(4, 1, { title: 'Gone' })
    const third = scene(9, 9, { title: 'Third' })
    const fourth = scene(12, 2, { title: 'Fourth' })
    const before = world({ scenes: [kept, gone, third, fourth], sceneCount: { known: true, total: 4 } })
    const view = mount(<SceneSections w={before} publishFirst={PUBLISH_FIRST} render={body} />)
    view.click(view.byText('Fourth (12,2)', '.eui-shelf-head .t')?.parentElement ?? null)
    expect(view.all('.body')).toHaveLength(4)

    const after = world({ scenes: [kept, third, fourth], sceneCount: { known: true, total: 3 } })
    view.render(<SceneSections w={after} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.all('.eui-shelf-head .t').map((el) => el.textContent)).toEqual([
      'Keep (0,0)',
      'Third (9,9)',
      'Fourth (12,2)'
    ])
    expect(view.all('.body').map((el) => el.textContent)).toEqual(['body of 0,0', 'body of 9,9', 'body of 12,2'])
    view.unmount()
  })

  it('offers a filter only once the list is long, and searches title or coordinate', () => {
    const view = mount(<SceneSections w={nine()} publishFirst={PUBLISH_FIRST} render={body} />)
    const field = view.find('.eui-ds-search input')
    expect(field).not.toBeNull()

    view.type(field, '7,0')
    expect(shown(view)).toEqual(['Scene 7 (7,0)'])
    view.type(field, 'Scene 2')
    expect(shown(view)).toEqual(['Scene 2 (2,0)'])
    view.unmount()
  })

  // The filter is an index, not a stop button: an open section holds a live log
  // stream, half-typed input and a pending mutation's error, and none of that may
  // be thrown away by typing in a box labelled "Find a scene".
  it('hides what the filter excludes instead of tearing it down', () => {
    const view = mount(<SceneSections w={nine()} publishFirst={PUBLISH_FIRST} render={body} />)
    const before = view.all('.eui-wsec').length
    view.type(view.find('.eui-ds-search input'), 'Scene 5')
    expect(view.all('.eui-wsec')).toHaveLength(before)
    expect(view.all('.body').map((el) => el.textContent)).toContain('body of 0,0')
    expect(shown(view)).toEqual(['Scene 5 (5,0)'])
    view.unmount()
  })

  it('clears the filter when the map is asked for a scene the filter is hiding', () => {
    const view = mount(<SceneSections w={nine()} publishFirst={PUBLISH_FIRST} render={body} />)
    view.type(view.find('.eui-ds-search input'), 'Scene 2')
    expect(shown(view)).toEqual(['Scene 2 (2,0)'])

    view.click(view.all('.eui-ds-map-cell.on').at(-1) ?? null)
    expect(shown(view)).toHaveLength(9)
    expect(view.all('.body').map((el) => el.textContent)).toContain('body of 8,0')
    view.unmount()
  })

  it('says the world read short, and still shows the scenes it did read', () => {
    const w = world({ scenes: [scene(0, 0, { title: 'One' }), scene(4, 1, { title: 'Two' })], sceneCount: { known: false } })
    const view = mount(<SceneSections w={w} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.find('.eui-ds-notice')?.textContent).toBe(
      "Part of boedo.dcl.eth couldn't be read, so this list may be missing scenes."
    )
    expect(view.all('.eui-shelf')).toHaveLength(2)
    view.unmount()
  })

  // The server counts a scene it cannot give a coordinate for, and mapScene drops
  // it. Reading the located list as the world is how a two-scene world tells a
  // creator it holds one — dropping the coordinate from every label and the
  // "other scenes" reassurance from every destructive modal.
  it('counts the world, not the scenes it could place', () => {
    const w = world({ scenes: [scene(0, 0, { title: 'Tarot' })], sceneCount: { known: true, total: 2 } })
    const view = mount(<SceneSections w={w} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.find('.eui-ds-notice')?.textContent).toBe(
      "Part of boedo.dcl.eth couldn't be read, so this list may be missing scenes."
    )
    expect(shown(view)).toEqual(['Tarot (0,0)'])
    view.unmount()
  })

  it('asks for a publish in the caller-supplied words when nothing is published here', () => {
    const view = mount(<SceneSections w={world()} publishFirst={PUBLISH_FIRST} render={body} />)
    expect(view.text()).toBe(PUBLISH_FIRST)
    expect(view.all('.eui-shelf')).toHaveLength(0)
    view.unmount()
  })

  // Nothing is known to be missing — the read failed. Asking for a publish there
  // tells a creator to republish what may already be live.
  it('does not ask for a publish when the world admittedly did not read', () => {
    const view = mount(
      <SceneSections w={world({ sceneCount: { known: false } })} publishFirst={PUBLISH_FIRST} render={body} />
    )
    expect(view.text()).toBe("Part of boedo.dcl.eth couldn't be read, so this list may be missing scenes.")
    view.unmount()
  })
})
