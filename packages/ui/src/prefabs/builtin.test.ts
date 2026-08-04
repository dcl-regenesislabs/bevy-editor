// Guards the prefabs shipped in packages/desktop/prefabs against drift: they are
// plain folders that nothing in the app imports, so a bad component name or a
// stale {assetPath} would only surface when a creator places one.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { snapshotComponentName } from '../../../scene/src/composite'
import { getScriptParams } from '../script/parser'
import { TRIGGER_ZONE_REF } from './builtin-refs'
import {
  PREFABS_ROOT,
  filesUnder,
  hasRuntimeModules,
  prefabDirs,
  prefabFolders,
  readPrefabFile as read
} from './builtin-fixtures'
import { insideZone } from '../../../desktop/prefabs/trigger-zone-server/scripts/zone-geometry'
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

const ADMIN_TOOLS = new URL('admin-tools/', PREFABS_ROOT)
const VIDEO_SCREEN = new URL('video-screen/', PREFABS_ROOT)

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
  const data = parsePrefabData(read('data.json', ADMIN_TOOLS), 'data.json', 'fallback')
  const composite = parsePrefabComposite(read('composite.json', ADMIN_TOOLS), 'composite.json')

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

  // 23 copies of one file: a fix applied to the seat a creator reported and not to
  // the other 22 is the same drift the carried-runtime test catches for runtime
  // modules, and nothing else guards these. The one sanctioned per-seat difference
  // is the SCENE_EMOTES list (only sit-spot-edge ships its own emotes), so that
  // line is normalized away and everything else must match byte for byte.
  const EMOTES_LINE = /^const SCENE_EMOTES: string\[\] = .*$/m

  function seatBody(folder: string): string {
    const source = read(`${folder}/scripts/seat.ts`, PREFABS_ROOT)
    expect(source, `${folder}/scripts/seat.ts has no SCENE_EMOTES line`).toMatch(EMOTES_LINE)
    return source.replace(EMOTES_LINE, 'const SCENE_EMOTES: string[] = []')
  }

  it('carries the same seat.ts in every folder', () => {
    const master = seatBody(seats[0])
    expect(master.length).toBeGreaterThan(200)
    for (const folder of seats) {
      expect(seatBody(folder), `${folder}/scripts/seat.ts drifted from ${seats[0]}`).toBe(master)
    }
  })

  it('ships every scene emote a seat lists', () => {
    for (const folder of seats) {
      const line = EMOTES_LINE.exec(read(`${folder}/scripts/seat.ts`, PREFABS_ROOT))?.[0] ?? ''
      for (const rel of line.match(/'([^']+\.glb)'/g) ?? []) {
        const path = rel.slice(1, -1)
        expect(existsSync(new URL(`${folder}/${path}`, PREFABS_ROOT)), `${folder}/${path}`).toBe(true)
      }
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

describe('built-in trigger-zone prefab', () => {
  const TRIGGER_ZONE = new URL('trigger-zone/', PREFABS_ROOT)
  const data = parsePrefabData(read('data.json', TRIGGER_ZONE), 'trigger-zone', 'trigger-zone')
  const composite = parsePrefabComposite(read('composite.json', TRIGGER_ZONE), 'trigger-zone')

  it('declares a builtin origin and a stable id', () => {
    expect(data.origin?.source).toBe('builtin')
    expect(data.id).toBe('f1794ec8-ed62-42c8-a71b-6c52e04b161a')
    expect(data.name).toBe('Trigger Zone')
  })

  it('works serverless — the base zone needs no SDK and no permissions', () => {
    expect(data.requiresSdk).toBeUndefined()
    expect(data.requiredPermissions ?? []).toEqual([])
  })

  it('ships a 4x3x4 volume and no position — the drop point places it', () => {
    const layout = prefabLayout(composite)
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(layout.entities[0].transform?.scale).toEqual({ x: 4, y: 3, z: 4 })
    expect(layout.entities[0].transform?.position).toBeUndefined()
  })

  it('detects the local avatar only by default (box, mask 8)', () => {
    const area = composite.components.find((c) => c.name === 'core::TriggerArea')
    expect(area?.data['0']?.json).toEqual({ mesh: 0, collisionMask: 8 })
  })

  it('names the entity, because the name is the zone id', () => {
    const name = composite.components.find((c) => c.name === 'core-schema::Name')
    expect(name?.data['0']?.json).toEqual({ value: 'Trigger Zone' })
  })

  it('points at the detector script with a layout stub placement fills in', () => {
    const script = composite.components.find((c) => c.name === SCRIPT_COMPONENT)
    const json = script?.data['0']?.json
    const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
    const entry = isRecord(value[0]) ? value[0] : {}
    expect(entry.path).toBe(`${ASSET_PATH_TOKEN}/scripts/trigger-zone.ts`)
    expect(entry.layout).toBe('{"params":{},"actions":[]}')
    expect(existsSync(new URL('scripts/trigger-zone.ts', TRIGGER_ZONE))).toBe(true)
  })

  // The toolbar button places this prefab by ref, not by browsing the drawer, so
  // the folder name is part of the contract — renaming it breaks one click only.
  it('is reachable by the ref the toolbar places', () => {
    const [scope, folder] = TRIGGER_ZONE_REF.split(':')
    expect(scope).toBe('builtin')
    expect(prefabFolders()).toContain(folder)
    expect(prefabData(folder).id).toBe(data.id)
  })

  // No zoneId param: two spellings of the same zone is the failure mode this
  // prefab exists to remove, so the entity's name is the only id.
  it('exposes who / fireWhen / exitDelay and nothing else', () => {
    const { params, error } = getScriptParams(read('scripts/trigger-zone.ts', TRIGGER_ZONE))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['who', 'fireWhen', 'exitDelay'])
    expect(params.who.options).toEqual(['this player', 'any player'])
    expect(params.fireWhen.options).toEqual(['every time', 'once per player', 'once ever'])
    expect(params.exitDelay.type).toBe('number')
    expect(params.exitDelay.value).toBe(0.3)
  })

  // "cooldown" is what a REACTION calls its own rate limit. The zone's hysteresis
  // must not wear the same name, or the inspector shows two of them side by side.
  it('keeps the zone name and rate-limit words out of its own params', () => {
    const { params } = getScriptParams(read('scripts/trigger-zone.ts', TRIGGER_ZONE))
    expect(Object.keys(params)).not.toContain('cooldown')
    expect(Object.keys(params)).not.toContain('zoneId')
  })

  // Three settings is few enough to show at once; a disclosure that hides two of
  // them buys nothing but a click and a place for settings to go missing.
  it('keeps all three settings in the open', () => {
    const { params } = getScriptParams(read('scripts/trigger-zone.ts', TRIGGER_ZONE))
    for (const param of Object.values(params)) expect(param).not.toHaveProperty('advanced')
  })
})

describe('built-in trigger-zone-server prefab', () => {
  const AUTHORITY = new URL('trigger-zone-server/', PREFABS_ROOT)
  const data = parsePrefabData(read('data.json', AUTHORITY), 'trigger-zone-server', 'trigger-zone-server')
  const composite = parsePrefabComposite(read('composite.json', AUTHORITY), 'trigger-zone-server')

  it('declares a builtin origin and a stable id', () => {
    expect(data.origin?.source).toBe('builtin')
    expect(data.id).toBe('8d8d94f3-7d15-4cdf-87d3-5a51590cbef9')
    expect(data.name).toBe('Zone Authority')
  })

  // The script imports @dcl/sdk/network at module scope, so on an SDK without
  // the auth-server APIs it bundles and then throws inside a file the creator
  // never wrote. requiresSdk is what makes the editor offer the install first.
  it('needs the auth-server SDK and no scene permissions', () => {
    expect(data.requiresSdk).toBe('auth-server')
    expect(data.requiredPermissions ?? []).toEqual([])
  })

  // A verified zone is a rare need next to a plain one; the group tile keeps it
  // one level below the Trigger Zone card instead of beside it.
  it('is not a peer card of Trigger Zone in the drawer', () => {
    expect(data.group).toBe('Multiplayer Server')
    expect(prefabData('trigger-zone').group).toBeUndefined()
  })

  it('is a single invisible entity with no authored Transform', () => {
    const layout = prefabLayout(composite)
    expect(layout.entities.map((entity) => entity.localId)).toEqual(['0'])
    expect(layout.entities[0].transform).toBeUndefined()
    expect(composite.components.some((c) => c.name === 'core::TriggerArea')).toBe(false)
  })

  it('points at the authority script with a layout stub placement fills in', () => {
    const script = composite.components.find((c) => c.name === SCRIPT_COMPONENT)
    const json = script?.data['0']?.json
    const value = isRecord(json) && Array.isArray(json.value) ? json.value : []
    const entry = isRecord(value[0]) ? value[0] : {}
    expect(entry.path).toBe(`${ASSET_PATH_TOKEN}/scripts/trigger-zone-server.ts`)
    expect(entry.layout).toBe('{"params":{},"actions":[]}')
    expect(existsSync(new URL('scripts/trigger-zone-server.ts', AUTHORITY))).toBe(true)
  })

  it('exposes slack and rejection logging, and nothing else', () => {
    const { params, error } = getScriptParams(read('scripts/trigger-zone-server.ts', AUTHORITY))
    expect(error).toBeUndefined()
    expect(Object.keys(params)).toEqual(['slack', 'logRejections'])
    expect(params.slack.type).toBe('number')
    expect(params.slack.value).toBe(1)
    expect(params.logRejections.type).toBe('boolean')
  })

  // Identity comes from context.from, never from the payload: a caller can name
  // a zone, never a player.
  it('verifies the caller the transport authenticated, not the payload', () => {
    const source = read('scripts/zone-authority.ts', AUTHORITY)
    expect(source).toContain("rpc.handle('zone.enter'")
    expect(source).toContain('playerPosition(address)')
    expect(source).not.toMatch(/body\.address|body\.from|body\.player/)
  })

  it('carries the rpc + player-position graph and nothing it does not import', () => {
    const carried = filesUnder(new URL('trigger-zone-server/scripts/runtime/', PREFABS_ROOT)).sort()
    expect(carried).toEqual(['playerPositions.ts', 'pure/pending.ts', 'pure/zoneRegistry.ts', 'rpc.ts'])
  })

  describe('point-in-volume verification', () => {
    const center = { x: 8, y: 1.5, z: 8 }
    const upright = { x: 0, y: 0, z: 0, w: 1 }
    const box = { x: 4, y: 3, z: 4 }

    it('accepts the middle and rejects a player 20 m away', () => {
      expect(insideZone('box', center, center, upright, box, 0)).toBe(true)
      expect(insideZone('box', { x: 28, y: 1.5, z: 8 }, center, upright, box, 1)).toBe(false)
    })

    it('forgives the slack margin at the edge, and only that much', () => {
      const justOutside = { x: 8, y: 1.5, z: 10.8 }
      expect(insideZone('box', justOutside, center, upright, box, 0)).toBe(false)
      expect(insideZone('box', justOutside, center, upright, box, 1)).toBe(true)
      expect(insideZone('box', { x: 8, y: 1.5, z: 11.5 }, center, upright, box, 1)).toBe(false)
    })

    it('follows the zone rotation', () => {
      // a quarter turn about Y swaps the long axis onto Z
      const spun = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
      const thin = { x: 8, y: 3, z: 1 }
      expect(insideZone('box', { x: 8, y: 1.5, z: 11 }, center, spun, thin, 0)).toBe(true)
      expect(insideZone('box', { x: 11, y: 1.5, z: 8 }, center, spun, thin, 0)).toBe(false)
    })

    it('treats a sphere zone as the ellipsoid its scale describes', () => {
      expect(insideZone('sphere', { x: 9.9, y: 1.5, z: 8 }, center, upright, box, 0)).toBe(true)
      expect(insideZone('sphere', { x: 9.9, y: 1.5, z: 9.9 }, center, upright, box, 0)).toBe(false)
    })

    it('has no inside when an axis was scaled to nothing', () => {
      expect(insideZone('box', center, center, upright, { x: 4, y: 0, z: 4 }, 1)).toBe(false)
    })
  })
})

describe('carried runtime modules', () => {
  // Prefabs carry copies of packages/desktop/runtime-modules/* next to their
  // scripts. Copies must stay byte-identical to the masters: a fix that lands
  // in the master without re-syncing every embedded copy is exactly the drift
  // this repo's three source games shipped.
  const MASTERS = new URL('../../../desktop/runtime-modules/', import.meta.url)
  const carriers = prefabDirs().filter(hasRuntimeModules)

  it('at least one prefab carries runtime modules', () => {
    expect(carriers.length).toBeGreaterThan(0)
  })

  it('trigger-zone carries the whole zone-bus import graph', () => {
    const carried = filesUnder(new URL('trigger-zone/scripts/runtime/', PREFABS_ROOT)).sort()
    expect(carried).toEqual(['pure/membership.ts', 'pure/zoneRegistry.ts', 'zoneBus.ts'])
  })

  it('every embedded copy is byte-identical to its master', () => {
    for (const folder of carriers) {
      const dir = new URL(`${folder}/scripts/runtime/`, PREFABS_ROOT)
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

// The card tooltip is the only place a creator learns what a prefab does before
// placing it. Without a description it falls back to the same placement hint on
// every card, which tells them nothing.
describe('every built-in describes itself', () => {
  it('has a description that is not just the name', () => {
    for (const folder of prefabFolders()) {
      const data = JSON.parse(read('data.json', new URL(`${folder}/`, PREFABS_ROOT))) as {
        name: string
        description?: string
      }
      expect(data.description, `${folder} has no description`).toBeTruthy()
      expect((data.description ?? '').length, `${folder}'s description is too short`).toBeGreaterThan(20)
      expect(data.description).not.toBe(data.name)
    }
  })
})
