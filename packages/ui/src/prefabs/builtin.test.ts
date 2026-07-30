// Guards the prefabs shipped in packages/desktop/prefabs against drift: they are
// plain folders that nothing in the app imports, so a bad component name or a
// stale {assetPath} would only surface when a creator places one.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { snapshotComponentName } from '../../../scene/src/composite'
import { adminIcons } from '../../../desktop/prefabs/admin-tools/scripts/icons'
import { announcementIcons } from '../../../desktop/prefabs/admin-tools/scripts/tabs/announcements/icons'
import { moderationIcons } from '../../../desktop/prefabs/admin-tools/scripts/tabs/moderation/icons'
import { rewardsIcons } from '../../../desktop/prefabs/admin-tools/scripts/tabs/rewards/icons'
import { videoIcons } from '../../../desktop/prefabs/admin-tools/scripts/tabs/video/icons'
import {
  ASSET_PATH_TOKEN,
  SCRIPT_COMPONENT,
  parsePrefabComposite,
  parsePrefabData,
  prefabLayout,
  isRecord,
  videoPlayerRefSites
} from './format'

const ADMIN_TOOLS = new URL('../../../desktop/prefabs/admin-tools/', import.meta.url)
const VIDEO_SCREEN = new URL('../../../desktop/prefabs/video-screen/', import.meta.url)

function read(name: string, base: URL = ADMIN_TOOLS): string {
  return readFileSync(new URL(name, base), 'utf8')
}

describe('built-in admin-tools prefab', () => {
  const data = parsePrefabData(read('data.json'), 'data.json', 'fallback')
  const composite = parsePrefabComposite(read('composite.json'), 'composite.json')

  it('declares a builtin origin and a stable id', () => {
    expect(data.origin?.source).toBe('builtin')
    expect(data.id).not.toBe('fallback')
    expect(data.name).toBe('Admin Tools')
  })

  it('declares the permissions signedFetch and comms need', () => {
    expect(data.requiredPermissions).toContain('USE_FETCH')
    expect(data.requiredPermissions).toContain('USE_WEB3_API')
  })

  it('uses only component names the editor can write', () => {
    for (const component of composite.components) {
      expect(snapshotComponentName(component.name)).toBeDefined()
    }
  })

  it('is a single-entity prefab with no authored Transform', () => {
    const layout = prefabLayout(composite)
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(layout.entities[0].transform).toBeUndefined()
  })

  it('points its script at a bundled path', () => {
    const script = composite.components.find((c) => c.name === SCRIPT_COMPONENT)
    const value = isRecord(script?.data['0']?.json) ? script?.data['0'].json.value : undefined
    expect(Array.isArray(value)).toBe(true)
    const entry = Array.isArray(value) && isRecord(value[0]) ? value[0] : {}
    expect(entry.path).toBe(`${ASSET_PATH_TOKEN}/scripts/admin.tsx`)
  })

  it('declares the permission the kick control needs', () => {
    expect(data.requiredPermissions).toContain('ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE')
  })

  it('ships every texture its UI code asks for', () => {
    const paths = [
      ...Object.values(adminIcons('')),
      ...Object.values(announcementIcons('')),
      ...Object.values(moderationIcons('')),
      ...Object.values(rewardsIcons('')),
      ...Object.values(videoIcons(''))
    ]
    expect(paths.length).toBeGreaterThan(30)
    expect(paths.filter((path) => !existsSync(new URL(path, ADMIN_TOOLS)))).toEqual([])
  })

  it('resolves textures relative to the placed prefab folder', () => {
    expect(adminIcons('custom/admin-tools_2').panelToggle).toBe(
      'custom/admin-tools_2/icons/admin-panel-control-button.png'
    )
    expect(videoIcons('custom/admin-tools_2').play).toBe(
      'custom/admin-tools_2/icons/video/video-control-play-button.png'
    )
  })

  it('carries the AdminTools config with every control section', () => {
    const admin = composite.components.find((c) => c.name === 'asset-packs::AdminTools')
    const json = admin?.data['0']?.json
    expect(isRecord(json)).toBe(true)
    expect(Object.keys(isRecord(json) ? json : {})).toEqual([
      'adminPermissions',
      'authorizedAdminUsers',
      'moderationControl',
      'textAnnouncementControl',
      'videoControl',
      'smartItemsControl',
      'rewardsControl'
    ])
  })
})

describe('built-in video-screen prefab', () => {
  const data = parsePrefabData(read('data.json', VIDEO_SCREEN), 'data.json', 'fallback')
  const composite = parsePrefabComposite(read('composite.json', VIDEO_SCREEN), 'composite.json')

  it('declares a builtin origin and a stable id', () => {
    expect(data.origin?.source).toBe('builtin')
    expect(data.id).not.toBe('fallback')
    expect(data.name).toBe('Video Screen')
  })

  it('uses only component names the editor can write', () => {
    for (const component of composite.components) {
      expect(snapshotComponentName(component.name)).toBeDefined()
    }
  })

  it('ships the model its GltfContainer points at', () => {
    const gltf = composite.components.find((c) => c.name === 'core::GltfContainer')
    const json = gltf?.data['0']?.json
    const src = isRecord(json) && typeof json.src === 'string' ? json.src : ''
    expect(src.startsWith(`${ASSET_PATH_TOKEN}/`)).toBe(true)
    expect(existsSync(new URL(src.replace(`${ASSET_PATH_TOKEN}/`, ''), VIDEO_SCREEN))).toBe(true)
  })

  it('streams its material from its own VideoPlayer via {self}', () => {
    const modifiers = composite.components.find((c) => c.name === 'core::GltfNodeModifiers')
    expect(videoPlayerRefSites(modifiers?.data['0']?.json).map((s) => s.read())).toEqual(['{self}'])
    expect(composite.components.some((c) => c.name === 'core::VideoPlayer')).toBe(true)
  })

  it('carries a VideoScreen config for the admin message bus, in registry field order', () => {
    const screen = composite.components.find((c) => c.name === 'asset-packs::VideoScreen')
    const json = screen?.data['0']?.json
    expect(Object.keys(isRecord(json) ? json : {})).toEqual([
      'thumbnail',
      'defaultMediaSource',
      'defaultURL'
    ])
  })
})
