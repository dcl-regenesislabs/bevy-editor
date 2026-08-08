import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { state, componentKey, type Snapshot } from '@scene/state'
import { SCRIPT_COMPONENT, TRIGGER_AREA } from '@scene/allowed-components'
import { InspectorPanel } from './InspectorPanel'
import { mount, run } from '../test/render'

function panel() {
  return mount(<InspectorPanel min={false} onToggleMin={() => {}} />)
}

function select(id: string, comps: Record<string, unknown>): void {
  run(() => {
    state.snapshot = { [id]: comps } as Snapshot
    state.activeEntity = id
    state.expandedComponents = new Set([componentKey(id, SCRIPT_COMPONENT)])
  })
}

beforeEach(() => {
  run(() => {
    state.savedBaseline = null
    state.initialBaseline = null
    state.expandedComponents = new Set<string>()
  })
})

afterEach(() => {
  run(() => {
    state.snapshot = {} as Snapshot
    state.activeEntity = null
    state.expandedComponents = new Set<string>()
  })
})

// BL5: a scriptless entity used to answer "what does this do?" with "No
// components on this entity", and the only way to a script was the icon-only
// component picker.
describe('the inspector on an entity with no Script component', () => {
  it('stands a Script card on it anyway, with its empty state', () => {
    select('512', { Transform: {}, GltfContainer: { src: 'tower.glb' } })
    const view = panel()
    expect(view.all('.eui-comp-head .name').map((el) => el.textContent)).toContain('script')
    expect(view.text()).toContain('This entity does nothing yet — give it a script.')
    expect(view.text()).toContain('New script')
    expect(view.text()).not.toContain('No components on this entity')
    view.unmount()
  })

  it('offers no remove button for a component that is not there yet', () => {
    select('512', { Transform: {} })
    const view = panel()
    const head = view.all('.eui-comp-head').find((el) => el.textContent?.includes('script') === true)
    expect(head).not.toBeUndefined()
    expect(head?.querySelector('[data-tip="Remove component"]')).toBeNull()
    view.unmount()
  })

  it('leaves the engine entities as they were', () => {
    select('1', {})
    const view = panel()
    expect(view.text()).toContain('No components on this entity')
    view.unmount()
  })
})

// Official component names — "Trigger zone" and "Behavior" were both invented.
describe('the card titles on a Trigger Area', () => {
  it('names the area and the script by their component names', () => {
    select('512', { Transform: {}, [TRIGGER_AREA]: {}, [SCRIPT_COMPONENT]: { value: [] } })
    const view = panel()
    const titles = view.all('.eui-comp-head .name').map((el) => el.textContent)
    expect(titles).toContain('Trigger Area')
    expect(titles).toContain('Script')
    expect(titles).not.toContain('Trigger zone')
    expect(titles).not.toContain('Behavior')
    view.unmount()
  })
})
