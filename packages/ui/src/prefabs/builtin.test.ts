// Guards the prefabs shipped in packages/desktop/prefabs against drift: they are
// plain folders that nothing in the app imports, so a bad component name or a
// stale {assetPath} would only surface when a creator places one.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  compareVersions,
  parsePrefabComposite,
  parsePrefabData,
  prefabLayout,
  isRecord,
  videoPlayerRefSites,
  type PrefabComposite,
  type PrefabData
} from './format'

const PREFABS_ROOT = new URL('../../../desktop/prefabs/', import.meta.url)
const ADMIN_TOOLS = new URL('admin-tools/', PREFABS_ROOT)
const VIDEO_SCREEN = new URL('video-screen/', PREFABS_ROOT)

function read(name: string, base: URL = ADMIN_TOOLS): string {
  return readFileSync(new URL(name, base), 'utf8')
}

function prefabFolders(): string[] {
  return readdirSync(fileURLToPath(PREFABS_ROOT), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(new URL(`${e.name}/data.json`, PREFABS_ROOT)))
    .map((e) => e.name)
    .sort()
}

function prefabData(folder: string): PrefabData {
  return parsePrefabData(read(`${folder}/data.json`, PREFABS_ROOT), folder, 'fallback')
}

function prefabComposite(folder: string): PrefabComposite {
  return parsePrefabComposite(read(`${folder}/composite.json`, PREFABS_ROOT), folder)
}

// the seat script finds its spots by name at runtime — same rule here
function isSpotName(json: unknown): boolean {
  if (!isRecord(json) || typeof json.value !== 'string') return false
  return json.value.toLowerCase().startsWith('sit spot')
}

function assetPaths(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.startsWith(`${ASSET_PATH_TOKEN}/`)) out.push(value.slice(ASSET_PATH_TOKEN.length + 1))
    return out
  }
  if (value === null || typeof value !== 'object') return out
  for (const item of Object.values(value)) assetPaths(item, out)
  return out
}

describe('every built-in prefab', () => {
  const folders = prefabFolders()

  it('exists in plural', () => {
    expect(folders.length).toBeGreaterThan(20)
  })

  it('declares a builtin origin and a unique stable id', () => {
    const ids = new Set<string>()
    for (const folder of folders) {
      const data = prefabData(folder)
      expect(data.origin?.source, folder).toBe('builtin')
      expect(data.id, folder).not.toBe('fallback')
      expect(ids.has(data.id), `${folder} reuses an id`).toBe(false)
      ids.add(data.id)
    }
  })

  it('uses only component names the editor can write', () => {
    for (const folder of folders) {
      const composite = prefabComposite(folder)
      for (const component of composite.components) {
        expect(snapshotComponentName(component.name), `${folder}: ${component.name}`).toBeDefined()
      }
    }
  })

  it('carries a semver version whose changelog is non-empty and current', () => {
    for (const folder of folders) {
      const data = prefabData(folder)
      expect(data.version, folder).toMatch(/^\d+\.\d+\.\d+$/)
      const changelog = data.changelog ?? []
      expect(changelog.length, `${folder} has no changelog`).toBeGreaterThan(0)
      const latest = [...changelog].sort((a, b) => compareVersions(b.version, a.version))[0]
      expect(latest.version, `${folder} version drifted from its changelog`).toBe(data.version)
      for (const entry of changelog) {
        expect(entry.version, folder).toMatch(/^\d+\.\d+\.\d+$/)
        expect(entry.notes.trim(), `${folder} ${entry.version} has empty notes`).not.toBe('')
      }
    }
  })

  it('ships a thumbnail — built-ins never show as a guess-what glyph', () => {
    for (const folder of folders) {
      expect(existsSync(new URL(`${folder}/thumbnail.png`, PREFABS_ROOT)), folder).toBe(true)
    }
  })

  it('ships every {assetPath} file its composite references', () => {
    for (const folder of folders) {
      for (const rel of assetPaths(prefabComposite(folder).components)) {
        expect(existsSync(new URL(`${folder}/${rel}`, PREFABS_ROOT)), `${folder}/${rel}`).toBe(true)
      }
    }
  })
})

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

