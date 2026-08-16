import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AnalyticsModule from './analytics'
import type { WorldEntry, WorldScene } from './inventory'
import type { LocationMetrics, MetricBag, MetricRow } from './metrics-read'
import { mount } from '../../test/render'

// Only worldMetrics is replaced: sceneKey stays real, so the component and the
// fixtures below have to agree on the same scene ids the client would build.
const metrics = vi.fn()

vi.mock('./analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyticsModule>()
  return { ...actual, worldMetrics: (w: WorldEntry) => metrics(w) }
})
vi.mock('./signed-fetch', () => ({ signedFetch: () => Promise.reject(new Error('no network in a render test')) }))
vi.mock('../account/auth', () => ({ getAccount: () => '0xowner' }))

import { AnalyticsTab } from './AnalyticsTab'

const EXPORTED = '2026-08-12T00:17:01.099Z'

const scene = (x: number, y: number, over: Partial<WorldScene> = {}): WorldScene => ({
  x,
  y,
  parcels: [`${x},${y}`],
  title: null,
  deployer: null,
  timestamp: null,
  thumbnail: null,
  entityId: null,
  size: null,
  status: 'DEPLOYED',
  authoritativeMultiplayer: false,
  ...over
})

const world = (over: Partial<WorldEntry> = {}): WorldEntry => ({
  name: 'cozyfarm.dcl.eth',
  role: 'owner',
  size: null,
  scenes: [],
  sceneCount: { known: true, total: 0 },
  settings: null,
  image: null,
  userCount: null,
  ...over
})

const loc = (bag: MetricBag): LocationMetrics => ({ location_key: 'cozyfarm.dcl.eth|0|0', builder_project_id: null, metrics: bag })

const flat = (value: number, series = 'all'): MetricRow => ({ series, period: null, value })

// Eight complete Monday buckets, 15 Jun → 3 Aug. prior mean 242.5, recent 523 —
// comfortably past the ±15% band, so the trend sentence is "Growing".
const WEEKS: Array<[string, number]> = [
  ['2026-06-15', 180],
  ['2026-06-22', 240],
  ['2026-06-29', 240],
  ['2026-07-06', 310],
  ['2026-07-13', 520],
  ['2026-07-20', 620],
  ['2026-07-27', 540],
  ['2026-08-03', 412]
]

const weekly = (pairs: Array<[string, number]> = WEEKS): MetricRow[] =>
  pairs.map(([period, value]) => ({ series: 'all', period, value }))

const busy = (over: Partial<MetricBag> = {}): MetricBag => ({
  unique_visitors_30d: [flat(2772), flat(2583, 'mobile'), flat(50, 'desktop')],
  unique_visits_30d: [flat(6098)],
  avg_playtime_seconds_30d: [flat(240)],
  d7_retention_rate_30d: [flat(0.084)],
  unique_visitors_weekly: weekly(),
  ...over
})

beforeEach(() => {
  metrics.mockReset()
})

