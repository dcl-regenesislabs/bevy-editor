// Per-scene drill-down: spark charts from the accumulated poll history plus the
// full latest snapshot, every group and field the engine reported.
import { barPercent, niceMax } from '../worlds/chart-geometry'
import type { SceneRow, SceneStatsEntry } from './ops-data'
import { formatBytes, formatRate } from './ops-data'
import { seriesOf } from './ops-history'

function Spark(props: { label: string; values: Array<number | null>; format: (v: number) => string }): JSX.Element {
  const max = niceMax(props.values)
  const last = [...props.values].reverse().find((v) => v !== null)
  return (
    <div className="eui-ops-spark">
      <div className="eui-ops-spark-head">
        <span>{props.label}</span>
        <span>{last === null || last === undefined ? '—' : props.format(last)}</span>
      </div>
      <div className="eui-ops-spark-plot">
        {props.values.map((value, i) => {
          const pct = barPercent(value, max)
          return <i key={i} style={pct !== null ? { height: `${Math.max(pct, 2)}%` } : { height: 0 }} />
        })}
      </div>
    </div>
  )
}

export function OpsSceneDetail(props: { samples: SceneRow[]; entry: SceneStatsEntry | undefined }): JSX.Element {
  const { samples, entry } = props
  const groups = entry?.latest?.stats ?? {}
  const windowSeconds = entry?.latest?.windowSeconds
  return (
    <div className="eui-ops-detail">
      <div className="eui-ops-sparks">
        <Spark label="CPU ms/s" values={seriesOf(samples, (r) => r.cpuMsPerSec)} format={formatRate} />
        <Spark label="CRDT/s" values={seriesOf(samples, (r) => r.crdtBytesPerSec)} format={formatBytes} />
        <Spark label="Heap" values={seriesOf(samples, (r) => r.heapUsedBytes)} format={formatBytes} />
        <Spark label="Players" values={seriesOf(samples, (r) => r.participants)} format={String} />
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
          <span className="eui-ops-window">raw values over the last {Math.round(windowSeconds)}s window · {samples.length} samples charted</span>
        )}
      </div>
    </div>
  )
}
