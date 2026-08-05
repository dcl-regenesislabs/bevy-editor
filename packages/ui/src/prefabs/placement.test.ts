import { describe, expect, it } from 'vitest'
import {
  defaultKeepAnchor,
  defaultPlacement,
  instancesOf,
  keepsServerHalf,
  placementIn,
  placementOf,
  sceneInstances,
  PLACEMENT_LABEL,
  PLACEMENT_MODES,
  type PlacementInstance
} from './placement'
import type { PrefabData, PrefabSpawnable } from './format'

function data(over: Partial<PrefabData> = {}): PrefabData {
  return {
    id: 'aaa-111',
    name: 'Zombie Basic',
    category: 'custom',
    tags: [],
    ...over
  } as PrefabData
}

function spawnable(over: Partial<PrefabSpawnable> = {}): PrefabSpawnable {
  return { max: 64, ...over }
}

function instance(over: Partial<PlacementInstance> = {}): PlacementInstance {
  return { entityId: '512', prefabId: 'aaa-111', inert: false, ...over }
}

describe('scanning the scene for instances', () => {
  it('reads the prefab id and the inert marker off each instance root', () => {
    const found = sceneInstances({
      '512': { 'inspector::CustomAsset': { assetId: 'aaa-111' } },
      '513': { 'inspector::CustomAsset': { assetId: 'bbb-222' }, 'inspector::Inert': {} },
      '514': { Transform: {} }
    })
    expect(found).toEqual([
      { entityId: '512', prefabId: 'aaa-111', inert: false },
      { entityId: '513', prefabId: 'bbb-222', inert: true }
    ])
  })

  it('keeps only the instances of the prefab asked about', () => {
    const all = [instance(), instance({ entityId: '600', prefabId: 'bbb-222' })]
    expect(instancesOf(data(), all).map((i) => i.entityId)).toEqual(['512'])
  })
})

describe('the three placement states', () => {
  it('is unplaced with no instance', () => {
    expect(placementOf(data(), [])).toBe('unplaced')
  })

  it('is editor & play with a live instance', () => {
    expect(placementOf(data(), [instance()])).toBe('editorAndPlay')
  })

  it('is editing only when every instance is inert', () => {
    expect(placementOf(data(), [instance({ inert: true })])).toBe('editingOnly')
  })

  it('one live instance among ghosts still means a copy exists at start', () => {
    expect(placementOf(data(), [instance({ inert: true }), instance({ entityId: '520' })])).toBe(
      'editorAndPlay'
    )
  })

  it('counts the instances alongside the state', () => {
    expect(
      placementIn(data(), {
        '512': { 'inspector::CustomAsset': { assetId: 'aaa-111' }, 'inspector::Inert': {} },
        '513': { 'inspector::CustomAsset': { assetId: 'aaa-111' }, 'inspector::Inert': {} }
      })
    ).toEqual({ placement: 'editingOnly', count: 2 })
  })

  it('labels every state in the closed set', () => {
    for (const mode of PLACEMENT_MODES) expect(PLACEMENT_LABEL[mode]).toBeTruthy()
  })
})

describe('the server half', () => {
  it('is implied by an auth-server prefab', () => {
    expect(keepsServerHalf(data({ requiresSdk: 'auth-server' }), [])).toBe(true)
  })

  it('is implied by a script that branches on isServer()', () => {
    expect(keepsServerHalf(data(), ['export class X { start() { if (isServer()) return } }'])).toBe(true)
  })

  it('is not implied by a client-only script', () => {
    expect(keepsServerHalf(data(), ['export class X { update(dt: number) {} }'])).toBe(false)
  })
})

describe('the default when Spawnable is turned on', () => {
  it('keeps no anchor for a big on-demand pool', () => {
    expect(defaultKeepAnchor(data({ spawnable: spawnable({ max: 64 }) }))).toBe(false)
    expect(defaultPlacement(data({ spawnable: spawnable({ max: 64 }) }), [])).toBe('unplaced')
  })

  it('keeps an anchor for a small pool', () => {
    expect(defaultKeepAnchor(data({ spawnable: spawnable({ max: 4 }) }))).toBe(true)
  })

  it('keeps an anchor for a per-player prefab even past the size rule', () => {
    const rig = data({ spawnable: spawnable({ max: 32, instancing: 'perPlayer' }) })
    expect(defaultKeepAnchor(rig)).toBe(true)
  })

  it('places a kept anchor Editor & Play whenever the prefab has a server half', () => {
    const rig = data({
      requiresSdk: 'auth-server',
      spawnable: spawnable({ max: 32, instancing: 'perPlayer' })
    })
    expect(defaultPlacement(rig, [])).toBe('editorAndPlay')
  })

  it('ghosts a kept anchor that is client-only', () => {
    const prop = data({ spawnable: spawnable({ max: 4 }) })
    expect(defaultPlacement(prop, ['export class P { start() {} }'])).toBe('editingOnly')
  })

  it('keeps nothing for a prefab that is not spawnable at all', () => {
    expect(defaultKeepAnchor(data())).toBe(false)
  })
})
