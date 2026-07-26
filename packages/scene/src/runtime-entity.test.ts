import { describe, it, expect, beforeEach } from 'vitest'
import { state, isRuntimeEntity, resetSaveChangelog, type Snapshot } from './state'

// An entity the scene's CODE spawned exists only while the scene runs — the code
// recreates it on the next run. Authoring one into main.composite would make the
// next run show two: the saved copy and the one the code spawns. So dragging its
// gizmo has to stay a runtime-only change.
//
// The test is "absent from the save baseline AND not created by the editor",
// because both editor-created and code-spawned entities are missing from the
// baseline — only the editor knows which ones are its own.
const baseline = { '512': { Transform: {} } } as unknown as Snapshot

beforeEach(() => {
  resetSaveChangelog()
})

describe('isRuntimeEntity', () => {
  it('is false for an entity the composite authored', () => {
    expect(isRuntimeEntity('512', baseline)).toBe(false)
  })

  it('is true for one the scene’s code spawned', () => {
    expect(isRuntimeEntity('777', baseline)).toBe(true)
  })

  it('is false for one the editor created this session', () => {
    state.createdEntities.add('900')
    expect(isRuntimeEntity('900', baseline)).toBe(false)
  })

  // with no baseline we cannot tell code-spawned from authored, and wrongly
  // claiming "runtime" would silently drop real edits from the save
  it('claims nothing when there is no baseline to compare against', () => {
    expect(isRuntimeEntity('777', null)).toBe(false)
  })

  it('forgets editor-created ids once the changelog is reset', () => {
    state.createdEntities.add('900')
    resetSaveChangelog()
    // after a save the entity is in the new baseline, so it is authored from then
    // on — keeping it in createdEntities would only mask a later code-spawned id
    expect(isRuntimeEntity('900', baseline)).toBe(true)
    expect(isRuntimeEntity('900', { ...baseline, '900': {} } as unknown as Snapshot)).toBe(false)
  })
})
