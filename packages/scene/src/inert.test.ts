import { describe, expect, it } from 'vitest'
import { INERT_COMPONENT, inertSubtree, projectInert, type AuthoredData } from './inert'

const SCRIPT = 'asset-packs::Script'

const scripted = (parent?: number): Record<string, unknown> => ({
  Transform: parent === undefined ? { position: { x: 1, y: 0, z: 1 } } : { parent },
  GltfContainer: { src: 'models/rig.glb' },
  MeshCollider: { mesh: { box: {} } },
  [SCRIPT]: { value: [{ path: 'src/scripts/rig.ts', priority: 0, layout: '{}' }] }
})

describe('inertSubtree', () => {
  it('is empty when nothing is marked', () => {
    expect(inertSubtree({ '512': scripted() }).size).toBe(0)
  })

  it('takes the marked entity and everything parented under it', () => {
    const authored: AuthoredData = {
      '512': { ...scripted(), [INERT_COMPONENT]: {} },
      '513': scripted(512),
      '514': scripted(513),
      '515': scripted()
    }
    expect([...inertSubtree(authored)].sort()).toEqual(['512', '513', '514'])
  })

  it('terminates on a Transform.parent cycle', () => {
    const authored: AuthoredData = {
      '512': { Transform: { parent: 513 }, [INERT_COMPONENT]: {} },
      '513': { Transform: { parent: 512 } }
    }
    expect([...inertSubtree(authored)].sort()).toEqual(['512', '513'])
  })
})

describe('projectInert', () => {
  it('returns the same object when no anchor is ghosted', () => {
    const authored: AuthoredData = { '512': scripted() }
    expect(projectInert(authored)).toBe(authored)
  })

  it('drops scripts, colliders and trigger areas from the whole subtree', () => {
    const authored: AuthoredData = {
      '512': { ...scripted(), [INERT_COMPONENT]: {} },
      '513': { ...scripted(512), TriggerArea: { areaType: 0 } }
    }
    const out = projectInert(authored)
    expect(out['512'][SCRIPT]).toBeUndefined()
    expect(out['512'].MeshCollider).toBeUndefined()
    expect(out['513'][SCRIPT]).toBeUndefined()
    expect(out['513'].TriggerArea).toBeUndefined()
    expect(out['513'].MeshCollider).toBeUndefined()
  })

  it('forces the subtree invisible, adding VisibilityComponent when absent', () => {
    const authored: AuthoredData = {
      '512': { ...scripted(), [INERT_COMPONENT]: {}, VisibilityComponent: { visible: true } },
      '513': scripted(512)
    }
    const out = projectInert(authored)
    expect(out['512'].VisibilityComponent).toEqual({ visible: false })
    expect(out['513'].VisibilityComponent).toEqual({ visible: false })
  })

  it('keeps the marker, the Transform and the geometry — the anchor still round-trips', () => {
    const authored: AuthoredData = { '512': { ...scripted(), [INERT_COMPONENT]: {} } }
    const out = projectInert(authored)
    expect(out['512'][INERT_COMPONENT]).toEqual({})
    expect(out['512'].Transform).toEqual({ position: { x: 1, y: 0, z: 1 } })
    expect(out['512'].GltfContainer).toEqual({ src: 'models/rig.glb' })
  })

  it('leaves entities outside the subtree exactly as they were', () => {
    const authored: AuthoredData = {
      '512': { ...scripted(), [INERT_COMPONENT]: {} },
      '515': scripted()
    }
    const out = projectInert(authored)
    expect(out['515']).toBe(authored['515'])
  })

  it('never mutates its input — the save baseline is cached from it', () => {
    const authored: AuthoredData = { '512': { ...scripted(), [INERT_COMPONENT]: {} } }
    const before = JSON.parse(JSON.stringify(authored)) as AuthoredData
    projectInert(authored)
    expect(authored).toEqual(before)
  })

  it('keeps VisibilityComponent in the slot it already had', () => {
    const authored: AuthoredData = {
      '512': {
        VisibilityComponent: { visible: true },
        Transform: {},
        [INERT_COMPONENT]: {}
      }
    }
    expect(Object.keys(projectInert(authored)['512'])).toEqual([
      'VisibilityComponent',
      'Transform',
      INERT_COMPONENT
    ])
  })
})
