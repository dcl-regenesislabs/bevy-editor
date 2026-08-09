import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { PlayGame } from './PlayGame'
import { GAME_LIFE_MARKER, GAME_LOG_TAIL, GAME_POLL_MS, GAME_SILENT_MS } from './game-life'
import { consumerStore } from '../../prefabs/consumers'
import { mount, run } from '../../test/render'

const { sceneLogs } = vi.hoisted(() => ({ sceneLogs: vi.fn(async () => '') }))
const { readServerPresence } = vi.hoisted(() => ({ readServerPresence: vi.fn(async () => 'unknown') }))

vi.mock('../../engine/cmd', () => ({ cmd: { sceneLogs } }))
vi.mock('./server-presence', () => ({ readServerPresence }))

// Mutate the property, never the window itself — this suite renders into the DOM.
const shellHost = window as unknown as {
  editorShell?: { getState: () => Promise<{ logs: string[] }> }
}

// The Multiplayer Server's own cards never reach this client's console; they
// arrive on the relayed build stream, which is where a server card must be put
// for a test to mean anything.
function serverRelays(...lines: string[]): void {
  shellHost.editorShell = { getState: async () => ({ logs: lines }) }
}

const GAME_SCRIPT = "import { game } from './runtime/game'\ngame.onStart(() => {})"

// One entity per script, carrying it the way a placed script is carried.
function placed(paths: string[]): Record<string, Record<string, unknown>> {
  const snapshot: Record<string, Record<string, unknown>> = {}
  paths.forEach((path, i) => {
    snapshot[String(512 + i)] = { 'asset-packs::Script': { value: [{ path, priority: 0, layout: '' }] } }
  })
  return snapshot
}

function scene(scripts: Record<string, string>, attached = Object.keys(scripts)): void {
  run(() => {
    consumerStore.loaded = true
    consumerStore.scripts = scripts
    state.snapshot = placed(attached)
  })
}

afterEach(() => {
  sceneLogs.mockReset()
  readServerPresence.mockReset()
  readServerPresence.mockResolvedValue('unknown')
  delete shellHost.editorShell
  vi.useRealTimers()
  run(() => {
    consumerStore.scripts = {}
    consumerStore.loaded = false
    state.snapshot = {}
  })
})

describe('the Game strip', () => {
  it('says the game is running', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} running`)
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.text()).toBe('● Game running')
    hud.unmount()
  })

  it('is waking from the moment Play starts, before the game reports anything', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.text()).toContain('Waking…')
    hud.unmount()
  })

  it('gives up on a game that never reports, and offers the logs', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    const onLogs = vi.fn()
    const hud = mount(<PlayGame onLogs={onLogs} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_SILENT_MS + 1000)
    })
    expect(hud.text()).toContain('Can’t reach the Multiplayer Server')
    hud.click(hud.find('.eui-play-game-logs'))
    expect(onLogs).toHaveBeenCalledOnce()
    hud.unmount()
  })

  it('names the missing server, and the item that adds one, in a scene that has no server', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    readServerPresence.mockResolvedValue('absent')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.text()).toBe('○ This scene has no Multiplayer Server — place a Game Flow item to add one.')
    expect(hud.find('.eui-play-game-logs')).toBeNull()
    hud.unmount()
  })

  it('still calls a server that should be answering unreachable', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    readServerPresence.mockResolvedValue('present')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_SILENT_MS + 1000)
    })
    expect(hud.text()).toContain('Can’t reach the Multiplayer Server')
    hud.unmount()
  })

  it('believes the scene over the probe once the game reports', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} running`)
    readServerPresence.mockResolvedValue('absent')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.text()).toBe('● Game running')
    hud.unmount()
  })

  it('counts the problems the runtime printed, and offers the logs that explain them', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(
      [`[1.0] Log: ${GAME_LIFE_MARKER} running`, '[1.1] Error: [you] state.score: dropped'].join('\n')
    )
    const onLogs = vi.fn()
    const hud = mount(<PlayGame onLogs={onLogs} />)
    await hud.settle()
    expect(hud.text()).toBe('● Game running · 1 problemLogs')
    hud.click(hud.find('.eui-play-game-logs'))
    expect(onLogs).toHaveBeenCalledOnce()
    hud.unmount()
  })

  it('counts a card the Multiplayer Server printed, which never reaches this console', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} running`)
    serverRelays('Error: [server] round: newRound before onRoundStart')
    const hud = mount(<PlayGame onLogs={vi.fn()} />)
    await hud.settle()
    expect(hud.text()).toBe('● Game running · 1 problemLogs')
    hud.unmount()
  })

  it('keeps counting a problem that has scrolled out of the tail', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(
      [`[1.0] Log: ${GAME_LIFE_MARKER} running`, '[1.1] Error: [you] state.score: dropped'].join('\n')
    )
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_POLL_MS)
    })
    expect(hud.text()).toContain('1 problem')
    sceneLogs.mockResolvedValue('[9.0] Log: chatter that pushed the line out')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_POLL_MS)
    })
    expect(hud.text()).toContain('1 problem')
    sceneLogs.mockResolvedValue('[9.5] Error: [server] round: newRound before onRoundStart')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_POLL_MS)
    })
    expect(hud.text()).toContain('2 problems')
    hud.unmount()
  })

  it('reads a tail deep enough that a transition cannot scroll past between polls', async () => {
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(sceneLogs).toHaveBeenCalledWith(GAME_LOG_TAIL)
    hud.unmount()
  })

  it('keeps the last state it saw when the line has scrolled out of the tail', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} running`)
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_POLL_MS)
    })
    expect(hud.text()).toBe('● Game running')
    sceneLogs.mockResolvedValue('[9.0] Log: chatter that pushed the line out')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAME_SILENT_MS + GAME_POLL_MS)
    })
    expect(hud.text()).toBe('● Game running')
    hud.unmount()
  })

  it('draws nothing in a scene that has no game in it', async () => {
    scene({ 'src/door.ts': "import { engine } from '@dcl/sdk/ecs'" })
    sceneLogs.mockResolvedValue('[1.0] Log: hello')
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.find('.eui-play-game')).toBeNull()
    hud.unmount()
  })

  it('draws nothing when the game script is in the project but on no entity', async () => {
    scene({ 'src/door.ts': "import { engine } from '@dcl/sdk/ecs'", 'src/race.ts': GAME_SCRIPT }, ['src/door.ts'])
    sceneLogs.mockResolvedValue(`[1.0] Log: ${GAME_LIFE_MARKER} running`)
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await hud.settle()
    expect(hud.find('.eui-play-game')).toBeNull()
    hud.unmount()
  })
})
