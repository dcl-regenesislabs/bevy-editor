// The echo-normalization class, pinned as a class: for each component the
// engine is known to normalize, one realistic pair — the authored-minimal form
// a hand-written composite holds, and the engine-normalized form the snapshot
// echoes back (nulls for unset optional fields, empty repeated lists, mutated
// runtime state, f32-rounded floats) — asserted equivalent at every consumer
// that compares or bakes component values:
//   * componentValueEquivalent (the layer itself)
//   * instanceDrift (folder minimal vs snapshot normalized ⇒ clean)
//   * captureSelectionAsPrefab (echoed snapshot bakes the same bytes as a
//     fresh one ⇒ two folders for one prefab can never diverge)
//   * compileSnapshot (a clone built from either folder is the same clone)
import { describe, expect, it } from 'vitest'
import { authoredOnly, captureSelectionAsPrefab } from './capture'
import { instanceDrift } from './drift'
import { componentValueEquivalent, normalizeCapturedComponent, valueEquivalent } from './equivalence'
import { parsePrefabComposite, type PrefabComposite } from './format'
import { compileSnapshot } from './spawnable'

const ASSET_ID = 'a1b2c3d4-0000-4000-8000-000000000001'
const FOLDER = 'custom/lamp'

// --- the pairs -------------------------------------------------------------

// f32-exact floats, so the capture-parity assertions test the null class and
// not float rounding; the f32 tolerance itself is pinned in drift.test.ts
const MATERIAL_MINIMAL = {
  material: { pbr: { albedoColor: { r: 1, g: 0.5, b: 0.25, a: 1 }, metallic: 0, roughness: 1 } }
}
const MATERIAL_NORMALIZED = {
  material: {
    pbr: {
      albedoColor: { r: 1, g: 0.5, b: 0.25, a: 1 },
      metallic: 0,
      roughness: 1,
      texture: null,
      alphaTexture: null,
      emissiveTexture: null,
      bumpTexture: null,
      alphaTest: null,
      castShadows: null,
      transparencyMode: null
    }
  }
}

const MESH_RENDERER_MINIMAL = { mesh: { box: {} } }
const MESH_RENDERER_NORMALIZED = { mesh: { box: { uvs: [] } } }

const VISIBILITY_MINIMAL = { visible: true }
const VISIBILITY_NORMALIZED = { visible: true }

const POINTER_EVENTS_MINIMAL = {
  pointerEvents: [
    {
      eventType: 1,
      eventInfo: { button: 0, hoverText: 'Switch', maxDistance: 10, showFeedback: true }
    }
  ]
}
const POINTER_EVENTS_NORMALIZED = {
  pointerEvents: [
    {
      eventType: 1,
      eventInfo: {
        button: 0,
        hoverText: 'Switch',
        maxDistance: 10,
        showFeedback: true,
        maxPlayerDistance: null,
        priority: null,
        showHighlight: null
      }
    }
  ]
}

// authored: Idle playing from frame one; echoed: the engine has blended it
const ANIMATOR_AUTHORED = {
  states: [{ clip: 'Idle', playing: true, loop: true, weight: 1, speed: 1 }]
}
const ANIMATOR_ECHOED = {
  states: [{ clip: 'Idle', playing: false, loop: true, weight: 0.25, speed: 1 }]
}

const PAIRS: Array<[name: string, minimal: unknown, normalized: unknown]> = [
  ['Material', MATERIAL_MINIMAL, MATERIAL_NORMALIZED],
  ['MeshRenderer', MESH_RENDERER_MINIMAL, MESH_RENDERER_NORMALIZED],
  ['VisibilityComponent', VISIBILITY_MINIMAL, VISIBILITY_NORMALIZED],
  ['PointerEvents', POINTER_EVENTS_MINIMAL, POINTER_EVENTS_NORMALIZED],
  ['Animator', ANIMATOR_AUTHORED, ANIMATOR_ECHOED]
]

