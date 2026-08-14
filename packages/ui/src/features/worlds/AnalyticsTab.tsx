import { useState } from 'react'
import { PanelState, useLoad } from '../../ds'
import { formatAgo, formatCount, formatMinutes, formatPercent1 } from '../../lib/format'
import { sceneKey, worldMetrics, type WorldSnapshot } from './analytics'
import { PublishFirst } from './common'
import type { WorldEntry, WorldScene } from './inventory'
import {
  hasNoData,
  projectScene,
  RETENTION_MIN_VISITORS,
  type LocationMetrics,
  type SceneView,
  type TrendVerdict
} from './metrics-read'
import { Trend } from './Trend'

const MISSING = 'Not in the latest update'

const EMPTY: LocationMetrics = { location_key: '', builder_project_id: null, metrics: {} }

export function AnalyticsTab(props: { w: WorldEntry }): JSX.Element {
  const { w } = props
  if (w.deployment === null) return <PublishFirst what="Analytics" />
  if (w.scenes.length === 0) {
    return (
      <section className="eui-world-block">
        <h2>Visitors</h2>
        <p className="eui-world-hint">
          This world's published scene doesn't record where it sits, so there are no numbers to show.
        </p>
        <p className="eui-world-hint">Publish it again from Decentraland Studio and it will.</p>
      </section>
    )
  }
  return <Visitors w={w} />
}

function Visitors(props: { w: WorldEntry }): JSX.Element {
  const { w } = props
  const { data, err, reload } = useLoad(() => worldMetrics(w), [w.name])
  const [picked, setPicked] = useState<string | null>(null)
  const key = picked ?? sceneKey(w, newestScene(w.scenes))
  const scene = w.scenes.find((s) => sceneKey(w, s) === key) ?? w.scenes[0]
  const multi = w.scenes.length > 1
  const label = sceneLabel(scene, w.scenes)
  return (
    <>
      {multi && <ScenesBlock w={w} snapshot={data} selected={key} onPick={setPicked} />}
      <section className="eui-world-block">
        <h2>{multi ? `Visitors — ${label}` : 'Visitors'}</h2>
        <p className="eui-world-hint">{scopeLine(multi ? label : null, data?.exportedAt ?? null)}</p>
        <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
        {data !== undefined &&
          (hasNoData(lookup(data.byScene, key)) ? (
            <NoData />
          ) : (
            <SceneNumbers view={projectScene(lookup(data.byScene, key), data.exportedAt)} publishedAt={scene.timestamp} />
          ))}
      </section>
    </>
  )
}

function NoData(): JSX.Element {
  return (
    <>
      <p className="eui-world-hint">No numbers for this scene in the latest daily update.</p>
      <p className="eui-world-hint">
        A scene that was just published takes a few days to appear. If it has been live longer than that, nobody has
        visited it yet.
      </p>
    </>
  )
}

function SceneNumbers(props: { view: SceneView; publishedAt: number | null }): JSX.Element {
  const v = props.view
  return (
    <>
      {v.visitors !== null && (
        <p className="eui-world-answer">
          {formatCount(v.visitors)} visitors in the last 30 days
          {v.visitsEach !== null && ` · ${v.visitsEach.toFixed(1)} visits each`}
        </p>
      )}
      <p className="eui-world-hint">{trendSentence(v.trend)}</p>
      <div className="eui-world-facts">
        <Fact label="Time per visit" value={formatMinutes(v.playtimeSeconds)} missing={v.playtimeSeconds === null} />
        <Fact
          label="Came back within a week"
          value={formatPercent1(v.retention)}
          missing={v.retention === null && !v.retentionSuppressed}
        />
        <Fact
          label="On mobile"
          value={formatCount(v.mobile)}
          missing={v.mobile === null}
          note={v.desktop === null ? undefined : `${formatCount(v.desktop)} on desktop`}
        />
      </div>
      {v.retentionSuppressed && (
        <p className="eui-world-hint">
          Came back within a week needs at least {RETENTION_MIN_VISITORS} visitors before it means anything — this scene
          has {formatCount(v.visitors)}.
        </p>
      )}
      <Trend weeks={v.weeks} publishedAt={props.publishedAt} />
    </>
  )
}

