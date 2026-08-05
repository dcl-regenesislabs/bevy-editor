import { afterEach, describe, expect, it } from 'vitest'
import { SceneChecksCard } from './SceneChecksCard'
import { resetSceneChecksForTest, revealSceneChecks, setSceneFindings, type SceneFinding } from './scene-checks'
import { clearPrefabReveal, prefabStore } from '../../panels/prefab-store'
import { mount, run } from '../../test/render'

const blocker: SceneFinding = {
  id: 'wave-count-vs-pool-max',
  level: 'blocker',
  title: 'A wave spawns more copies than the prefab allows',
  detail: 'Wave 7 spawns 24 zombies, and Zombie allows 16 alive at once.',
  folder: 'custom/zombie',
  fix: { label: 'Show prefab', action: 'reveal-prefab' }
}

const warning: SceneFinding = {
  id: 'spawnable-trigger-area',
  level: 'warning',
  title: 'Clones of Zombie share one TriggerArea',
  detail: 'Only one copy can own a trigger area.',
  folder: 'custom/zombie'
}

const drift: SceneFinding = {
  id: 'stale-anchor',
  level: 'play-blocker',
  title: 'Player Rig’s placed copy has unsaved changes',
  detail: 'The copies your game makes always come from the prefab, so this edit never reaches them.',
  entityId: '512',
  folder: 'custom/player-rig',
  fix: { label: 'Compare…', action: 'open-drift' }
}

const spawning: SceneFinding = {
  id: 'unspawnable-prefab-ref',
  level: 'blocker',
  title: 'Zombie is not Spawnable',
  detail: 'Open Placement & spawning on Zombie and turn Spawnable on, or pick another prefab in the inspector.',
  entityId: '512',
  folder: 'custom/zombie',
  fix: { label: 'Select entity', action: 'select-entity' }
}

afterEach(() => {
  resetSceneChecksForTest()
  run(() => {
    clearPrefabReveal()
  })
})

describe('SceneChecksCard render', () => {
  it('renders nothing when the project is clean', () => {
    const view = mount(<SceneChecksCard />)
    expect(view.container.innerHTML).toBe('')
    view.unmount()
  })

  it('leads with the blocking count and marks the card blocking', () => {
    setSceneFindings([blocker, warning])
    const view = mount(<SceneChecksCard />)
    expect(view.find('.eui-checks')?.className).toContain('blocking')
    expect(view.text()).toContain('1 problem blocking Play · 1 warning')
    expect(view.byText('Play anyway', 'button')).not.toBeNull()
    view.unmount()
  })

  it('offers no Play-anyway escape when nothing blocks', () => {
    setSceneFindings([warning])
    const view = mount(<SceneChecksCard />)
    expect(view.find('.eui-checks')?.className).not.toContain('blocking')
    expect(view.text()).toContain('1 thing to look at')
    expect(view.byText('Play anyway', 'button')).toBeNull()
    view.unmount()
  })

  it('starts collapsed and lists every finding once opened', () => {
    setSceneFindings([blocker, drift, warning])
    const view = mount(<SceneChecksCard />)
    expect(view.find('.eui-checks-list')).toBeNull()
    expect(view.find('.eui-checks-head .bar')?.getAttribute('aria-expanded')).toBe('false')
    view.click(view.find('.eui-checks-head .bar'))
    expect(view.all('.eui-checks-list li')).toHaveLength(3)
    expect(view.find('.eui-checks-head .bar')?.getAttribute('aria-expanded')).toBe('true')
    view.unmount()
  })

  it('does not fold two findings of one rule into a single dismissal', () => {
    const first = { ...warning, entityId: '7' }
    const second = { ...warning, entityId: '8' }
    setSceneFindings([first, second])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-stall-x'))
    expect(view.container.innerHTML).toBe('')
    run(() => setSceneFindings([second]))
    expect(view.find('.eui-checks')).not.toBeNull()
    view.unmount()
  })

  it('labels play-blockers as blocking and warnings as warnings', () => {
    setSceneFindings([drift, warning])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-checks-head .bar'))
    const chips = view.all('.eui-checks-list li .eui-ds-chip').map((c) => c.textContent)
    expect(chips).toEqual(['Blocks Play', 'Warning'])
    const tones = view.all('.eui-checks-list li .eui-ds-chip').map((c) => c.className)
    expect(tones[0]).toContain('danger')
    expect(tones[1]).not.toContain('danger')
    view.unmount()
  })

  it('renders a fix link only for findings that carry one', () => {
    setSceneFindings([blocker, warning])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-checks-head .bar'))
    expect(view.all('.eui-checks-list li .act')).toHaveLength(1)
    expect(view.byText('Show prefab', 'button')).not.toBeNull()
    view.unmount()
  })


  it('dismisses until the findings change, and comes back when they do', () => {
    setSceneFindings([warning])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-stall-x'))
    expect(view.container.innerHTML).toBe('')
    run(() => setSceneFindings([blocker, warning]))
    expect(view.find('.eui-checks')).not.toBeNull()
    view.unmount()
  })

  it('re-opens on a refused Play even after it was dismissed', () => {
    setSceneFindings([blocker])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-stall-x'))
    expect(view.container.innerHTML).toBe('')
    run(revealSceneChecks)
    expect(view.find('.eui-checks-list')).not.toBeNull()
    view.unmount()
  })

  it('comes back when only the numbers in a dismissed finding changed', () => {
    setSceneFindings([warning])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-stall-x'))
    expect(view.container.innerHTML).toBe('')
    run(() => setSceneFindings([{ ...warning, detail: 'Only one copy can own a trigger area — pool max is now 70.' }]))
    expect(view.find('.eui-checks')).not.toBeNull()
    view.unmount()
  })

  it('keeps two findings of the same id and folder apart', () => {
    setSceneFindings([warning, { ...warning, entityId: '7' }])
    const view = mount(<SceneChecksCard />)
    view.click(view.find('.eui-checks-head .bar'))
    expect(view.all('.eui-checks-list li')).toHaveLength(2)
    view.unmount()
  })
})
