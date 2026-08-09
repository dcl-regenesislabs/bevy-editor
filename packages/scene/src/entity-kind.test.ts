import { describe, expect, it } from 'vitest'
import { describeEntity, entityIcon } from './entity-kind'
import { NAME_COMPONENT } from './custom-components'
import { SCRIPT_COMPONENT } from './allowed-components'
import type { Snapshot } from './state'

const snap = (comps: Record<string, unknown>): Snapshot => ({ '512': comps })
const kind = (comps: Record<string, unknown>, hasChildren = false): ReturnType<typeof describeEntity> =>
  describeEntity(snap(comps), '512', hasChildren)

describe('describeEntity', () => {
  it('prefers an author-supplied name over any derivation', () => {
    const k = kind({ [NAME_COMPONENT]: { value: 'Corner Bench' }, GltfContainer: { src: 'assets/Chairwood_02.glb' } })
    expect(k).toMatchObject({ primary: 'Corner Bench', derived: false, detail: 'Chairwood_02' })
  })

  it('derives the model basename without its extension', () => {
    expect(kind({ GltfContainer: { src: 'assets/models/Fountain_Stone_01.gltf' } })).toMatchObject({
      primary: 'Fountain_Stone_01',
      derived: true,
      detail: 'model'
    })
  })

  it('reads a primitive mesh from the engine-form oneof', () => {
    expect(kind({ MeshRenderer: { mesh: { box: {} } } }).primary).toBe('Box')
    expect(kind({ MeshRenderer: { mesh: { sphere: {} } } }).primary).toBe('Sphere')
    expect(kind({ MeshRenderer: { mesh: { cylinder: {} } } }).primary).toBe('Cylinder')
  })

  it('ignores null oneof branches rather than picking the first key', () => {
    expect(kind({ MeshRenderer: { mesh: { box: null, sphere: {} } } }).primary).toBe('Sphere')
  })

  it('uses the content as the identity for text', () => {
    expect(kind({ TextShape: { text: 'Press E to sit' } })).toMatchObject({ primary: '"Press E to sit"', detail: 'text' })
  })

  it('clips long text', () => {
    const k = kind({ TextShape: { text: 'x'.repeat(60) } })
    expect(k.primary.length).toBeLessThanOrEqual(31)
    expect(k.primary.endsWith('…"')).toBe(true)
  })

  it('names audio clips and streams', () => {
    expect(kind({ AudioSource: { audioClipUrl: 'sounds/bell.mp3' } })).toMatchObject({ primary: 'bell', detail: 'sound' })
    expect(kind({ AudioStream: { url: 'https://radio.example.com/live' } })).toMatchObject({
      primary: 'radio.example.com',
      detail: 'stream'
    })
  })

  it('keeps the extension on video, which has no meaningful basename otherwise', () => {
    expect(kind({ VideoPlayer: { src: 'media/intro.mp4' } }).primary).toBe('intro.mp4')
  })

  it('shortens an NFT urn to contract:token', () => {
    expect(kind({ NftShape: { urn: 'urn:decentraland:ethereum:erc721:0xabc:42' } }).primary).toBe('0xabc:42')
  })

  it('treats any Ui* component as a UI node', () => {
    expect(kind({ UiTransform: {} }).detail).toBe('ui')
    expect(kind({ UiTransform: {}, UiText: { value: 'Score' } }).primary).toBe('"Score"')
  })

  it('falls back to a click target, then a group, then a node', () => {
    expect(kind({ PointerEvents: { pointerEvents: [{ eventInfo: { hoverText: 'Sit' } }] } }).primary).toBe('Click: "Sit"')
    expect(kind({ PointerEvents: { pointerEvents: [{}] } }).primary).toBe('Click target')
    expect(kind({ Transform: {} }, true).primary).toBe('Group')
    expect(kind({ Transform: {} }, false).primary).toBe('Node')
    expect(kind({}).primary).toBe('Node')
  })

  // 247 transform-only anchors on one real scene: without the id every one of
  // them is the same row, and the tree becomes a wall you can't navigate.
  it('makes transform-only nodes tellable apart by id', () => {
    const s: Snapshot = { '517': { Transform: {} }, '518': { Transform: {} } }
    expect(describeEntity(s, '517', false).detail).toBe('#517')
    expect(describeEntity(s, '518', false).detail).toBe('#518')
  })

  it('names the reserved engine entities instead of their component names', () => {
    const s: Snapshot = { '1': { AvatarBase: {}, Transform: {} }, '2': { CameraMode: {} }, '5': { Transform: {} } }
    expect(describeEntity(s, '1', false).primary).toBe('Player')
    expect(describeEntity(s, '2', false).primary).toBe('Camera')
    expect(describeEntity(s, '5', false).primary).toBe('Engine')
  })

  it('never returns a bare entity id as the primary label', () => {
    const k = kind({ 'myscene::Tags': { list: [] } })
    expect(k.primary).toBe('Tags')
    expect(k.detail).toBe('#512')
  })

  it('strips the version from the last-resort id', () => {
    // ids are version-packed: (index & 0xffff) | (version << 16)
    const s: Snapshot = { '65548': { 'x::Y': {} } }
    expect(describeEntity(s, '65548', false).detail).toBe('#12')
  })

})

describe('entityIcon', () => {
  const icon = (comps: Record<string, unknown>): ReturnType<typeof entityIcon> => entityIcon(snap(comps), '512')

  it('reads each kind off its components', () => {
    expect(icon({ GltfContainer: { src: 'a.glb' } })).toBe('model')
    expect(icon({ MeshRenderer: { mesh: { box: {} } } })).toBe('model')
    expect(icon({ AudioSource: { audioClipUrl: 'a.mp3' } })).toBe('sound')
    expect(icon({ AudioStream: { url: 'https://x/y' } })).toBe('sound')
    expect(icon({ VideoPlayer: { src: 'a.mp4' } })).toBe('video')
    expect(icon({ TextShape: { text: 'Press E' } })).toBe('text')
    expect(icon({ AvatarShape: { name: 'Guide' } })).toBe('avatar')
    expect(icon({ LightSource: { type: { point: {} } } })).toBe('light')
    expect(icon({ [SCRIPT_COMPONENT]: {} })).toBe('script')
  })

  // These co-occur constantly, so the priority order is the actual behaviour.
  it('picks the most specific kind when components co-occur', () => {
    const screen = { MeshRenderer: { mesh: { plane: {} } }, VideoPlayer: { src: 'a.mp4' }, AudioStream: { url: 'x' } }
    expect(icon(screen)).toBe('video')
    expect(icon({ ...screen, [SCRIPT_COMPONENT]: {} })).toBe('script')
    expect(icon({ GltfContainer: { src: 'npc.glb' }, AvatarShape: { name: 'Guide' } })).toBe('avatar')
    expect(icon({ MeshRenderer: { mesh: { plane: {} } }, TextShape: { text: 'Sign' } })).toBe('text')
  })

  it('falls back to other, including for a transform-only node', () => {
    expect(icon({})).toBe('other')
    expect(icon({ Transform: { position: { x: 0, y: 0, z: 0 } } })).toBe('other')
  })

  it('calls a scripted model a script — behaviour is what a creator scans for', () => {
    expect(icon({ GltfContainer: { src: 'door.glb' }, [SCRIPT_COMPONENT]: {} })).toBe('script')
  })
})
