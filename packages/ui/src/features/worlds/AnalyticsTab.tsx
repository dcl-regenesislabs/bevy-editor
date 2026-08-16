import { useMemo, useState } from 'react'
import { PanelState, Segmented, useLoad } from '../../ds'
import { IconDesktop, IconMobile } from '../../icons'
import { formatCount, formatMinutes, formatPercent1 } from '../../lib/format'
import { rankByVisitors, sceneMetrics, visitorCounts, worldMetrics, type WorldSnapshot } from './analytics'
import { publishFirstNote } from './common'
import type { WorldEntry, WorldScene } from './inventory'
import {
  hasNoData,
  projectScene,
  RETENTION_MIN_VISITORS,
  type MetricsWindow,
  type SceneView,
  type TrendVerdict
} from './metrics-read'
import { sceneKeyOf, sceneTotalOf } from './scene-label'
import { ScenePick } from './ScenePick'
import { Trend } from './Trend'

const MISSING = 'Not in the latest update'

const PUBLISH_FIRST = 'Visitor numbers are counted per scene.'

export function AnalyticsTab(props: { w: WorldEntry; picked: string[]; onPick: (key: string) => void }): JSX.Element {
  const { w } = props
  if (w.scenes.length === 0) {
    return (
      <ScenePick
        w={w}
        picked={props.picked}
        onPick={props.onPick}
        publishFirst={publishFirstNote(PUBLISH_FIRST, w.name)}
        render={() => null}
      />
    )
  }
  return <Visitors w={w} picked={props.picked} onPick={props.onPick} />
}

function Visitors(props: { w: WorldEntry; picked: string[]; onPick: (key: string) => void }): JSX.Element {
  const { w } = props
  const total = sceneTotalOf(w)
  const { data, err, reload } = useLoad(() => worldMetrics(w), [w.name])
  const [window, setWindow] = useState<MetricsWindow>('30d')
  const visitors = useMemo(() => visitorCounts(w, data, window), [w, data, window])
  return (
    <section className="eui-world-block">
      <div className="eui-world-vhead">
        <h2>Visitors</h2>
        <span className="eui-world-asof">{scopeLine(data?.exportedAt ?? null)}</span>
      </div>
      {total > 1 && (
        <p className="eui-world-hint">
          This world hosts {total} scenes. Each one is counted on its own — the same visitor can show up in
          more than one, so they don't add up to a world total.
        </p>
      )}
      <div className="eui-world-headline">
        <Segmented
          value={window}
          onChange={setWindow}
          aria-label="Reporting window"
          options={[
            { value: '30d', label: '30 days' },
            { value: '60d', label: '60 days' }
          ]}
        />
      </div>
      <PanelState err={err} onRetry={reload} loading={data === undefined && err === null} />
      {data !== undefined && (
        <ScenePick
          w={w}
          picked={props.picked}
          onPick={props.onPick}
          publishFirst={publishFirstNote(PUBLISH_FIRST, w.name)}
          order={(scenes) => rankByVisitors(w, scenes, visitors)}
          note={(s) => {
            const n = visitors.get(sceneKeyOf(w, s))
            return n === undefined || n === null ? '— no data yet' : `${formatCount(n)} visitors`
          }}
          render={(s) => <SceneVisitors w={w} scene={s} snapshot={data} window={window} />}
        />
      )}
    </section>
  )
}

function SceneVisitors(props: {
  w: WorldEntry
  scene: WorldScene
  snapshot: WorldSnapshot
  window: MetricsWindow
}): JSX.Element {
  const loc = sceneMetrics(props.snapshot.byScene, sceneKeyOf(props.w, props.scene))
  if (hasNoData(loc)) return <NoData />
  return (
    <SceneNumbers
      view={projectScene(loc, props.snapshot.exportedAt, props.window)}
      window={props.window}
      publishedAt={props.scene.timestamp}
    />
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

function SceneNumbers(props: { view: SceneView; window: MetricsWindow; publishedAt: number | null }): JSX.Element {
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
      </div>
      <p className="eui-world-trend">{trendSentence(v.trend)}</p>
      <div className="eui-world-facts tiles">
        <Fact
          tip={v.playtimeSeconds === null ? MISSING : undefined}
          stats={[{ label: 'Time per visit', value: formatMinutes(v.playtimeSeconds) }]}
        />
        <Fact
          tip={returnTip(v.retentionSuppressed, v.visitors)}
          stats={[{ label: 'Came back in a week', value: formatPercent1(v.retention) }]}
        />
        <Fact
          tip={PLATFORM_DEF}
          stats={[
            { label: 'On desktop', value: formatCount(v.desktop), icon: IconDesktop },
            { label: 'On mobile', value: formatCount(v.mobile), icon: IconMobile }
          ]}
        />
      </div>
      <Trend weeks={v.weeks} publishedAt={props.publishedAt} />
    </>
  )
}

function Fact(props: {
  stats: Array<{ label: string; value: string; icon?: () => JSX.Element }>
  tip?: string
}): JSX.Element {
  return (
    <div className={props.stats.length > 1 ? 'eui-world-fact bare rows' : 'eui-world-fact bare'}>
      {props.stats.map((s) => (
        <span key={s.label} className="r">
          <span className="v" data-tip={props.tip}>
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

// Two facts, and neither may be read as the other: how fresh this snapshot is,
// and how often a new one arrives. "Counted once a day" said both at once and
// landed as neither — it reads as a rule about the visitors (that a person is
// only counted once per day), which is a claim about the numbers we cannot make.
function scopeLine(exportedAt: string | null): string {
  const day = exportDay(exportedAt)
  return day === null ? 'updated daily' : `as of ${day} · updated daily`
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