describe('AnalyticsTab gates', () => {
  // The gate is "are there scenes to count", and there is no longer any single
  // scene standing in for the world to gate on instead — a world whose first
  // scene read short used to be told to publish what it had already published.
  it('names the per-scene counting when nothing is published here', () => {
    const view = mount(<AnalyticsTab w={world()} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toBe('Visitor numbers are counted per scene. Publish a scene to cozyfarm.dcl.eth first.')
    expect(metrics).not.toHaveBeenCalled()
    view.unmount()
  })

  // Nothing is known to be missing here — the read failed. "Publish a scene
  // first" would be an instruction to republish what may already be live.
  it('says the world read short rather than blaming the creator for it', () => {
    const view = mount(<AnalyticsTab w={world({ sceneCount: { known: false } })} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toBe("Part of cozyfarm.dcl.eth couldn't be read, so this list may be missing scenes.")
    expect(metrics).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('AnalyticsTab load states', () => {
  it('shows the freshness line and a spinner before the snapshot lands', () => {
    metrics.mockReturnValue(new Promise(() => {}))
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    expect(view.text()).toContain('updated daily')
    expect(view.text()).toContain('Loading…')
    expect(view.text()).not.toContain('No numbers for this scene')
    view.unmount()
  })

  it('keeps a failed request structurally distinct from an empty one', async () => {
    metrics.mockRejectedValue(new Error("Your sign-in wasn't recognised — sign out and back in."))
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.text()).toContain("Your sign-in wasn't recognised — sign out and back in.")
    expect(view.byText('Retry', 'button')).not.toBeNull()
    expect(view.text()).not.toContain('No numbers for this scene in the latest daily update.')
    expect(view.text()).not.toContain('nobody has visited it yet')
    expect(view.find('.eui-world-answer')).toBeNull()
    expect(view.find('.eui-world-chart')).toBeNull()
    view.unmount()
  })

  it('keeps an empty bag structurally distinct from a failure, heading and freshness intact', async () => {
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc({}) } })
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.byText('Visitors', 'h2')).not.toBeNull()
    expect(view.text()).toContain('as of 12 Aug 2026 · updated daily')
    expect(view.text()).toContain('No numbers for this scene in the latest daily update.')
    expect(view.text()).toContain(
      'A scene that was just published takes a few days to appear. If it has been live longer than that, nobody has visited it yet.'
    )
    expect(view.byText('Retry', 'button')).toBeNull()
    expect(view.find('.eui-world-answer')).toBeNull()
    view.unmount()
  })
})

describe('AnalyticsTab numbers', () => {
  it('answers in words before any graphic, and prints every bar as text', async () => {
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy()) } })
    const w = world({ scenes: [scene(0, 0, { timestamp: Date.UTC(2026, 7, 5) })] })
    const view = mount(<AnalyticsTab w={w} picked={[]} onPick={() => undefined} />)
    await view.settle()

    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772visitors, last 30 days · 2.2 visits each')
    expect(view.text()).toContain('Growing — 523 visitors a week over the last four weeks, up from 243 in the four before.')
    // desktop and mobile are peers, not a value and its footnote
    expect(view.all('.eui-world-fact.bare .v').map((el) => el.textContent)).toEqual(['4.0 min', '8.4%', '50', '2,583'])
    expect(view.all('.eui-world-fact.bare .k').map((el) => el.textContent)).toEqual([
      'Time per visit',
      'Came back in a week',
      'On desktop',
      'On mobile'
    ])
    // the definition rides the tile even when the rate is shown — "came back" alone is broader than the metric
    expect(view.all('.eui-world-fact.bare .v')[1].getAttribute('data-tip')).toBe(
      'Of the people who first visited in this window, the share who came back within 7 days.'
    )

    const plot = view.find('.eui-world-chart')
    expect(plot?.getAttribute('role')).toBe('img')
    expect(plot?.getAttribute('aria-label')).toBe(
      'Visitors per week, 13 Jul to 10 Aug — the busiest week was 620. The dashed line is when you last published this scene.'
    )
    // the 30-day window: the chart is cut to it, the trend sentence above is not
    expect(view.all('.eui-world-chart .n').map((el) => el.textContent)).toEqual([
      '520',
      '620',
      '540',
      '412',
      '—' // the week still filling at the export stamp: a gap, never a zero
    ])
    expect(view.all('.eui-world-chart i')).toHaveLength(4)
    expect(view.all('.eui-world-chart .rule')).toHaveLength(1)
    expect(view.all('.eui-world-chartx span').map((el) => el.textContent)).toEqual([
      '13 Jul',
      '20 Jul',
      '27 Jul',
      '3 Aug',
      '10 Aug'
    ])
    view.unmount()
  })

  it('labels a week with no row and draws no bar for it', async () => {
    const holed = WEEKS.filter(([period]) => period !== '2026-07-20')
    metrics.mockResolvedValue({
      exportedAt: EXPORTED,
      byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy({ unique_visitors_weekly: weekly(holed) })) }
    })
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.all('.eui-world-chart .n').map((el) => el.textContent)[1]).toBe('—')
    expect(view.all('.eui-world-chart i')).toHaveLength(3)
    expect(view.text()).toContain('Not enough complete weeks yet to say which way this is going.')
    view.unmount()
  })

  it('withholds the return rate under the floor and says why', async () => {
    const small = busy({ unique_visitors_30d: [flat(12), flat(9, 'mobile'), flat(3, 'desktop')] })
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(small) } })
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    const tile = view.all('.eui-world-fact.bare .v')[1]
    expect(tile.textContent).toBe('—')
    // the reason is a tooltip on the tile, never a sentence competing with the numbers
    expect(tile.getAttribute('data-tip')).toBe(
      'Of the people who first visited in this window, the share who came back within 7 days. Needs at least 30 of them before it means anything — this scene has 12.'
    )
    expect(view.text()).not.toContain('before it means anything')
    view.unmount()
  })

  it('switches every scalar to the 60-day keys without refetching', async () => {
    const both = busy({
      unique_visitors_60d: [flat(4180), flat(3900, 'mobile'), flat(120, 'desktop')],
      unique_visits_60d: [flat(9224)],
      avg_playtime_seconds_60d: [flat(234)],
      d7_retention_rate_60d: [flat(0.091)]
    })
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(both) } })
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772visitors, last 30 days · 2.2 visits each')

    view.click(view.byText('60 days', 'button'))
    expect(view.find('.eui-world-answer')?.textContent).toBe('4,180visitors, last 60 days · 2.2 visits each')
    expect(view.all('.eui-world-fact.bare .v').map((el) => el.textContent)).toEqual(['3.9 min', '9.1%', '120', '3,900'])
    // and the chart grows with it, instead of staying a 30-day chart under a 60-day number
    expect(view.all('.eui-world-chartx span')).toHaveLength(9)
    // the snapshot already carries every window, so the switch is a re-projection
    expect(metrics).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('drops the visits-each clause when the scene has no visits row', async () => {
    metrics.mockResolvedValue({
      exportedAt: EXPORTED,
      byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy({ unique_visits_30d: [] })) }
    })
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0)] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772visitors, last 30 days')
    view.unmount()
  })
})

