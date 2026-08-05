import { afterEach, describe, expect, it } from 'vitest'
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
