import { describe, expect, it } from 'vitest'
import { playHiddenIds } from './hidden'
import { INERT_COMPONENT } from '../inert'
import type { Snapshot } from '../state'

// Pins the Play rule: pressing ▶ must never show a spawn-only anchor, whatever
// the eye says. The set is the inert subtrees when playing, empty when frozen —
// and runtime spawn copies (no marker, parented to the scene root) stay out.

const anchor: Snapshot[string] = {
  Transform: { position: { x: 8, y: 0, z: 8 } },
  GltfContainer: { src: 'assets/scene/Models/CoolBed/CoolBed.glb' },
  [INERT_COMPONENT]: {}
}

const snapshot: Snapshot = {
  '0': {},
  '512': anchor,
  '513': { Transform: { parent: 512 }, GltfContainer: { src: 'assets/part.glb' } },
  '514': { Transform: { parent: 513 } },
  '520': { Transform: { position: { x: 1, y: 0, z: 1 } }, GltfContainer: { src: 'assets/other.glb' } }
}

describe('playHiddenIds', () => {
  it('hides nothing while frozen (edit mode), even with inert anchors present', () => {
    expect(playHiddenIds(snapshot, true).size).toBe(0)
  })

  it('hides the inert anchor and its whole subtree while playing', () => {
    expect([...playHiddenIds(snapshot, false)].sort()).toEqual(['512', '513', '514'])
  })

  it('leaves ordinary entities and runtime spawn copies visible while playing', () => {
    const clone: Snapshot[string] = {
      Transform: { position: { x: 8, y: 0, z: 8 } },
      GltfContainer: { src: 'assets/scene/Models/CoolBed/CoolBed.glb' }
    }
    const withClone: Snapshot = { ...snapshot, '600': clone }
    const hidden = playHiddenIds(withClone, false)
    expect(hidden.has('600')).toBe(false)
    expect(hidden.has('520')).toBe(false)
  })

  it('hides an eye-visible anchor while playing (the eye never overrides Play)', () => {
    const eyeVisible: Snapshot = { '512': { ...anchor, 'inspector::Hide': { value: false } } }
    expect(playHiddenIds(eyeVisible, false).has('512')).toBe(true)
  })
})
