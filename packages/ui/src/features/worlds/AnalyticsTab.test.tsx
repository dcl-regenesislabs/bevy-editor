import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AnalyticsModule from './analytics'
import type { WorldDeployment, WorldEntry, WorldScene } from './inventory'
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
  title: null,
  timestamp: null,
  thumbnail: null,
  entityId: null,
  ...over
})

const deployment: WorldDeployment = {
  title: 'Cozy Farm',
  deployer: null,
  timestamp: 1,
  entityId: null,
  thumbnail: null,
  parcels: 1,
  size: null,
  base: '0,0',
  authoritativeMultiplayer: false
}

const world = (over: Partial<WorldEntry> = {}): WorldEntry => ({
  name: 'cozyfarm.dcl.eth',
  role: 'owner',
  size: null,
  deployment: null,
  scenes: [],
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
  it('offers nothing but the publish sentence when the world has no deployment', () => {
    const view = mount(<AnalyticsTab w={world()} />)
    expect(view.text()).toBe('Analytics is scoped to the live scene — publish something to this world first.')
    expect(metrics).not.toHaveBeenCalled()
    view.unmount()
  })

  it('explains an unreadable location instead of asking for a publish', () => {
    const view = mount(<AnalyticsTab w={world({ deployment })} />)
    expect(view.text()).toContain(
      "This world's published scene doesn't record where it sits, so there are no numbers to show."
    )
    expect(view.text()).toContain('Publish it again from Decentraland Studio and it will.')
    expect(view.text()).not.toContain('publish something to this world first')
    expect(metrics).not.toHaveBeenCalled()
    view.unmount()
  })
})

describe('AnalyticsTab load states', () => {
  it('shows the freshness line and a spinner before the snapshot lands', () => {
    metrics.mockReturnValue(new Promise(() => {}))
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0)] })} />)
    expect(view.text()).toContain('Counted for the scene published here, once a day.')
    expect(view.text()).toContain('Loading…')
    expect(view.text()).not.toContain('No numbers for this scene')
    view.unmount()
  })

  it('keeps a failed request structurally distinct from an empty one', async () => {
    metrics.mockRejectedValue(new Error("Your sign-in wasn't recognised — sign out and back in."))
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0)] })} />)
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
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0)] })} />)
    await view.settle()
    expect(view.byText('Visitors', 'h2')).not.toBeNull()
    expect(view.text()).toContain(
      'Counted for the scene published here, once a day — these numbers cover everything up to 12 Aug 2026.'
    )
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
    const w = world({ deployment, scenes: [scene(0, 0, { timestamp: Date.UTC(2026, 7, 5) })] })
    const view = mount(<AnalyticsTab w={w} />)
    await view.settle()

    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772 visitors in the last 30 days · 2.2 visits each')
    expect(view.text()).toContain('Growing — 523 visitors a week over the last four weeks, up from 243 in the four before.')
    expect(view.all('.eui-world-fact.bare .v').map((el) => el.textContent)).toEqual(['4.0 min', '8.4%', '2,583'])
    expect(view.text()).toContain('50 on desktop')

    const plot = view.find('.eui-world-chart')
    expect(plot?.getAttribute('role')).toBe('img')
    expect(plot?.getAttribute('aria-label')).toBe(
      'Visitors per week, 15 Jun to 3 Aug — the busiest week was 620. The dashed line is when you last published this scene.'
    )
    expect(view.all('.eui-world-chart .n').map((el) => el.textContent)).toEqual([
      '180',
      '240',
      '240',
      '310',
      '520',
      '620',
      '540',
      '412'
    ])
    expect(view.all('.eui-world-chart i')).toHaveLength(8)
    expect(view.all('.eui-world-chart .rule')).toHaveLength(1)
    expect(view.all('.eui-world-chartx span').map((el) => el.textContent)).toEqual([
      '15 Jun',
      '22 Jun',
      '29 Jun',
      '6 Jul',
      '13 Jul',
      '20 Jul',
      '27 Jul',
      '3 Aug'
    ])
    view.unmount()
  })

  it('labels a week with no row and draws no bar for it', async () => {
    const holed = WEEKS.filter(([period]) => period !== '2026-06-22')
    metrics.mockResolvedValue({
      exportedAt: EXPORTED,
      byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy({ unique_visitors_weekly: weekly(holed) })) }
    })
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0)] })} />)
    await view.settle()
    expect(view.all('.eui-world-chart .n').map((el) => el.textContent)[1]).toBe('—')
    expect(view.all('.eui-world-chart i')).toHaveLength(7)
    expect(view.text()).toContain('Not enough complete weeks yet to say which way this is going.')
    view.unmount()
  })

  it('withholds the return rate under the floor and says why', async () => {
    const small = busy({ unique_visitors_30d: [flat(12), flat(9, 'mobile'), flat(3, 'desktop')] })
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(small) } })
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0)] })} />)
    await view.settle()
    expect(view.all('.eui-world-fact.bare .v').map((el) => el.textContent)[1]).toBe('—')
    expect(view.text()).toContain(
      'Came back within a week needs at least 30 visitors before it means anything — this scene has 12.'
    )
    view.unmount()
  })

  it('drops the visits-each clause when the scene has no visits row', async () => {
    metrics.mockResolvedValue({
      exportedAt: EXPORTED,
      byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy({ unique_visits_30d: [] })) }
    })
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0)] })} />)
    await view.settle()
    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772 visitors in the last 30 days')
    view.unmount()
  })
})

