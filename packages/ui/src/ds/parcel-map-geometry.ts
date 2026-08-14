// Axis layout for ParcelMap.
//
// A world's parcels live anywhere in -150..150, and two scenes in the same world
// are routinely far apart — a scene on 0,0..8,4 next to one on 100,0 spans 102
// columns of which 91 hold nothing. Drawing that literally is both unreadable
// and thousands of dead cells, so a long enough run of empty lines collapses to
// a single gap marker. The result stays truthful about what matters: which
// parcels are taken, and whether two scenes are adjacent or nowhere near.
//
// A one-parcel border is always kept, so there is visibly room to grow outward.

export type Track = { kind: 'coord'; at: number } | { kind: 'gap'; span: number }

/** Empty lines in a row this long or longer collapse into one gap marker. */
export const MIN_GAP = 3

export function axisTracks(occupied: number[], minGap: number = MIN_GAP): Track[] {
  if (occupied.length === 0) return []
  const taken = new Set(occupied)
  const lo = Math.min(...occupied) - 1
  const hi = Math.max(...occupied) + 1
  const out: Track[] = []
  let run: number[] = []
  const flush = (): void => {
    if (run.length === 0) return
    if (run.length >= minGap) out.push({ kind: 'gap', span: run.length })
    else for (const at of run) out.push({ kind: 'coord', at })
    run = []
  }
  for (let v = lo; v <= hi; v++) {
    if (taken.has(v)) {
      flush()
      out.push({ kind: 'coord', at: v })
    } else {
      run.push(v)
    }
  }
  flush()
  return out
}

export interface MapAxes {
  cols: Track[]
  /** north up: descending y, the same orientation the scene settings grid uses */
  rows: Track[]
}

export function axesFor(parcels: string[]): MapAxes {
  const xs: number[] = []
  const ys: number[] = []
  for (const p of parcels) {
    const [x, y] = p.split(',').map(Number)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x)
      ys.push(y)
    }
  }
  return { cols: axisTracks(xs), rows: axisTracks(ys).reverse() }
}
