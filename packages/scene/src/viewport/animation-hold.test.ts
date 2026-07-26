import { describe, it, expect } from 'vitest'
import { stripAnimationHolds } from './animation-hold'

// The editor stops a paused scene's animations by writing an Animator whose only
// state names a clip that cannot exist: the engine drops states it can't resolve,
// so nothing is left playing. That write echoes back through /crdt_snapshot, and
// the logical view must never show it.
const snapshot = (comps: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> => comps

describe('stripAnimationHolds', () => {
  it('removes the editor’s hold', () => {
    const s = snapshot({ '512': { Animator: { states: [{ clip: '__editor_paused__', playing: false }] } } })
    stripAnimationHolds(s)
    expect(s['512'].Animator).toBeUndefined()
  })

  it('keeps an Animator the scene authored', () => {
    const authored = { states: [{ clip: 'Idle', playing: true }] }
    const s = snapshot({ '512': { Animator: authored } })
    stripAnimationHolds(s)
    expect(s['512'].Animator).toEqual(authored)
  })

  // "Add component" seeds every repeated field with [], so an empty state list is
  // what a just-added Animator looks like. Treating that as ours would delete the
  // user's new component out of the snapshot on the next ingest.
  it('keeps a freshly added, still-empty Animator', () => {
    const s = snapshot({ '512': { Animator: { states: [] } } })
    stripAnimationHolds(s)
    expect(s['512'].Animator).toEqual({ states: [] })
  })

  it('leaves entities without an Animator alone', () => {
    const s = snapshot({ '512': { GltfContainer: { src: 'm.glb' } } })
    stripAnimationHolds(s)
    expect(s['512']).toEqual({ GltfContainer: { src: 'm.glb' } })
  })
})