describe('AnalyticsTab scene list', () => {
  const arena = scene(0, 0, { title: 'Arena', timestamp: Date.UTC(2026, 6, 1) })
  const lobby = scene(1, 1, { title: 'Lobby', timestamp: Date.UTC(2026, 7, 11) })
  const garden = scene(2, 2, { title: 'Garden', timestamp: Date.UTC(2026, 7, 9) })
  const three = world({ deployment, scenes: [arena, lobby, garden] })

  const snapshot = {
    exportedAt: EXPORTED,
    byScene: {
      'world:cozyfarm.dcl.eth@0,0': loc(busy()),
      'world:cozyfarm.dcl.eth@1,1': loc({ unique_visitors_30d: [flat(412)] }),
      'world:cozyfarm.dcl.eth@2,2': loc({})
    }
  }

  it('offers no list, no control and no label for a one-scene world', async () => {
    metrics.mockResolvedValue({ exportedAt: EXPORTED, byScene: { 'world:cozyfarm.dcl.eth@0,0': loc(busy()) } })
    const view = mount(<AnalyticsTab w={world({ deployment, scenes: [scene(0, 0, { title: 'Arena' })] })} />)
    await view.settle()
    expect(view.all('.eui-world-scene.pick')).toHaveLength(0)
    expect(view.text()).not.toContain('Scenes published here')
    expect(view.byText('Visitors', 'h2')).not.toBeNull()
    view.unmount()
  })

  it('sorts by visitors but selects the most recently published scene', async () => {
    metrics.mockResolvedValue(snapshot)
    const view = mount(<AnalyticsTab w={three} />)
    await view.settle()
    const rows = view.all('.eui-world-scene.pick')
    expect(rows.map((el) => el.querySelector('.nm')?.textContent)).toEqual(['Arena', 'Lobby', 'Garden'])
    expect(rows.map((el) => el.querySelector('.eui-world-num')?.textContent)).toEqual([
      '2,772 visitors',
      '412 visitors',
      '— no data yet'
    ])
    expect(rows.findIndex((el) => el.getAttribute('aria-pressed') === 'true')).toBe(1)
    expect(view.byText('Visitors — Lobby', 'h2')).not.toBeNull()
    expect(view.text()).toContain(
      'This world hosts 3 scenes. Each one is counted on its own — the same visitor can show up in more than one, so they don\'t add up to a world total.'
    )
    expect(view.text()).toContain('Counted for Lobby, once a day — these numbers cover everything up to 12 Aug 2026.')
    view.unmount()
  })

  it('re-projects the snapshot on a row click without a second request', async () => {
    metrics.mockResolvedValue(snapshot)
    const view = mount(<AnalyticsTab w={three} />)
    await view.settle()
    view.click(view.all('.eui-world-scene.pick')[0])
    expect(view.byText('Visitors — Arena', 'h2')).not.toBeNull()
    expect(view.find('.eui-world-answer')?.textContent).toBe('2,772 visitors in the last 30 days · 2.2 visits each')
    expect(metrics).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('never hides a no-data row', async () => {
    metrics.mockResolvedValue(snapshot)
    const view = mount(<AnalyticsTab w={three} />)
    await view.settle()
    view.click(view.all('.eui-world-scene.pick')[2])
    expect(view.all('.eui-world-scene.pick')).toHaveLength(3)
    expect(view.byText('Visitors — Garden', 'h2')).not.toBeNull()
    expect(view.text()).toContain('No numbers for this scene in the latest daily update.')
    view.unmount()
  })
})
