import { barPercent, busiestOf, captionOf, extentOf, markerPercent, niceMax, weekLabel } from './chart-geometry'
import { formatCount } from '../../lib/format'
import type { WeekBucket } from './metrics-read'

export function Trend(props: { weeks: WeekBucket[]; publishedAt: number | null }): JSX.Element | null {
  const { weeks } = props
  const extent = extentOf(weeks)
  if (extent === null) return null
  const marker = markerPercent(props.publishedAt, extent.start, extent.end)
  const caption = captionOf(weeks, marker)
  const busiest = busiestOf(weeks)
  const max = niceMax(weeks.map((b) => b.value))
  return (
    <div className="eui-world-plot">
      <div className="eui-world-chead">
        <span className="k">Visitors per week</span>
        <span className="eui-world-ckey">
          {marker !== null && (
            <span className="s">
              <i className="rule" />
              published
            </span>
          )}
          {busiest !== null && <span className="s">busiest {formatCount(busiest)}</span>}
        </span>
      </div>
      <div className="eui-world-chart" role="img" aria-label={caption}>
        {weeks.map((b) => {
          const pct = barPercent(b.value, max)
          return (
            <div key={b.start} className="col">
              <span className="n">
                {b.value === null ? '—' : `${formatCount(b.value)}${b.partial ? ' so far' : ''}`}
              </span>
              {pct !== null && <i className={b.partial ? 'partial' : undefined} style={{ height: `${pct}%` }} />}
            </div>
          )
        })}
        {marker !== null && <span className="rule" style={{ left: `${marker}%` }} />}
      </div>
      <div className="eui-world-chartx">
        {weeks.map((b) => (
          <span key={b.start}>{weekLabel(b.start)}</span>
        ))}
      </div>
    </div>
  )
}
