import { describe, it, expect, beforeEach } from 'vitest'
import { PICK_LAYER, pickApplied, synthesized, stripPickColliders, invalidatePickLayer } from './pick-layer'

// The editor writes a CL_RESERVED6 (128) collider ENGINE-side so its raycasts can
// hit renderables. The logical snapshot — what the tree, the inspector and the
// save see — must never contain it.
const snapshot = (comps: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> => comps

beforeEach(() => {
  pickApplied.clear()
  synthesized.clear()
})

describe('stripPickColliders', () => {
  it('clears the pick bit from a GltfContainer, keeping the author’s mask', () => {
    const s = snapshot({ '512': { GltfContainer: { src: 'm.glb', visibleMeshesCollisionMask: 1 | PICK_LAYER } } })
    stripPickColliders(s)
    expect(s['512'].GltfContainer).toEqual({ src: 'm.glb', visibleMeshesCollisionMask: 1 })
  })

  it('clears the pick bit from a real MeshCollider without removing it', () => {
    const s = snapshot({ '512': { MeshCollider: { collisionMask: 3 | PICK_LAYER, mesh: { box: {} } } } })
    stripPickColliders(s)
    expect(s['512'].MeshCollider).toEqual({ collisionMask: 3, mesh: { box: {} } })
  })

  it('removes a collider that is only the pick layer when we recorded synthesizing it', () => {
    synthesized.add('512')
    const s = snapshot({ '512': { MeshCollider: { collisionMask: PICK_LAYER } } })
    stripPickColliders(s)
    expect(s['512'].MeshCollider).toBeUndefined()
  })

  // the page build ingests snapshots but never writes pick colliders, so its
  // `synthesized` set is always empty — the shape has to be enough on its own
  it('removes a pick-only collider on a MeshRenderer even with no record of it', () => {
    const s = snapshot({ '512': { MeshRenderer: { mesh: { box: {} } }, MeshCollider: { collisionMask: PICK_LAYER } } })
    stripPickColliders(s)
    expect(s['512'].MeshCollider).toBeUndefined()
    expect(s['512'].MeshRenderer).toBeDefined()
  })

  it('leaves an untouched entity alone', () => {
    const s = snapshot({ '512': { Transform: { position: { x: 1 } }, MeshCollider: { collisionMask: 3 } } })
    stripPickColliders(s)
    expect(s['512']).toEqual({ Transform: { position: { x: 1 } }, MeshCollider: { collisionMask: 3 } })
  })
})

// An edit to a renderable component overwrites the engine value with the logical
// one — which by the above never carries the pick bit. The overlay must be
// re-applied, so the "already done" memo has to be dropped.
describe('invalidatePickLayer', () => {
  it('drops the memo for the components whose write wipes the overlay', () => {
    for (const name of ['GltfContainer', 'MeshCollider', 'MeshRenderer']) {
      pickApplied.add('512')
      invalidatePickLayer('512', name)
      expect(pickApplied.has('512'), `${name} should invalidate`).toBe(false)
    }
  })

  it('keeps the memo for unrelated components, so a gizmo drag costs nothing', () => {
    pickApplied.add('512')
    invalidatePickLayer('512', 'Transform')
    invalidatePickLayer('512', 'Name')
    expect(pickApplied.has('512')).toBe(true)
  })
})
