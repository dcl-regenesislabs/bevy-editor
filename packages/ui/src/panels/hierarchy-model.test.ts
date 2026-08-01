import { describe, expect, it } from 'vitest'
import { buildHierarchyModel } from './hierarchy-model'
import { NAME_COMPONENT } from '../../../scene/src/custom-components'
import type { Snapshot } from '../../../scene/src/state'

const named = (name: string, parent?: number): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: parent === undefined ? {} : { parent }
})
const unnamed = (parent?: number): Record<string, unknown> => ({
  MeshRenderer: { mesh: { sphere: {} } },
  Transform: parent === undefined ? {} : { parent }
})

describe('buildHierarchyModel', () => {
  it('splits roots by baseline membership, not by having a Name', () => {
    const snapshot: Snapshot = { '512': named('Bench'), '513': unnamed() }
    const baseline: Snapshot = { '512': named('Bench') }
    const m = buildHierarchyModel(snapshot, baseline, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual(['513'])
    expect(m.counts.code).toBe(1)
  })

  it('shows authored-but-unnamed entities — invisible in the old namedForest', () => {
    const snapshot: Snapshot = { '512': unnamed() }
    const baseline: Snapshot = { '512': unnamed() }
    const m = buildHierarchyModel(snapshot, baseline, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual([])
  })

  it('lists a named runtime entity once, in the code group — the old pair showed it twice', () => {
    const snapshot: Snapshot = { '512': named('Bench'), '513': named('SpawnedByCode') }
    const baseline: Snapshot = { '512': named('Bench') }
    const m = buildHierarchyModel(snapshot, baseline, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual(['513'])
    expect(m.forest.children.get('512') ?? []).toEqual([])
  })

  it('buckets a code child under its authored parent instead of exiling it', () => {
    const snapshot: Snapshot = { '512': named('Sit Spot'), '513': unnamed(512) }
    const baseline: Snapshot = { '512': named('Sit Spot') }
    const m = buildHierarchyModel(snapshot, baseline, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual([])
    expect(m.codeChildren.get('512')).toEqual(['513'])
    // the bucket child must NOT also appear as an inline child
    expect(m.forest.children.get('512') ?? []).toEqual([])
  })

  it('keeps code children of a code parent inline — the bucket would say nothing new', () => {
    const snapshot: Snapshot = { '512': unnamed(), '513': unnamed(512) }
    const m = buildHierarchyModel(snapshot, {}, false)
    expect(m.codeRoots).toEqual(['512'])
    expect(m.forest.children.get('512')).toEqual(['513'])
    expect(m.codeChildren.size).toBe(0)
  })

  it('degrades to the old named-only tree while the baseline is pending', () => {
    const snapshot: Snapshot = { '512': named('Bench'), '513': unnamed() }
    const m = buildHierarchyModel(snapshot, null, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual([])
    expect(m.counts.code).toBe(0)
  })

  it('excludes entity 0, component-less ids, and engine/UI ids unless asked', () => {
    const snapshot: Snapshot = {
      '0': { 'inspector::Nodes': {} },
      '1': named('player'),
      '512': named('Bench'),
      '513': {},
      '514': { UiTransform: {} }
    }
    const m = buildHierarchyModel(snapshot, snapshot, false)
    expect(m.forest.roots).toEqual(['512'])

    const withEngine = buildHierarchyModel(snapshot, snapshot, true)
    expect(withEngine.engineRoots).toContain('1')
    expect(withEngine.engineRoots).toContain('514')
    expect(withEngine.staticRoots).toEqual(['512'])
  })

  it('re-roots past dropped ancestors so a kept child is never lost', () => {
    // 513 has no components of its own and is dropped; 514 must re-root onto 512
    const snapshot: Snapshot = { '512': named('Bench'), '513': {}, '514': named('Cushion', 513) }
    // parentOf(514) === '513', which is dropped, and parentOf('513') is '0' -> root
    const m = buildHierarchyModel(snapshot, snapshot, false)
    expect(m.staticRoots).toEqual(['512', '514'])
  })
})
