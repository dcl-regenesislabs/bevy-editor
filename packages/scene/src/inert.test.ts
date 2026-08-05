import { describe, expect, it } from 'vitest'
import { INERT_BACKUP_COMPONENT, INERT_COMPONENT, inertSubtree, projectInert, restoreInert, type AuthoredData } from './inert'

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
    expect(out['512'].GltfContainer).toMatchObject({ src: 'models/rig.glb' })
  })

  it('neutralises a GLB’s own collision masks — invisible must not mean solid', () => {
    const authored: AuthoredData = {
      '512': {
        Transform: {},
        GltfContainer: { src: 'models/rig.glb', visibleMeshesCollisionMask: 3 },
        [INERT_COMPONENT]: {}
      }
    }
    expect(projectInert(authored)['512'].GltfContainer).toEqual({
      src: 'models/rig.glb',
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0
    })
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
      INERT_COMPONENT,
      INERT_BACKUP_COMPONENT
    ])
  })
})

// main.composite is the only persistent store of authored data: what the
// projection takes out has to come back on the way in, or reopening the project
// deletes the creator's scripts for good.
describe('restoreInert', () => {
  const ghosted = (): AuthoredData =>
    projectInert({
      '512': { ...scripted(), [INERT_COMPONENT]: {} },
      '513': { ...scripted(512), TriggerArea: { areaType: 0 } },
      '515': scripted()
    })

  it('puts back everything the projection removed or rewrote', () => {
    const authored = ghosted()
    restoreInert(authored)
    expect(authored['512'][SCRIPT]).toEqual(scripted()[SCRIPT])
    expect(authored['512'].MeshCollider).toEqual({ mesh: { box: {} } })
    expect(authored['512'].GltfContainer).toEqual({ src: 'models/rig.glb' })
    expect(authored['513'].TriggerArea).toEqual({ areaType: 0 })
    expect(authored['512'][INERT_COMPONENT]).toEqual({})
  })

  it('removes a VisibilityComponent the projection invented, and keeps one that was authored', () => {
    const authored = projectInert({
      '512': { Transform: {}, [INERT_COMPONENT]: {} },
      '513': { Transform: { parent: 512 }, VisibilityComponent: { visible: true } }
    })
    restoreInert(authored)
    expect(authored['512'].VisibilityComponent).toBeUndefined()
    expect(authored['513'].VisibilityComponent).toEqual({ visible: true })
  })

  it('always strips the backup itself, so capture and the next save never see it', () => {
    const authored = ghosted()
    restoreInert(authored)
    for (const components of Object.values(authored)) expect(components[INERT_BACKUP_COMPONENT]).toBeUndefined()
  })

  it('survives a hand-edited composite rather than taking the snapshot down', () => {
    const authored: AuthoredData = { '512': { Transform: {}, [INERT_BACKUP_COMPONENT]: { value: 'not json' } } }
    restoreInert(authored)
    expect(authored['512']).toEqual({ Transform: {} })
  })

  it('round-trips a ghost through project → restore unchanged', () => {
    const authored: AuthoredData = {
      '512': { ...scripted(), [INERT_COMPONENT]: {} },
      '513': { ...scripted(512), VisibilityComponent: { visible: true } }
    }
    const before = JSON.parse(JSON.stringify(authored)) as AuthoredData
    const out = projectInert(authored)
    restoreInert(out)
    expect(out).toEqual(before)
  })
})