// --- the layer itself ------------------------------------------------------

describe('componentValueEquivalent', () => {
  it.each(PAIRS)('%s: authored-minimal == engine-normalized', (name, minimal, normalized) => {
    expect(componentValueEquivalent(name, minimal, normalized)).toBe(true)
    expect(componentValueEquivalent(`core::${name}`, minimal, normalized)).toBe(true)
  })

  it('still sees a real edit through the normalization noise', () => {
    const edited = JSON.parse(JSON.stringify(MATERIAL_NORMALIZED)) as typeof MATERIAL_NORMALIZED
    edited.material.pbr.albedoColor.g = 0.9
    expect(componentValueEquivalent('Material', MATERIAL_MINIMAL, edited)).toBe(false)

    const retextured = JSON.parse(JSON.stringify(POINTER_EVENTS_NORMALIZED)) as {
      pointerEvents: Array<{ eventInfo: { hoverText: string } }>
    }
    retextured.pointerEvents[0].eventInfo.hoverText = 'Pull'
    expect(componentValueEquivalent('PointerEvents', POINTER_EVENTS_MINIMAL, retextured)).toBe(false)
  })

  it('ignores only the runtime fields of an Animator, not its clips', () => {
    const otherClip = { states: [{ clip: 'Run', playing: false, loop: true, weight: 0.25, speed: 1 }] }
    expect(componentValueEquivalent('Animator', ANIMATOR_AUTHORED, otherClip)).toBe(false)
  })

  it('keeps a set-but-empty message distinct from an unset field', () => {
    expect(valueEquivalent({ mesh: { box: {} } }, { mesh: { box: null } })).toBe(false)
  })
})

// --- instanceDrift: folder minimal vs snapshot normalized -------------------

const FOLDER_COMPOSITE_JSON = JSON.stringify({
  version: 1,
  components: [
    { name: 'core::Material', data: { '0': { json: MATERIAL_MINIMAL } } },
    { name: 'core::MeshRenderer', data: { '0': { json: MESH_RENDERER_MINIMAL } } },
    { name: 'core::VisibilityComponent', data: { '0': { json: VISIBILITY_MINIMAL } } },
    { name: 'core::PointerEvents', data: { '0': { json: POINTER_EVENTS_MINIMAL } } },
    { name: 'core::Animator', data: { '0': { json: ANIMATOR_AUTHORED } } },
    { name: 'core-schema::Name', data: { '0': { json: { value: 'Lamp' } } } }
  ]
})

function folderComposite(): PrefabComposite {
  return parsePrefabComposite(FOLDER_COMPOSITE_JSON, FOLDER)
}

function normalizedInstance(): Record<string, Record<string, unknown>> {
  return {
    '512': {
      Transform: {
        parent: 0,
        position: { x: 8, y: 0, z: 8 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 }
      },
      'core-schema::Name': { value: 'Lamp' },
      'inspector::CustomAsset': { assetId: ASSET_ID },
      Material: JSON.parse(JSON.stringify(MATERIAL_NORMALIZED)) as Record<string, unknown>,
      MeshRenderer: JSON.parse(JSON.stringify(MESH_RENDERER_NORMALIZED)) as Record<string, unknown>,
      VisibilityComponent: { ...VISIBILITY_NORMALIZED },
      PointerEvents: JSON.parse(JSON.stringify(POINTER_EVENTS_NORMALIZED)) as Record<string, unknown>,
      Animator: JSON.parse(JSON.stringify(ANIMATOR_ECHOED)) as Record<string, unknown>
    }
  }
}

function minimalInstance(): Record<string, Record<string, unknown>> {
  const snapshot = normalizedInstance()
  snapshot['512'].Material = JSON.parse(JSON.stringify(MATERIAL_MINIMAL)) as Record<string, unknown>
  snapshot['512'].MeshRenderer = JSON.parse(JSON.stringify(MESH_RENDERER_MINIMAL)) as Record<
    string,
    unknown
  >
  snapshot['512'].PointerEvents = JSON.parse(JSON.stringify(POINTER_EVENTS_MINIMAL)) as Record<
    string,
    unknown
  >
  return snapshot
}

