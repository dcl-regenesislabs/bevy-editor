import { describe, expect, it } from 'vitest'
import { instancesOf, keepsServerHalf, sceneInstances, type PlacementInstance } from './placement'
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
  return { entityId: '512', prefabId: 'aaa-111', ...over }
}

describe('scanning the scene for instances', () => {
  it('reads the prefab id and the inert marker off each instance root', () => {
    const found = sceneInstances({
      '512': { 'inspector::CustomAsset': { assetId: 'aaa-111' } },
      '513': { 'inspector::CustomAsset': { assetId: 'bbb-222' }, 'inspector::Inert': {} },
      '514': { Transform: {} }
    })
    expect(found).toEqual([
      { entityId: '512', prefabId: 'aaa-111' },
      { entityId: '513', prefabId: 'bbb-222' }
    ])
  })

  it('keeps only the instances of the prefab asked about', () => {
    const all = [instance(), instance({ entityId: '600', prefabId: 'bbb-222' })]
    expect(instancesOf(data(), all).map((i) => i.entityId)).toEqual(['512'])
  })
})

describe('the server half', () => {
  it('is implied by an auth-server prefab', () => {
    expect(keepsServerHalf(data({ requiresSdk: 'auth-server' }), [])).toBe(true)
  })

  it('is implied by a script with work inside its isServer() region', () => {
    expect(keepsServerHalf(data(), ['export class X { start() { if (isServer()) { this.arm() } } }'])).toBe(true)
  })

  // The scaffold writes the token into every script, so the token alone would
  // raise a blocker on every spawn-only item in every project.
  it('is not implied by a script that stands its server half down', () => {
    expect(keepsServerHalf(data(), ['export class X { start() { if (isServer()) return } }'])).toBe(false)
  })

  it('is not implied by a client-only script', () => {
    expect(keepsServerHalf(data(), ['export class X { update(dt: number) {} }'])).toBe(false)
  })
})

