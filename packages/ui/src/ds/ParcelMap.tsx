import type { CSSProperties, MouseEvent } from 'react'
import { useMemo } from 'react'
import css from './ParcelMap.css?inline'
import { axesFor } from './parcel-map-geometry'
import { registerCss } from './styles/registry'

registerCss('ds/ParcelMap', 'primitives', css)

const HUES = [222, 158, 28, 288, 190, 344]

const MEANING: Record<ParcelToneName, CSSProperties> = {
  mine: { ['--map-tone' as string]: 'var(--primary-selected)', ['--map-tone-line' as string]: 'var(--primary)' },
  replaced: { ['--map-tone' as string]: 'var(--error-hover)', ['--map-tone-line' as string]: 'var(--error)' },
  staying: { ['--map-tone' as string]: 'var(--divider)', ['--map-tone-line' as string]: 'var(--text-3)' }
}

export type ParcelToneName = 'mine' | 'replaced' | 'staying'

export function parcelTone(tone: number | ParcelToneName): CSSProperties {
  if (typeof tone === 'string') return MEANING[tone]
  const h = HUES[((tone % HUES.length) + HUES.length) % HUES.length]
  return {
    ['--map-tone' as string]: `hsl(${h} 55% 52% / .5)`,
    ['--map-tone-line' as string]: `hsl(${h} 62% 58%)`
  }
}

// A gap track is drawn one cell wide, and every track carries a 3px gutter, so
// the budget divides by tracks + 1 rather than by tracks.
function cellSize(axes: { cols: unknown[]; rows: unknown[] }, base: number, fit?: { width: number; height: number }): number {
  if (fit === undefined) return base
  const across = Math.floor(fit.width / (axes.cols.length + 1)) - 3
  const down = Math.floor(fit.height / (axes.rows.length + 1)) - 3
  return Math.max(3, Math.min(base, across, down))
}

export interface ParcelRegion {
  key: string
  parcels: string[]
  label: string
  tone: number | ParcelToneName
  base?: string | null
}

export function ParcelMap(props: {
  regions: ParcelRegion[]
  cell?: number
  /** Shrink the cell so the whole map fits this box. A footprint can be 50x50 —
   *  bigger than any dialog — and the scenes it would replace sort to the bottom,
   *  so a map that overflows hides exactly what the creator came to check. */
  fit?: { width: number; height: number }
  selected?: string | null
  onSelect?: (key: string) => void
  onContext?: (key: string, e: MouseEvent) => void
  onToggle?: (coord: string) => void
}): JSX.Element {
  const { regions, selected = null, onSelect, onContext, onToggle } = props

  const at = useMemo(() => {
    const m = new Map<string, ParcelRegion>()
    for (const r of regions) for (const p of r.parcels) m.set(p, r)
    return m
  }, [regions])

  const axes = useMemo(() => axesFor(regions.flatMap((r) => r.parcels)), [regions])

  const style: CSSProperties = { ['--map-cell' as string]: `${cellSize(axes, props.cell ?? 22, props.fit)}px` }

  return (
    <div className="eui-ds-map" style={style}>
      {axes.rows.map((row, ri) =>
        row.kind === 'gap' ? (
          <div key={`g${ri}`} className="eui-ds-map-gap rowgap" data-tip={`${row.span} empty rows`} />
        ) : (
          <div key={row.at} className="eui-ds-map-row">
            {axes.cols.map((col, ci) => {
              if (col.kind === 'gap') {
                return <div key={`g${ci}`} className="eui-ds-map-gap" data-tip={`${col.span} empty columns`} />
              }
              const coord = `${col.at},${row.at}`
              const region = at.get(coord) ?? null
              const dim = selected !== null && region !== null && region.key !== selected
              const lit = selected !== null && region !== null && region.key === selected
              const cls = [
                'eui-ds-map-cell',
                region !== null ? 'on' : '',
                region !== null && region.base === coord ? 'base' : '',
                lit ? 'lit' : '',
                dim ? 'dim' : '',
                onToggle !== undefined || region !== null ? 'act' : ''
              ]
                .filter(Boolean)
                .join(' ')
              const tip = region !== null ? `${region.label} · ${coord}` : coord
              const paint = region !== null ? parcelTone(region.tone) : undefined
              if (onToggle === undefined && region === null) {
                return <div key={coord} className={cls} data-tip={tip} />
              }
              return (
                <button
                  key={coord}
                  type="button"
                  className={cls}
                  style={paint}
                  data-tip={tip}
                  aria-label={tip}
                  onClick={() => {
                    if (onToggle !== undefined) onToggle(coord)
                    else if (region !== null && onSelect !== undefined) onSelect(region.key)
                  }}
                  onContextMenu={(e) => {
                    if (region === null || onContext === undefined) return
                    e.preventDefault()
                    onContext(region.key, e)
                  }}
                />
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
