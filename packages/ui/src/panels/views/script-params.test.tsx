import { afterEach, describe, expect, it } from 'vitest'
import { state } from '@scene/state'
import { NAME_COMPONENT } from '@scene/custom-components'
import { ParamField } from './script-params'
import { prefabStore, type PrefabEntry } from '../prefab-store'
import { CREATE_SPAWNABLE_GESTURE, NO_SPAWNABLES_YET } from '../../prefabs/copy'
import { mount, run } from '../../test/render'

const ZOMBIE_ID = '9f1c3a5e-0000-4000-8000-000000000001'

const zombie: PrefabEntry = {
  folder: 'custom/zombie_basic',
  data: { id: ZOMBIE_ID, name: 'Zombie Basic', category: 'custom', tags: [], spawnable: { max: 8 } },
  hasGuide: false
}

afterEach(() => {
  run(() => {
    prefabStore.items = []
    state.snapshot = {}
  })
})

describe('prefab param pickers with nothing to pick', () => {
  it('names the gesture that fills the picker instead of a dead dropdown', () => {
    const view = mount(<ParamField name="zombie" param={{ type: 'prefab', value: '' }} onChange={() => {}} />)
    expect(view.text()).toContain(NO_SPAWNABLES_YET)
    expect(view.text()).toContain(CREATE_SPAWNABLE_GESTURE)
    expect(view.find('.eui-ds-select')).toBeNull()
    view.unmount()
  })

  it('says the same thing over a prefab-list param', () => {
    const view = mount(<ParamField name="arenas" param={{ type: 'prefabList', value: [] }} onChange={() => {}} />)
    expect(view.text()).toContain(NO_SPAWNABLES_YET)
    view.unmount()
  })

  it('offers the picker once the project has a spawnable prefab', () => {
    run(() => {
      prefabStore.items = [zombie]
    })
    const view = mount(<ParamField name="zombie" param={{ type: 'prefab', value: '' }} onChange={() => {}} />)
    expect(view.text()).not.toContain('No spawnable prefabs yet')
    view.unmount()
  })
})

describe('param labels', () => {
  it('reads as a phrase, in full, with the real name in the tooltip', () => {
    const view = mount(
      <ParamField
        name="atMostAtOnce"
        param={{ type: 'number', value: 1, description: 'How many copies can be out at once.' }}
        onChange={() => {}}
      />
    )
    const label = view.find('.plabel')
    expect(label?.textContent).toBe('At Most At Once')
    expect(label?.classList.contains('param')).toBe(true)
    expect(label?.getAttribute('data-tip')).toContain('atMostAtOnce')
    expect(label?.getAttribute('data-tip')).toContain('How many copies can be out at once.')
    view.unmount()
  })
})

describe('the entity picker', () => {
  const name = (value: string): Record<string, unknown> => ({ [NAME_COMPONENT]: { value } })

  it('lists none first, then named entities alphabetically with their id as detail', () => {
    run(() => {
      state.snapshot = { '0': {}, '512': name('Lever'), '513': {}, '514': name('Anvil') }
    })
    const view = mount(
      <ParamField
        name="clickable"
        param={{ type: 'entity', value: 0, description: 'For "when clicked": the thing a player clicks.' }}
        onChange={() => {}}
      />
    )
    view.click(view.find('.eui-ds-select-field'))
    const rows = view.all('.eui-ds-pop-row').map((row) => row.textContent)
    expect(rows).toEqual(['nonethe thing a player clicks.', 'Anvil#514', 'Lever#512'])
    view.unmount()
  })

  it('keeps an unnamed current value so nothing silently changes', () => {
    run(() => {
      state.snapshot = { '512': name('Lever'), '513': {} }
    })
    let picked: unknown = null
    const view = mount(
      <ParamField name="clickable" param={{ type: 'entity', value: 513 }} onChange={(v) => (picked = v)} />
    )
    view.click(view.find('.eui-ds-select-field'))
    const rows = view.all('.eui-ds-pop-row')
    expect(rows.map((row) => row.textContent)).toEqual(['none', '#513unnamed', 'Lever#512'])
    view.click(rows[2])
    expect(picked).toBe(512)
    view.unmount()
  })
})

describe('enum display labels', () => {
  const param = {
    type: 'enum' as const,
    value: 'when a script asks',
    options: ['when clicked', 'when a script asks']
  }

  it('shows the friendlier words while storing the exact value', () => {
    let stored: unknown = null
    const view = mount(
      <ParamField
        name="when"
        param={param}
        enumLabels={{ 'when a script asks': 'when another script triggers it' }}
        onChange={(v) => (stored = v)}
      />
    )
    expect(view.text()).toContain('when another script triggers it')
    view.click(view.find('.eui-ds-select-field'))
    view.click(view.byText('when another script triggers it', '.eui-ds-pop-row'))
    expect(stored).toBe('when a script asks')
    view.unmount()
  })

  it('defaults to the stored words untouched', () => {
    const view = mount(<ParamField name="when" param={param} onChange={() => {}} />)
    expect(view.text()).toContain('when a script asks')
    expect(view.find('.eui-param-hint')).toBeNull()
    view.unmount()
  })

  it('captions the picked choice with what it actually does', () => {
    const view = mount(
      <ParamField
        name="when"
        param={param}
        enumHints={{ 'when a script asks': 'One of your scripts calls this spawner by name.' }}
        onChange={() => {}}
      />
    )
    expect(view.find('.eui-param-hint')?.textContent).toBe('One of your scripts calls this spawner by name.')
    view.unmount()
  })
})
