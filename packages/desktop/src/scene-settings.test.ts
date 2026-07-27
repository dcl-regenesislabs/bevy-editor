import { describe, expect, it } from 'vitest'
import { applySettings, extractSettings, validateSettings } from './scene-settings'
import type { SceneSettings } from '@dcl-editor/contract'

// shaped like a real project's scene.json (towerofmadness), including fields
// the editor doesn't model — those must round-trip untouched
const RAW = {
  ecs7: true,
  runtimeVersion: '7',
  display: {
    title: 'Tower of Madness',
    description: 'Multiplayer Tower Climbing Challenge',
    favicon: 'favicon_asset',
    navmapThumbnail: 'assets/images/TOM-Thumbnail.png'
  },
  owner: '',
  contact: { name: 'SDK', email: '' },
  main: 'bin/index.js',
  scene: { parcels: ['0,0', '1,0'], base: '0,0' },
  spawnPoints: [
    {
      name: 'Spawn Point 1',
      default: true,
      position: { x: [28.4], y: [0], z: [50, 56] },
      cameraTarget: { x: 30, y: 1, z: 54 }
    }
  ],
  worldConfiguration: { name: 'boedo.dcl.eth' },
  authoritativeMultiplayer: true
}

const settings = (over: Partial<SceneSettings> = {}): SceneSettings => ({
  ...extractSettings(RAW),
  thumbnail: null,
  ...over
})

describe('extractSettings', () => {
  it('reads the editable subset, collapsing axis ranges to midpoints', () => {
    const s = extractSettings(RAW)
    expect(s.title).toBe('Tower of Madness')
    expect(s.thumbnailPath).toBe('assets/images/TOM-Thumbnail.png')
    expect(s.contactName).toBe('SDK')
    expect(s.parcels).toEqual(['0,0', '1,0'])
    expect(s.base).toBe('0,0')
    expect(s.spawnPoints[0].position).toEqual({ x: 28.4, y: 0, z: 53 })
    expect(s.spawnPoints[0].cameraTarget).toEqual({ x: 30, y: 1, z: 54 })
  })
})

describe('validateSettings', () => {
  it('accepts the extracted settings as-is', () => {
    expect(validateSettings(settings())).toBeNull()
  })
  it('rejects a base outside the parcels', () => {
    expect(validateSettings(settings({ base: '9,9' }))).toMatch(/base parcel/)
  })
  it('rejects malformed and duplicate parcels and an empty title', () => {
    expect(validateSettings(settings({ parcels: ['0,0', 'a,b'] }))).toMatch(/not a valid parcel/)
    expect(validateSettings(settings({ parcels: ['0,0', '0,0'] }))).toMatch(/Duplicate/)
    expect(validateSettings(settings({ title: '  ' }))).toMatch(/needs a name/)
  })
})

describe('applySettings', () => {
  it('merges edits while preserving everything the editor does not model', () => {
    const out = applySettings(RAW, settings({ title: 'Renamed', parcels: ['0,0'], base: '0,0' }))
    expect(out.display?.title).toBe('Renamed')
    expect(out.display?.favicon).toBe('favicon_asset') // unknown display key kept
    expect(out.scene?.parcels).toEqual(['0,0'])
    expect(out.worldConfiguration).toEqual({ name: 'boedo.dcl.eth' }) // top-level kept
    expect(out.authoritativeMultiplayer).toBe(true)
    expect(RAW.scene.parcels).toEqual(['0,0', '1,0']) // input not mutated
  })
  it('writes spawn points as plain numbers and drops a removed cameraTarget', () => {
    const s = settings()
    s.spawnPoints[0] = { ...s.spawnPoints[0], cameraTarget: undefined }
    const out = applySettings(RAW, s)
    expect(out.spawnPoints?.[0]).toEqual({
      name: 'Spawn Point 1',
      default: true,
      position: { x: 28.4, y: 0, z: 53 }
    })
  })
})
