import { describe, expect, it } from 'vitest'
import { buildHierarchyModel } from './hierarchy-model'
import { NAME_COMPONENT } from '@scene/custom-components'
import { state, type Snapshot } from '@scene/state'

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
    // reserved ids are engine; UI is NOT — the scene's code builds it
    expect(withEngine.engineRoots).toEqual(['1'])
    expect(withEngine.codeRoots).toEqual(['514'])
    expect(withEngine.staticRoots).toEqual(['512'])
  })

  it('classifies UI as code even when the baseline claims it is authored', () => {
    // /crdt_initial is captured after the scene's code has run, so UI nodes can
    // appear in the baseline. Ui* is excluded from what can be saved
    // (allowed-components.ts:5), so a UI node is never in main.composite.
    const snapshot: Snapshot = { '512': named('Bench'), '600': { UiTransform: {}, UiText: { value: 'Score' } } }
    const m = buildHierarchyModel(snapshot, snapshot, true)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual(['600'])
    expect(m.counts.code).toBe(1)
  })

  it('treats a child of a UI node as code too', () => {
    const snapshot: Snapshot = { '600': { UiTransform: {} }, '601': { Transform: { parent: 600 }, MeshRenderer: {} } }
    const m = buildHierarchyModel(snapshot, snapshot, true)
    expect(m.codeRoots).toEqual(['600'])
    expect(m.forest.children.get('600')).toEqual(['601'])
  })

  it('hides editor bookkeeping entities entirely', () => {
    const snapshot: Snapshot = {
      '512': named('Bench'),
      '513': { 'inspector::TransformConfig': { mode: 'local' } }
    }
    const m = buildHierarchyModel(snapshot, snapshot, true)
    expect(m.forest.roots).toEqual(['512'])
  })

  // The real Tower of Madness composite: entity 0 carries inspector::Nodes listing
  // every authored id. /crdt_initial came back EMPTY for that scene, which marked
  // all 9 authored entities as code and left "In your scene" reading 0.
  const NODES = (ids: number[]): Record<string, unknown> => ({
    'inspector::Nodes': {
      value: [{ entity: 0, open: true, children: ids }, ...ids.map((e) => ({ entity: e, children: [] }))]
    }
  })

  it('trusts the composite node tree over an empty baseline', () => {
    const snapshot: Snapshot = {
      '0': NODES([512, 514, 586, 600]),
      '512': named('CoolBed.glb'),
      '514': named('LeaderBoard01.glb_3'),
      '586': named('TriggerStart'),
      '600': named('ChunkStart.glb'),
      '700': unnamed()
    }
    const m = buildHierarchyModel(snapshot, {}, false)
    expect(m.staticRoots).toEqual(['512', '514', '586', '600'])
    expect(m.codeRoots).toEqual(['700'])
    expect(m.counts.static).toBe(4)
    expect(m.counts.code).toBe(1)
  })

  // The exact failure: /crdt_initial empty AND entity 0's node tree never arriving.
  // Every authored entity still carries inspector::TransformConfig, which the
  // scene's own code has no definition for and can never write.
  it('classifies by authoring metadata when every other signal is missing', () => {
    const authored = (name: string): Record<string, unknown> => ({
      ...named(name),
      GltfContainer: { src: `Models/${name}` },
      'inspector::TransformConfig': { porportionalScaling: false }
    })
    const snapshot: Snapshot = {
      '512': authored('CoolBed.glb'),
      '514': authored('LeaderBoard01.glb_3'),
      '586': { ...authored('TriggerStart'), 'inspector::Hide': { value: true } },
      '602': authored('Button Panel'),
      // spawned by the scene's code — no authoring metadata anywhere on it
      '700': unnamed(),
      '701': { TextShape: { text: 'score' }, Transform: {} }
    }
    // no node tree on entity 0, and an empty baseline
    const m = buildHierarchyModel(snapshot, {}, false)
    expect(m.staticRoots).toEqual(['512', '514', '586', '602'])
    expect(m.codeRoots).toEqual(['700', '701'])
    expect(m.counts.static).toBe(4)
    expect(m.counts.code).toBe(2)
  })

  it('main.composite from disk wins over every in-snapshot signal', () => {
    // The real failure: /crdt_initial empty, no node tree, and (for a scene this
    // editor authored) no inspector:: metadata either. The composite still knows.
    const snapshot: Snapshot = {
      '512': named('CoolBed.glb'),
      '586': named('TriggerStart'),
      '700': unnamed(),
      '701': { TextShape: { text: 'score' }, Transform: {} }
    }
    const m = buildHierarchyModel(snapshot, {}, false, new Set(['512', '586']))
    expect(m.staticRoots).toEqual(['512', '586'])
    expect(m.codeRoots).toEqual(['700', '701'])
    expect(m.counts.static).toBe(2)
    expect(m.counts.code).toBe(2)
  })

  it('ignores an empty node tree rather than calling everything code', () => {
    const snapshot: Snapshot = { '0': { 'inspector::Nodes': { value: [] } }, '512': named('Bench') }
    const m = buildHierarchyModel(snapshot, { '512': named('Bench') }, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.counts.code).toBe(0)
  })

  it('still classifies UI as code even when the node tree lists it', () => {
    const snapshot: Snapshot = { '0': NODES([512, 600]), '512': named('Bench'), '600': { UiTransform: {} } }
    const m = buildHierarchyModel(snapshot, {}, true)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.codeRoots).toEqual(['600'])
  })

  // THE bug: the engine writes UiCanvasInformation onto the scene ROOT. isUiEntity
  // matched any component starting with "Ui", so entity 0 read as a UI node and
  // every entity parented to it became "under UI" -> code. 236 code, 0 static.
  it('does not treat the scene root as UI because of UiCanvasInformation', () => {
    const snapshot: Snapshot = {
      '0': { UiCanvasInformation: { width: 1920 }, 'inspector::Nodes': { value: [] }, EngineInfo: {} },
      '512': { ...named('CoolBed.glb'), 'inspector::TransformConfig': {} },
      '586': { ...named('TriggerStart'), 'inspector::TransformConfig': {}, 'inspector::Hide': { value: true } },
      '700': unnamed()
    }
    const m = buildHierarchyModel(snapshot, {}, false, new Set(['512', '586']))
    expect(m.staticRoots).toEqual(['512', '586'])
    expect(m.codeRoots).toEqual(['700'])
    expect(m.counts.static).toBe(2)
  })

  it('nests UI nodes by UiTransform.parent — they carry no Transform', () => {
    // Without this every UI node re-rooted to 0: 200+ identical "UI node" rows in
    // a flat wall instead of the UI tree.
    const snapshot: Snapshot = {
      '600': { UiTransform: { parent: 0 }, UiBackground: {} },
      '601': { UiTransform: { parent: 600 }, UiText: { value: 'CONNECTING TO SERVER.' } },
      '602': { UiTransform: { parent: 600 }, UiBackground: {} }
    }
    const m = buildHierarchyModel(snapshot, {}, true)
    expect(m.codeRoots).toEqual(['600'])
    expect(m.forest.children.get('600')).toEqual(['601', '602'])
  })

  // Everything the editor creates — new entity, duplicate, paste, prefab placement
  // — allocates through allocateNamedEntities, which records the id in
  // state.createdEntities. That is the ONLY thing keeping a just-made entity out
  // of the code group until the next save writes it into main.composite.
  it('keeps an entity this session created out of the code group', () => {
    const snapshot: Snapshot = { '512': named('Test'), '513': unnamed() }
    state.createdEntities = new Set(['512'])
    try {
      // no composite, no node tree, empty baseline — the fresh-scene case
      const m = buildHierarchyModel(snapshot, {}, false)
      expect(m.staticRoots).toEqual(['512'])
      expect(m.codeRoots).toEqual(['513'])
    } finally {
      state.createdEntities = new Set()
    }
  })

  // Genesis Plaza ships 247 transform-only anchors. Inline they were a wall of
  // identical unclickable rows that buried everything worth looking at.
  it('buckets top-level entities with nothing inspectable on them', () => {
    const snapshot: Snapshot = {
      '512': named('Bench'),
      '513': { Transform: {} },
      '514': { Transform: {}, '586242678': 'base64==' } // a component only the scene can read
    }
    const m = buildHierarchyModel(snapshot, snapshot, false)
    expect(m.staticRoots).toEqual(['512'])
    expect(m.unknownRoots).toEqual(['513', '514'])
    expect(m.counts.unknown).toBe(2)
    // and they stop inflating the group they came out of
    expect(m.counts.static).toBe(1)
  })

  it('keeps an inert entity in place when it parents something — it holds structure', () => {
    const snapshot: Snapshot = { '512': { Transform: {} }, '513': named('Lamp', 512) }
    const m = buildHierarchyModel(snapshot, snapshot, false)
    expect(m.unknownRoots).toEqual([])
    expect(m.staticRoots).toEqual(['512'])
    expect(m.forest.children.get('512') ?? []).toEqual(['513'])
  })

  it('leaves a nested inert entity under its parent rather than hoisting it out', () => {
    // its Transform is relative to 512 — in a top-level bucket it would mean nothing
    const snapshot: Snapshot = { '512': named('Bench'), '513': { Transform: { parent: 512 } } }
    const m = buildHierarchyModel(snapshot, snapshot, false)
    expect(m.unknownRoots).toEqual([])
    expect(m.forest.children.get('512') ?? []).toEqual(['513'])
  })

  it('re-roots past dropped ancestors so a kept child is never lost', () => {
    // 513 has no components of its own and is dropped; 514 must re-root onto 512
    const snapshot: Snapshot = { '512': named('Bench'), '513': {}, '514': named('Cushion', 513) }
    // parentOf(514) === '513', which is dropped, and parentOf('513') is '0' -> root
    const m = buildHierarchyModel(snapshot, snapshot, false)
    expect(m.staticRoots).toEqual(['512', '514'])
  })
})