describe('AnalyticsTab scene sections', () => {
  // Deliberately in neither visitor nor coordinate order: the server hands the
  // scenes over in created_at ASC, and nothing downstream may inherit that.
  const arena = scene(0, 0, { title: 'Arena', timestamp: Date.UTC(2026, 6, 1) })
  const lobby = scene(1, 1, { title: 'Lobby', timestamp: Date.UTC(2026, 7, 11) })
  const garden = scene(2, 2, { title: 'Garden', timestamp: Date.UTC(2026, 7, 9) })
  const three = world({ scenes: [lobby, garden, arena], sceneCount: { known: true, total: 3 } })

  const snapshot = {
    exportedAt: EXPORTED,
    byScene: {
      'world:cozyfarm.dcl.eth@0,0': loc(busy()),
      'world:cozyfarm.dcl.eth@1,1': loc({ unique_visitors_30d: [flat(412)], unique_visitors_60d: [flat(9000)] }),
      'world:cozyfarm.dcl.eth@2,2': loc({})
    }
  }

  it('offers no section, no map and no per-scene sentence for a one-scene world', async () => {
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy()) } })
    const view = mount(<AnalyticsTab w={world({ scenes: [scene(0, 0, { title: 'Arena' })] })} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.all('.eui-shelf')).toHaveLength(0)
    expect(view.find('.eui-ds-map')).toBeNull()
    expect(view.text()).not.toContain('Each one is counted on its own')
    expect(view.byText('Visitors', 'h2')).not.toBeNull()
    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772visitors, last 30 days · 2.2 visits each')
    view.unmount()
  })

  it('ranks the sections by visitors and puts the count in the heading', async () => {
    metrics.mockResolvedValue(snapshot)
    const view = mount(<AnalyticsTab w={three} picked={[]} onPick={() => undefined} />)
    await view.settle()
    expect(view.all('.eui-ds-pick .nm').map((el) => el.textContent)).toEqual([
      'Arena (0,0)',
      'Lobby (1,1)',
      'Garden (2,2)'
    ])
    // a scene the export doesn't carry says so on its card, and sorts last
    expect(view.all('.eui-ds-pick .num').map((el) => el.textContent)).toEqual([
      '2,772 visitors',
      '412 visitors',
      '— no data yet'
    ])
    expect(view.text()).toContain(
      "This world hosts 3 scenes. Each one is counted on its own — the same visitor can show up in more than one, so they don't add up to a world total."
    )
    expect(view.text()).toContain('as of 12 Aug 2026 · updated daily')
    view.unmount()
  })

  it('carries every scene’s number on its card, and reads the picked one, on one request', async () => {
    metrics.mockResolvedValue(snapshot)
    const view = mount(<AnalyticsTab w={three} picked={[]} onPick={() => undefined} />)
    await view.settle()
    // the cards hold the comparison; the panel below reads the one that is picked
    expect(view.all('.eui-ds-pick .num').map((el) => el.textContent)).toEqual([
      '2,772 visitors',
      '412 visitors',
      '— no data yet'
    ])
    expect(view.all('.eui-world-answer').map((el) => el.textContent)).toEqual([
      '2,772visitors, last 30 days · 2.2 visits each'
    ])
    expect(metrics).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('reads a scene the export never carried, without inventing a number for it', async () => {
    metrics.mockResolvedValue(snapshot)
    const key = `world:${three.name}@2,2`
    const view = mount(<AnalyticsTab w={three} picked={[key]} onPick={() => undefined} />)
    await view.settle()
    expect(view.text()).toContain('No numbers for this scene in the latest daily update.')
    view.unmount()
  })

  it('keeps the ranking on screen while a different scene is being read', async () => {
    metrics.mockResolvedValue(snapshot)
    const key = `world:${three.name}@1,1`
    const view = mount(<AnalyticsTab w={three} picked={[key]} onPick={() => undefined} />)
    await view.settle()
    // reading the runner-up does not disturb the order the cards report
    expect(view.all('.eui-world-answer').map((el) => el.textContent)).toEqual(['412visitors, last 30 days'])
    expect(view.all('.eui-ds-pick .nm').map((el) => el.textContent)[0]).toBe('Arena (0,0)')
    view.unmount()
  })

  it('re-ranks with the window, because the heading count is the window count', async () => {
    metrics.mockResolvedValue(snapshot)
    const view = mount(<AnalyticsTab w={three} picked={[]} onPick={() => undefined} />)
    await view.settle()

    view.click(view.byText('60 days', 'button'))
    // Lobby is the only scene the export carries 60-day figures for
    expect(view.all('.eui-ds-pick .nm').map((el) => el.textContent)).toEqual([
      'Lobby (1,1)',
      'Arena (0,0)',
      'Garden (2,2)'
    ])
    expect(view.all('.eui-ds-pick .num').map((el) => el.textContent)).toEqual([
      '9,000 visitors',
      '— no data yet',
      '— no data yet'
    ])
    // one control for the whole tab, and the switch is a re-projection
    expect(view.all('.eui-seg')).toHaveLength(1)
    expect(metrics).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
