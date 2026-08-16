import { describe, expect, it } from 'vitest'
import { axesFor, axisTracks } from './parcel-map-geometry'

describe('axisTracks', () => {
  it('keeps a one-parcel border so there is visibly room to grow', () => {
    expect(axisTracks([0, 1])).toEqual([
      { kind: 'coord', at: -1 },
      { kind: 'coord', at: 0 },
      { kind: 'coord', at: 1 },
      { kind: 'coord', at: 2 }
    ])
  })

  it('keeps short voids literal — a two-parcel gap is adjacency information', () => {
    expect(axisTracks([0, 3]).filter((t) => t.kind === 'gap')).toEqual([])
  })

  it('collapses a long void into one marker rather than 91 dead cells', () => {
    const tracks = axisTracks([0, 100])
    expect(tracks).toEqual([
      { kind: 'coord', at: -1 },
      { kind: 'coord', at: 0 },
      { kind: 'gap', span: 99 },
      { kind: 'coord', at: 100 },
      { kind: 'coord', at: 101 }
    ])
  })

  it('handles negative coordinates', () => {
    expect(axisTracks([-150, -149])).toEqual([
      { kind: 'coord', at: -151 },
      { kind: 'coord', at: -150 },
      { kind: 'coord', at: -149 },
      { kind: 'coord', at: -148 }
    ])
  })

  it('is empty for a world with nothing in it', () => {
    expect(axisTracks([])).toEqual([])
  })
})

describe('axesFor', () => {
  it('puts north up', () => {
    const { rows } = axesFor(['0,0', '0,1'])
    expect(rows.map((r) => (r.kind === 'coord' ? r.at : 'gap'))).toEqual([2, 1, 0, -1])
  })

  it('ignores a parcel it cannot read rather than skewing the bounds', () => {
    const { cols } = axesFor(['0,0', 'not-a-parcel'])
    expect(cols).toEqual([
      { kind: 'coord', at: -1 },
      { kind: 'coord', at: 0 },
      { kind: 'coord', at: 1 }
    ])
  })

  it('spans every scene in the world, not just the first', () => {
    const { cols } = axesFor(['0,0', '1,0', '8,4'])
    expect(cols).toEqual([
      { kind: 'coord', at: -1 },
      { kind: 'coord', at: 0 },
      { kind: 'coord', at: 1 },
      { kind: 'gap', span: 6 },
      { kind: 'coord', at: 8 },
      { kind: 'coord', at: 9 }
    ])
  })
})

describe('fitting a big footprint', () => {
  it('a 50x50 scene produces one track per column, so a fixed cell cannot fit a dialog', () => {
    const parcels: string[] = []
    for (let x = 0; x < 50; x++) for (let y = 0; y < 50; y++) parcels.push(`${x},${y}`)
    const { cols, rows } = axesFor(parcels)
    // 50 occupied plus the one-parcel border on each side, nothing to collapse
    expect(cols).toHaveLength(52)
    expect(rows).toHaveLength(52)
    // at the old fixed 10px that is 676px of cells in a 460px dialog
    expect(cols.length * 13).toBeGreaterThan(460)
  })
})
