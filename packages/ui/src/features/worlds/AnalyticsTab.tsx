import { useState } from 'react'
import { PanelState, Segmented, useLoad } from '../../ds'
import { IconDesktop, IconMobile } from '../../icons'
import { formatAgo, formatCount, formatMinutes, formatPercent1 } from '../../lib/format'
import { sceneKey, worldMetrics, type WorldSnapshot } from './analytics'
import { PublishFirst } from './common'
import type { WorldEntry, WorldScene } from './inventory'
import {
  hasNoData,
  projectScene,
  RETENTION_MIN_VISITORS,
  type LocationMetrics,
  type MetricsWindow,
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
  const [window, setWindow] = useState<MetricsWindow>('30d')
  const key = picked ?? sceneKey(w, newestScene(w.scenes))
  const scene = w.scenes.find((s) => sceneKey(w, s) === key) ?? w.scenes[0]
  const multi = w.scenes.length > 1
  const label = sceneLabel(scene, w.scenes)
  return (
    <>
      {multi && <ScenesBlock w={w} snapshot={data} selected={key} onPick={setPicked} />}
      <section className="eui-world-block">
        <div className="eui-world-vhead">
          <h2>{multi ? `Visitors — ${label}` : 'Visitors'}</h2>
          <span className="eui-world-asof">{scopeLine(data?.exportedAt ?? null)}</span>
        </div>
        <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
        {data !== undefined &&
          (hasNoData(lookup(data.byScene, key)) ? (
            <NoData />
          ) : (
            <SceneNumbers
              view={projectScene(lookup(data.byScene, key), data.exportedAt, window)}
              window={window}
              onWindow={setWindow}
              publishedAt={scene.timestamp}
            />
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

function SceneNumbers(props: {
  view: SceneView
  window: MetricsWindow
  onWindow: (w: MetricsWindow) => void
  publishedAt: number | null
}): JSX.Element {
  const v = props.view
  const days = props.window === '30d' ? '30' : '60'
  return (
    <>
      <div className="eui-world-headline">
        {v.visitors !== null && (
          <p className="eui-world-answer">
            <span className="n">{formatCount(v.visitors)}</span>
            <span className="k">
              visitors, last {days} days
              {v.visitsEach !== null && ` · ${v.visitsEach.toFixed(1)} visits each`}
            </span>
          </p>
        )}
        <Segmented
          value={props.window}
          onChange={props.onWindow}
          options={[
            { value: '30d', label: '30 days' },
            { value: '60d', label: '60 days' }
          ]}
        />
      </div>
      <p className="eui-world-trend">{trendSentence(v.trend)}</p>
      <div className="eui-world-facts tiles">
        <Fact
          stats={[
            { label: 'Time per visit', value: formatMinutes(v.playtimeSeconds), missing: v.playtimeSeconds === null }
          ]}
        />
        <Fact
          tip={returnTip(v.retentionSuppressed, v.visitors)}
          stats={[
            {
              label: 'Came back in a week',
              value: formatPercent1(v.retention),
              missing: v.retention === null && !v.retentionSuppressed
            }
          ]}
        />
        <Fact
          tip={PLATFORM_DEF}
          stats={[
            { label: 'On desktop', value: formatCount(v.desktop), missing: v.desktop === null, icon: IconDesktop },
            { label: 'On mobile', value: formatCount(v.mobile), missing: v.mobile === null, icon: IconMobile }
          ]}
        />
      </div>
      <Trend weeks={v.weeks} publishedAt={props.publishedAt} />
    </>
  )
}

function Fact(props: {
  stats: Array<{ label: string; value: string; missing: boolean; icon?: () => JSX.Element }>
  tip?: string
}): JSX.Element {
  return (
    <div className={props.stats.length > 1 ? 'eui-world-fact bare rows' : 'eui-world-fact bare'}>
      {props.stats.map((s) => (
        <span key={s.label} className="r">
          <span className="v" data-tip={props.tip ?? (s.missing ? MISSING : undefined)}>
            {s.value}
          </span>
          <span className="k">
            {s.icon !== undefined && <s.icon />}
            {s.label}
          </span>
        </span>
      ))}
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

// The scope ("this scene, once a day") is carried by the heading and the tab it
// sits in; only the freshness needs saying, and it reads as a stamp, not prose.
function scopeLine(exportedAt: string | null): string {
  const day = exportDay(exportedAt)
  return day === null ? 'counted once a day' : `counted once a day, up to ${day}`
}

// The tile's label is the short version; the tooltip is the definition, because
// "came back" reads as "any visitor returned" when the metric is narrower than
// that — it counts only people whose FIRST visit fell in the window.
const RETURN_DEF = 'Of the people who first visited in this window, the share who came back within 7 days.'

// Two raw counts, never a share: someone who played on both is counted in each,
// so desktop and mobile do not add up to the visitor count above them.
const PLATFORM_DEF = 'Counted separately — someone who played on both is in both, so these do not add up to the total.'

function returnTip(suppressed: boolean, visitors: number | null): string {
  if (!suppressed) return RETURN_DEF
  return `${RETURN_DEF} Needs at least ${RETENTION_MIN_VISITORS} of them before it means anything — this scene has ${formatCount(visitors)}.`
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
