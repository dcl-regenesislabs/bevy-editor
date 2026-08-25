// Per-scene drill-down: one chart per metric over the fixed 60-slot timeline
// (holes where no sample landed, a 1px tick for a true zero), each with a time
// axis and per-bar tooltips, plus the full latest snapshot below.
import { niceMax } from '../worlds/chart-geometry'
import type { SceneStatsEntry } from './ops-data'
import { METRIC_CHARTS, formatBytes, formatRate } from './ops-data'
import type { SceneTimeline } from './ops-history'
import { barHeight, barTip, seriesOf, timeLabel, timelineView } from './ops-history'

function Chart(props: {
  label: string
  values: Array<number | null>
  times: number[]
  format: (v: number) => string
}): JSX.Element {
  const max = niceMax(props.values)
  const last = [...props.values].reverse().find((v) => v !== null)
  const mid = props.times[Math.floor(props.times.length / 2)]
  return (
    <div className="eui-ops-chart">
      <div className="eui-ops-chart-head">
        <span>{props.label}</span>
        <span>{last === null || last === undefined ? '—' : props.format(last)}</span>
      </div>
      <div className="eui-ops-chart-plot">
        {max > 0 && <span className="eui-ops-chart-max">{props.format(max)}</span>}
        {props.values.map((value, i) => {
          const height = barHeight(value, max)
          return height === null ? (
            <i key={props.times[i]} className="eui-ops-hole" data-tip={barTip(props.times[i], value, props.format)} />
          ) : (
            <i key={props.times[i]} data-tip={barTip(props.times[i], value, props.format)} style={{ height }} />
          )
        })}
      </div>
      <div className="eui-ops-chart-axis">
        <span>{timeLabel(props.times[0])}</span>
        <span>{timeLabel(mid)}</span>
        <span>{timeLabel(props.times[props.times.length - 1])}</span>
      </div>
    </div>
  )
}

export function OpsSceneDetail(props: {
  timeline: SceneTimeline | undefined
  entry: SceneStatsEntry | undefined
  now: number
}): JSX.Element {
  const { entry, now } = props
  const view = timelineView(props.timeline, now)
  const samples = view.points.filter((p) => p !== null).length
  const groups = entry?.latest?.stats ?? {}
  const windowSeconds = entry?.latest?.windowSeconds
  return (
    <div className="eui-ops-detail">
      <div className="eui-ops-charts">
        {METRIC_CHARTS.map((chart) => (
          <Chart
            key={chart.key}
            label={chart.label}
            values={seriesOf(view.points, chart.key)}
            times={view.times}
            format={chart.format}
          />
        ))}
      </div>
      <div className="eui-ops-groups">
        {Object.entries(groups).map(([group, fields]) => (
          <div key={group} className="eui-ops-group">
            <span className="eui-ops-group-name">{group}</span>
            {Object.entries(fields ?? {}).map(([field, value]) => (
              <div key={field} className="eui-ops-field">
                <span>{field}</span>
                <span>{field.includes('bytes') || field.startsWith('heap') ? formatBytes(value) : formatRate(value)}</span>
              </div>
            ))}
          </div>
        ))}
        {windowSeconds !== undefined && (
          <span className="eui-ops-window">
            raw values over the last {Math.round(windowSeconds)}s window · {samples} of {view.points.length} slots
            sampled
          </span>
        )}
      </div>
    </div>
  )
}
