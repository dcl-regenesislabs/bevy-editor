import { describe, it, expect } from 'vitest'
import { buildComposite, isAuthoredEntity } from './composite'

describe('isAuthoredEntity', () => {
  it('treats the scene root (0) as authored', () => {
    expect(isAuthoredEntity(0)).toBe(true)
  })

  it('treats reserved entities (1..511) as NOT authored', () => {
    expect(isAuthoredEntity(1)).toBe(false)
    expect(isAuthoredEntity(5)).toBe(false) // the world origin
    expect(isAuthoredEntity(511)).toBe(false)
  })

  it('treats scene entities (>=512) as authored', () => {
    expect(isAuthoredEntity(512)).toBe(true)
    expect(isAuthoredEntity(99999)).toBe(true)
  })
})

// The save is the ONE place the "Editing only" projection runs (inert.ts). If
// this call site ever goes missing, ghosts ship their scripts and colliders into
// the running game and nothing else in the repo notices.
describe('the inert projection at save time', () => {
  const script = { value: [{ path: 'src/scripts/rig.ts', priority: 0, layout: '{"params":{}}' }] }

  it('keeps a ghost anchor’s scripts out of the written composite', () => {
    const written = buildComposite({
      '512': {
        Transform: { position: { x: 1, y: 0, z: 0 } },
        'asset-packs::Script': script,
        'inspector::Inert': {}
      }
    })
    expect(written).not.toContain('src/scripts/rig.ts')
  })

  it('leaves an ordinary entity’s scripts alone', () => {
    const written = buildComposite({
      '512': { Transform: { position: { x: 1, y: 0, z: 0 } }, 'asset-packs::Script': script }
    })
    expect(written).toContain('src/scripts/rig.ts')
  })

  it('projects the ghost’s whole subtree, not just the marked entity', () => {
    const written = buildComposite({
      '512': { Transform: {}, 'inspector::Inert': {} },
      '513': { Transform: { parent: 512 }, 'asset-packs::Script': script }
    })
    expect(written).not.toContain('src/scripts/rig.ts')
  })
})
