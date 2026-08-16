import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorldEntry, WorldScene } from './inventory'
import { mount } from '../../test/render'
import { scenePanelProps } from './scene-panel'
import { SceneStreaming, StreamingPanel } from './StreamingPanel'

const { signed } = vi.hoisted(() => ({ signed: vi.fn() }))
vi.mock('./signed-fetch', () => ({ signedFetch: signed }))

const scene = (x: number, y: number, over: Partial<WorldScene> = {}): WorldScene => ({
  x,
  y,
  parcels: [`${x},${y}`],
  title: null,
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: `bafy${x}${y}`,
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

const KEY = { streaming_url: 'rtmp://live.dcl/x', streaming_key: 'sk-1', ends_at: null }

const reply = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status })

const metadataOf = (call: number): Record<string, unknown> =>
  signed.mock.calls[call][2] as Record<string, unknown>

describe('SceneStreaming', () => {
  beforeEach(() => {
    signed.mockReset()
  })

  it('addresses the scene it is rendered for, not the world', async () => {
    signed.mockResolvedValue(reply(404))
    const w = world({
      scenes: [scene(0, 0, { title: 'Tower of Madness' }), scene(4, 1, { title: 'Tower of Madness' })],
      sceneCount: { known: true, total: 2 }
    })
    const view = mount(<SceneStreaming {...scenePanelProps(w, w.scenes[1])} />)
    await view.settle()
    expect(metadataOf(0).parcel).toBe('4,1')
    expect(metadataOf(0).sceneId).toBe('bafy41')
    view.unmount()
  })

  it('says the scene is not indexed yet instead of accusing the creator', async () => {
    signed.mockResolvedValue(reply(404))
    const w = world({ scenes: [scene(0, 0, { title: 'Cozy Farm' })], sceneCount: { known: true, total: 1 } })
    const view = mount(<SceneStreaming {...scenePanelProps(w, w.scenes[0])} />)
    await view.settle()
    view.click(view.byText('Generate streaming key', 'button'))
    await view.settle()
    expect(view.find('.eui-perm-err')?.textContent).toBe("This scene isn't indexed yet — try again in a few minutes.")
    expect(view.text()).not.toContain('Only the world owner')
    view.unmount()
  })

  it('names the scene and its ground before it revokes a key', async () => {
    signed.mockResolvedValue(reply(200, KEY))
    const w = world({
      scenes: [scene(0, 0, { title: 'Tower of Madness' }), scene(4, 1, { title: 'Tower of Madness' })],
      sceneCount: { known: true, total: 2 }
    })
    const view = mount(<SceneStreaming {...scenePanelProps(w, w.scenes[1])} />)
    await view.settle()
    view.click(view.byText('Revoke', 'button'))
    expect(view.find('.eui-modal-head')?.textContent).toBe('Revoke the streaming key for “Tower of Madness” at 4,1?')
    expect(view.find('.eui-modal-body')?.textContent).toContain('The other scenes in this world keep their own keys.')
    expect(signed).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('drops the other-scenes promise when the world holds one scene', async () => {
    signed.mockResolvedValue(reply(200, KEY))
    const w = world({ scenes: [scene(0, 0, { title: 'Cozy Farm' })], sceneCount: { known: true, total: 1 } })
    const view = mount(<SceneStreaming {...scenePanelProps(w, w.scenes[0])} />)
    await view.settle()
    view.click(view.byText('Revoke', 'button'))
    expect(view.find('.eui-modal-head')?.textContent).toBe('Revoke the streaming key for “Cozy Farm”?')
    expect(view.find('.eui-modal-body')?.textContent).not.toContain('other scenes')
    view.unmount()
  })

  it('explains an unaddressable scene rather than calling with an invented parcel', async () => {
    signed.mockResolvedValue(reply(200, KEY))
    const w = world({
      scenes: [scene(7, -2, { entityId: null })],
      sceneCount: { known: true, total: 1 }
    })
    const view = mount(<SceneStreaming {...scenePanelProps(w, w.scenes[0])} />)
    await view.settle()
    expect(view.text()).toBe(
      "Streaming keys are handed out per scene, and the scene at 7,-2 hasn't finished publishing — try again in a few minutes."
    )
    expect(signed).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('StreamingPanel', () => {
  beforeEach(() => {
    signed.mockReset()
  })

  it('teaches the one-key-per-scene rule and points elsewhere for who may stream', () => {
    signed.mockResolvedValue(reply(404))
    const w = world({ scenes: [scene(0, 0)], sceneCount: { known: true, total: 1 } })
    const view = mount(<StreamingPanel w={w} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toContain('Each scene has its own streaming key. A key streams video into that scene and nowhere else.')
    expect(view.text()).toContain('Who is allowed to stream in this world at all is set under Permissions → Who can stream.')
    view.unmount()
  })

  it('asks for a publish before it offers a key', () => {
    const w = world()
    const view = mount(<StreamingPanel w={w} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toContain('Streaming keys belong to a scene. Publish a scene to boedo.dcl.eth and its key appears here.')
    expect(signed).not.toHaveBeenCalled()
    view.unmount()
  })
})
