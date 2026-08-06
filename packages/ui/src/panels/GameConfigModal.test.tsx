import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { GameConfigModal } from './GameConfigModal'
import { defaultGameConfig, GAME_CONFIG_COMPONENT, normalizeGameConfig } from '../gameconfig/normalize'
import { mount } from '../test/render'

const { ensure, setValue } = vi.hoisted(() => ({
  ensure: vi.fn(async (): Promise<void> => {}),
  setValue: vi.fn(async (): Promise<void> => {})
}))

vi.mock('../actions/gameconfig', () => ({ uiEnsureGameConfig: ensure }))
vi.mock('../actions/components', () => ({ uiSetComponentValue: setValue }))

beforeEach(() => {
  state.snapshot = {}
  ensure.mockClear()
  setValue.mockClear()
})

afterEach(() => {
  state.snapshot = {}
})

describe('GameConfigModal', () => {
  it('offers to create the config a scene does not have yet', () => {
    const v = mount(<GameConfigModal onClose={() => {}} />)
    expect(v.text()).toContain('Game Config')
    v.click(v.byText('Add a Game Config', 'button'))
    expect(ensure).toHaveBeenCalledTimes(1)
    v.unmount()
  })

  it('edits the config on the scene root through the ordinary component funnel', () => {
    state.snapshot = { '0': { [GAME_CONFIG_COMPONENT]: defaultGameConfig() } }
    const v = mount(<GameConfigModal onClose={() => {}} />)
    expect(v.all('.eui-ds-table')).toHaveLength(3)
    v.click(v.find('[aria-label="remove WINNER_POINTS"]'))
    expect(setValue).toHaveBeenCalledTimes(1)
    const [, entityId, name, json] = setValue.mock.calls[0] as unknown as [string, string, string, string]
    expect(entityId).toBe('0')
    expect(name).toBe(GAME_CONFIG_COMPONENT)
    expect(normalizeGameConfig(JSON.parse(json)).values).toEqual([])
    v.unmount()
  })
})
