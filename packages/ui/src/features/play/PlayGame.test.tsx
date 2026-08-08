import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayGame } from './PlayGame'
import { GAME_LIFE_MARKER } from './game-life'
import { mount } from '../../test/render'

const { sceneLogs } = vi.hoisted(() => ({ sceneLogs: vi.fn(async () => '') }))

vi.mock('../../engine/cmd', () => ({ cmd: { sceneLogs } }))

afterEach(() => sceneLogs.mockReset())

describe('the Game strip', () => {
  it('says the game is running', async () => {
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} running`)
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.text()).toBe('● Game running')
    hud.unmount()
  })

  it('offers the logs, and only there, when the server is out of reach', async () => {
    const onLogs = vi.fn()
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} unreachable`)
    const hud = mount(<PlayGame onLogs={onLogs} />)
    await hud.settle()
    expect(hud.text()).toContain('Can’t reach the Multiplayer Server')
    hud.click(hud.find('.eui-play-game-logs'))
    expect(onLogs).toHaveBeenCalledOnce()
    hud.unmount()
  })

  it('draws nothing in a scene that has no game in it', async () => {
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.find('.eui-play-game')).toBeNull()
    hud.unmount()
  })
})
