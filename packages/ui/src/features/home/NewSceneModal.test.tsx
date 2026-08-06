import { describe, expect, it } from 'vitest'
import type { EditorShell, HostState, SceneTemplate } from '@dcl-editor/contract'
import { NewSceneModal } from './NewSceneModal'
import { mount } from '../../test/render'

const STARTERS: SceneTemplate[] = [
  { id: 'blank', name: 'Blank', description: 'An empty parcel — start from scratch' },
  { id: 'starter', name: 'Example', description: 'A clickable cube with a bit of SDK7 code' }
]

function shell(list: SceneTemplate[]): EditorShell {
  return {
    pickProject: async () => {},
    openProject: async () => {},
    getState: () => new Promise<HostState>(() => {}),
    onStackLog: () => {},
    sceneTemplates: async () => list
  }
}

const modal = (list: SceneTemplate[] = STARTERS): ReturnType<typeof mount> =>
  mount(<NewSceneModal shell={shell(list)} onClose={() => {}} onCreated={() => {}} onOpenExisting={() => {}} />)

describe('NewSceneModal copy', () => {
  it('never says “template” to the creator, at either step', async () => {
    const view = modal()
    await view.settle()
    expect(view.text()).not.toMatch(/template/i)
    expect(view.text()).toMatch(/starter/i)
    view.click(view.all('.eui-choice-card')[0])
    await view.settle()
    expect(view.text()).not.toMatch(/template/i)
    expect(view.byText('Starter', '.eui-home-flabel')).not.toBeNull()
    expect(view.all('.eui-tpl-card .nm').map((c) => c.textContent)).toEqual(['Blank', 'Example'])
    view.unmount()
  })

  it('says which kind of thing is missing when none are bundled', async () => {
    const view = modal([])
    view.click(view.all('.eui-choice-card')[0])
    await view.settle()
    expect(view.find('.eui-home-empty')?.textContent).toBe('No starters bundled.')
    view.unmount()
  })
})