describe('instanceDrift across the normalization divide', () => {
  it('reads an engine-normalized instance of a minimal folder as clean', () => {
    const result = instanceDrift(normalizedInstance(), '512', folderComposite(), {
      folder: FOLDER,
      isRuntime: () => false
    })
    expect(result.changed).toEqual([])
    expect(result.added).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.status).toBe('clean')
  })

  it('still reports a real edit on a normalized instance', () => {
    const snapshot = normalizedInstance()
    ;(snapshot['512'].Material as { material: { pbr: { metallic: number } } }).material.pbr.metallic = 0.8
    const result = instanceDrift(snapshot, '512', folderComposite(), {
      folder: FOLDER,
      isRuntime: () => false
    })
    expect(result.status).toBe('drifted')
    expect(result.changed.map((c) => c.component)).toEqual(['core::Material'])
  })
})

// --- capture: both forms bake the same folder -------------------------------

describe('capture across the normalization divide', () => {
  it('bakes the same composite from a fresh snapshot and an echoed one', () => {
    const fresh = captureSelectionAsPrefab(authoredOnly(minimalInstance(), () => false), ['512'])
    const echoed = captureSelectionAsPrefab(authoredOnly(normalizedInstance(), () => false), [
      '512'
    ])
    // Animator playing/weight aside — the engine's mutation is not recoverable
    // at capture and the compare layer ignores it — the folders must be
    // byte-identical, or two saves of one prefab diverge forever.
    const withoutAnimator = (composite: PrefabComposite): PrefabComposite => ({
      version: composite.version,
      components: composite.components.filter((c) => c.name !== 'core::Animator')
    })
    expect(withoutAnimator(echoed.composite)).toEqual(withoutAnimator(fresh.composite))
  })

  it('strips the echo’s nulls from the components known to carry them', () => {
    expect(normalizeCapturedComponent('Material', MATERIAL_NORMALIZED)).toEqual(MATERIAL_MINIMAL)
    expect(normalizeCapturedComponent('PointerEvents', POINTER_EVENTS_NORMALIZED)).toEqual(
      POINTER_EVENTS_MINIMAL
    )
  })

  it('leaves a meaningful null alone outside the allowlist — a cleared Triggers ref stays cleared', () => {
    const triggers = { value: [{ type: 'on_click', actions: [{ id: null }] }] }
    expect(normalizeCapturedComponent('asset-packs::Triggers', triggers)).toBe(triggers)
  })
})

// --- spawnable: a clone from either folder is the same clone ----------------

describe('compileSnapshot across the normalization divide', () => {
  it('compiles identical clone sources from a fresh bake and an echoed bake', () => {
    const data = { id: ASSET_ID, name: 'Lamp', category: 'custom' as const, tags: [] }
    const fresh = captureSelectionAsPrefab(authoredOnly(minimalInstance(), () => false), ['512'])
    const echoed = captureSelectionAsPrefab(authoredOnly(normalizedInstance(), () => false), [
      '512'
    ])
    const compiled = (composite: PrefabComposite) =>
      compileSnapshot({ folder: FOLDER, data, composite })
    const freshSnapshot = compiled(fresh.composite)
    const echoedSnapshot = compiled(echoed.composite)
    const withoutAnimator = (entities: NonNullable<typeof freshSnapshot>['entities']) =>
      entities.map((e) => ({
        ...e,
        components: e.components.filter((c) => c.name !== 'core::Animator')
      }))
    expect(withoutAnimator(echoedSnapshot?.entities ?? [])).toEqual(
      withoutAnimator(freshSnapshot?.entities ?? [])
    )
  })
})
