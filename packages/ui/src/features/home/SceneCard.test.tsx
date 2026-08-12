import { describe, expect, it } from 'vitest'
import type { EditorShell, HostState, ProjectInfo } from '@dcl-editor/contract'
import { SceneCard } from './SceneCard'
import { mount } from '../../test/render'

const PROJECT: ProjectInfo = {
  path: '/tmp/my-scene',
  name: 'my-scene',
  title: 'My scene',
  parcels: 1,
  world: null,
  thumbnail: null
}

const shell: EditorShell = {
  pickProject: async () => {},
  openProject: async () => {},
  getState: () => new Promise<HostState>(() => {}),
  onStackLog: () => {}
}

const card = (p: ProjectInfo = PROJECT): ReturnType<typeof mount> =>
  mount(
    <SceneCard
      p={p}
      shell={shell}
      onOpen={() => {}}
      onChanged={() => {}}
      onRemove={() => {}}
      onPublish={() => {}}
    />
  )

describe('SceneCard menu stacking', () => {
  // The card's :hover transform makes it a stacking context, so the menu's own
  // z-index cannot lift it past the next card in the grid — the CARD has to
  // out-stack its siblings, which it does through this class.
  it('marks the card while its menu is open, so CSS can lift it over its neighbours', () => {
    const view = card()
    expect(view.find('.eui-scene-card')?.className).not.toMatch(/menu-open/)
    view.click(view.byText('⋯', '.eui-scene-iact'))
    expect(view.find('.eui-scene-menu')).not.toBeNull()
    expect(view.find('.eui-scene-card')?.className).toMatch(/menu-open/)
    view.click(view.byText('⋯', '.eui-scene-iact'))
    expect(view.find('.eui-scene-card')?.className).not.toMatch(/menu-open/)
    view.unmount()
  })
})