function Fact(props: { label: string; value: string; missing: boolean; note?: string }): JSX.Element {
  return (
    <div className="eui-world-fact bare">
      <span className="k">{props.label}</span>
      <span className="v" data-tip={props.missing ? MISSING : undefined}>
        {props.value}
      </span>
      {props.note !== undefined && <span className="s">{props.note}</span>}
    </div>
  )
}

interface SceneRow {
  key: string
  scene: WorldScene
  label: string
  visitors: number | null
}

function ScenesBlock(props: {
  w: WorldEntry
  snapshot: WorldSnapshot | undefined
  selected: string
  onPick: (key: string) => void
}): JSX.Element {
  const { w, snapshot } = props
  return (
    <section className="eui-world-block">
      <h2>Scenes published here</h2>
      <p className="eui-world-hint">
        This world hosts {w.scenes.length} scenes. Each one is counted on its own — the same visitor can show up in more
        than one, so they don't add up to a world total.
      </p>
      <div className="eui-world-scenes scroll">
        {orderScenes(w, snapshot).map((r) => (
          <button
            key={r.key}
            className="eui-world-scene pick"
            aria-pressed={r.key === props.selected}
            onClick={() => props.onPick(r.key)}
          >
            {r.scene.thumbnail !== null ? (
              <img src={r.scene.thumbnail} alt="" crossOrigin="anonymous" loading="lazy" />
            ) : (
              <span className="ph">⛶</span>
            )}
            <div className="meta">
              <span className="nm">{r.label}</span>
              {r.scene.timestamp !== null && <span className="sub">published {formatAgo(r.scene.timestamp)}</span>}
            </div>
            {snapshot !== undefined && (
              <span className="eui-world-num">
                {r.visitors === null ? '— no data yet' : `${formatCount(r.visitors)} visitors`}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

function lookup(byScene: Record<string, LocationMetrics>, key: string): LocationMetrics {
  return key in byScene ? byScene[key] : EMPTY
}

function newestScene(scenes: WorldScene[]): WorldScene {
  return scenes.reduce((best, s) => ((s.timestamp ?? 0) > (best.timestamp ?? 0) ? s : best), scenes[0])
}

function sceneLabel(s: WorldScene, all: WorldScene[]): string {
  if (s.title === null) return `Scene at ${s.x},${s.y}`
  return all.filter((o) => o.title === s.title).length > 1 ? `${s.title} (${s.x},${s.y})` : s.title
}

function orderScenes(w: WorldEntry, snapshot: WorldSnapshot | undefined): SceneRow[] {
  const rows = w.scenes.map((scene) => {
    const key = sceneKey(w, scene)
    return {
      key,
      scene,
      label: sceneLabel(scene, w.scenes),
      visitors: snapshot === undefined ? null : projectScene(lookup(snapshot.byScene, key), snapshot.exportedAt).visitors
    }
  })
  if (snapshot === undefined) return rows
  return rows.sort((a, b) => {
    if (a.visitors === b.visitors) return a.label.localeCompare(b.label)
    if (a.visitors === null) return 1
    if (b.visitors === null) return -1
    return b.visitors - a.visitors
  })
}

function scopeLine(label: string | null, exportedAt: string | null): string {
  const scope = label === null ? 'the scene published here' : label
  const day = exportDay(exportedAt)
  return day === null
    ? `Counted for ${scope}, once a day.`
    : `Counted for ${scope}, once a day — these numbers cover everything up to ${day}.`
}

function exportDay(exportedAt: string | null): string | null {
  if (exportedAt === null) return null
  const ms = Date.parse(exportedAt)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function trendSentence(t: TrendVerdict): string {
  const recent = formatCount(t.recent)
  const prior = formatCount(t.prior)
  if (t.kind === 'up') {
    return `Growing — ${recent} visitors a week over the last four weeks, up from ${prior} in the four before.`
  }
  if (t.kind === 'down') {
    return `Falling — ${recent} visitors a week over the last four weeks, down from ${prior} in the four before.`
  }
  if (t.kind === 'flat') return `Steady — about ${recent} visitors a week, the same as the four weeks before.`
  if (t.kind === 'small') return `Around ${recent} visitors a week — too few to call a direction yet.`
  return 'Not enough complete weeks yet to say which way this is going.'
}
