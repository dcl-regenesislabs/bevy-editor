import { describe, expect, it, vi } from 'vitest'
import { LogsDrawer } from './LogsDrawer'
import { GAME_LIFE_MARKER } from '../play/game-life'
import { mount } from '../../test/render'

const LOGS = ['[1.0] Log: [game] openChest: already open', '[1.1] Log: [you] popup shown', `[1.2] Log: ${GAME_LIFE_MARKER} running`].join('\n')

vi.mock('../../engine/cmd', () => ({ cmd: { sceneLogs: vi.fn(async () => LOGS) } }))

describe('the Game tab', () => {
  it('shows which copy of the scene printed each line, and hides the strip’s machinery', async () => {
    const drawer = mount(<LogsDrawer open onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.byText('Game', '.eui-logs-tabs button')).not.toBeNull()
    expect(drawer.all('.eui-logs-role').map((el) => el.textContent)).toEqual(['[game]', '[you]'])
    expect(drawer.find('.eui-logs-role.game')).not.toBeNull()
    expect(drawer.find('.eui-logs-role.you')).not.toBeNull()
    expect(drawer.text()).not.toContain(GAME_LIFE_MARKER)
    // the tag is rendered once — the row keeps the rest of the line
    expect(drawer.text()).toContain('openChest: already open')
    drawer.unmount()
  })
})
