import { describe, it, expect } from 'vitest'
import { spawnWorldPosition } from './scene-meta'

// A parcel is 16m; DCL world space puts parcel (x,y) at (x*16, ·, y*16), and a
// spawn point's position is an offset inside the scene from its base parcel.
describe('spawnWorldPosition', () => {
  it('falls back to the centre of the base parcel when no spawn point is authored', () => {
    expect(spawnWorldPosition({ scene: { base: '0,0' } })).toBe('8,0,8')
    expect(spawnWorldPosition({ scene: { base: '2,3' } })).toBe('40,0,56')
  })

  it('handles negative parcels', () => {
    expect(spawnWorldPosition({ scene: { base: '-1,-2' } })).toBe('-8,0,-24')
  })

  it('offsets the authored spawn point from the base parcel', () => {
    const meta = { scene: { base: '1,1' }, spawnPoints: [{ position: { x: 4, y: 1, z: 2 } }] }
    expect(spawnWorldPosition(meta)).toBe('20,1,18')
  })

  it('takes the middle of a range', () => {
    const meta = { scene: { base: '0,0' }, spawnPoints: [{ position: { x: [2, 6], y: 0, z: [0, 4] } }] }
    expect(spawnWorldPosition(meta)).toBe('4,0,2')
  })

  it('prefers the spawn point marked default', () => {
    const meta = {
      scene: { base: '0,0' },
      spawnPoints: [
        { position: { x: 1, y: 0, z: 1 } },
        { default: true, position: { x: 9, y: 0, z: 9 } }
      ]
    }
    expect(spawnWorldPosition(meta)).toBe('9,0,9')
  })

  it('treats missing axes as zero', () => {
    expect(spawnWorldPosition({ scene: { base: '0,0' }, spawnPoints: [{ position: { y: 3 } }] })).toBe('0,3,0')
  })

  it('returns empty (leave the player alone) when the base is unusable', () => {
    expect(spawnWorldPosition({ scene: { base: 'nonsense' } })).toBe('')
    expect(spawnWorldPosition({})).toBe('8,0,8') // no base at all is the 0,0 default
  })
})