describe('built-in seat prefabs', () => {
  // the Prefabs tab collapses them by this group — losing it on one folder is
  // exactly the drift this suite is here to catch, hence the exact count
  const seats = prefabFolders().filter((f) => prefabData(f).group === 'Seats')

  it('ships all 22 seats plus the Plaza-style edge spot', () => {
    expect(seats.length).toBe(23)
    expect(seats).toContain('sit-spot-edge')
  })

  it('declares the sit permissions and carries the seat script', () => {
    for (const folder of seats) {
      const data = prefabData(folder)
      expect(data.requiredPermissions, folder).toContain('ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE')
      expect(data.requiredPermissions, folder).toContain('ALLOW_TO_TRIGGER_AVATAR_EMOTE')
      const composite = prefabComposite(folder)
      const script = composite.components.find((c) => c.name === SCRIPT_COMPONENT)
      const value = isRecord(script?.data['0']?.json) ? script?.data['0'].json.value : undefined
      const entry = Array.isArray(value) && isRecord(value[0]) ? value[0] : {}
      expect(entry.path, folder).toBe(`${ASSET_PATH_TOKEN}/scripts/seat.ts`)
    }
  })

  it('gives every named sit spot a transform (and models at least one spot)', () => {
    for (const folder of seats) {
      const composite = prefabComposite(folder)
      const names = composite.components.find((c) => c.name === 'core-schema::Name')?.data ?? {}
      const transforms = composite.components.find((c) => c.name === 'core::Transform')?.data ?? {}
      const spotIds = Object.entries(names)
        .filter(([localId, entry]) => localId !== '0' && isSpotName(entry.json))
        .map(([localId]) => localId)
      for (const localId of spotIds) {
        expect(transforms[localId], `${folder} spot ${localId}`).toBeDefined()
      }
      const hasModel = composite.components.some((c) => c.name === 'core::GltfContainer')
      if (hasModel) expect(spotIds.length, folder).toBeGreaterThan(0)
    }
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

describe('built-in server-clock prefab', () => {
  const SERVER_CLOCK = new URL('server-clock/', PREFABS_ROOT)
  const data = parsePrefabData(read('data.json', SERVER_CLOCK), 'server-clock', 'server-clock')
  const composite = parsePrefabComposite(read('composite.json', SERVER_CLOCK), 'server-clock')

  it('declares a builtin origin and a stable id', () => {
    expect(data.origin?.source).toBe('builtin')
    expect(data.id).toBe('9e37c253-b33e-4505-8231-530f62715d21')
  })

  it('is a single-entity prefab with no authored Transform — drop position places it', () => {
    const ids = new Set(composite.components.flatMap((c) => Object.keys(c.data)))
    expect([...ids]).toEqual(['0'])
    expect(composite.components.some((c) => c.name === 'core::Transform')).toBe(false)
  })

  it('points its script at a bundled path and needs no permissions', () => {
    const script = composite.components.find((c) => c.name === SCRIPT_COMPONENT)
    const json = script?.data['0']?.json
    const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
    expect(isRecord(value[0]) && value[0].path).toBe('{assetPath}/scripts/server-clock.ts')
    expect(existsSync(new URL('scripts/server-clock.ts', SERVER_CLOCK))).toBe(true)
    expect(data.requiredPermissions ?? []).toEqual([])
  })

  it('shows a placeholder time before the first sync', () => {
    const text = composite.components.find((c) => c.name === 'core::TextShape')
    const json = text?.data['0']?.json
    expect(isRecord(json) && typeof json.text === 'string' && json.text.includes('--:--:--')).toBe(true)
  })
})

describe('carried runtime modules', () => {
  // Prefabs carry copies of packages/desktop/runtime-modules/* next to their
  // scripts. Copies must stay byte-identical to the masters: a fix that lands
  // in the master without re-syncing every embedded copy is exactly the drift
  // this repo's three source games shipped.
  const MASTERS = new URL('../../../desktop/runtime-modules/', import.meta.url)

  function embeddedRuntimeDirs(): URL[] {
    const dirs: URL[] = []
    for (const slug of readdirSync(fileURLToPath(PREFABS_ROOT))) {
      const candidate = new URL(`${slug}/scripts/runtime/`, PREFABS_ROOT)
      if (existsSync(fileURLToPath(candidate))) dirs.push(candidate)
    }
    return dirs
  }

  function filesUnder(root: URL, base = ''): string[] {
    const out: string[] = []
    for (const entry of readdirSync(fileURLToPath(new URL(base, root)), { withFileTypes: true })) {
      const rel = `${base}${entry.name}`
      if (entry.isDirectory()) out.push(...filesUnder(root, `${rel}/`))
      else out.push(rel)
    }
    return out
  }

  it('at least one prefab carries runtime modules', () => {
    expect(embeddedRuntimeDirs().length).toBeGreaterThan(0)
  })

  it('every embedded copy is byte-identical to its master', () => {
    for (const dir of embeddedRuntimeDirs()) {
      for (const rel of filesUnder(dir)) {
        const master = new URL(rel, MASTERS)
        expect(existsSync(fileURLToPath(master)), `${rel} has no master in runtime-modules/`).toBe(true)
        expect(readFileSync(new URL(rel, dir), 'utf8'), `${fileURLToPath(dir)}${rel} drifted from master`).toBe(
          readFileSync(master, 'utf8')
        )
      }
    }
  })
})
