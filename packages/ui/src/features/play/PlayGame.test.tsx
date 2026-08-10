import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { PlayGame } from './PlayGame'
import { GAME_LIFE_MARKER, GAME_LOG_TAIL, GAME_POLL_MS, GAME_SILENT_MS } from './game-life'
import { consumerStore } from '../../prefabs/consumers'
import { mount, run } from '../../test/render'
import { PROBLEM_MARKER } from '../editor/log-roles'
import { resetForTest } from './run-window'

const { sceneLogs } = vi.hoisted(() => ({ sceneLogs: vi.fn(async () => '') }))
const { readServerPresence } = vi.hoisted(() => ({ readServerPresence: vi.fn(async () => 'unknown') }))

vi.mock('../../engine/cmd', () => ({ cmd: { sceneLogs } }))
vi.mock('./server-presence', () => ({ readServerPresence }))

// Mutate the property, never the window itself — this suite renders into the DOM.
const shellHost = window as unknown as {
  editorShell?: {
    getState: () => Promise<{ logs: string[] }>
    onStackLog: (cb: (line: string) => void) => void
  }
}

// The shell as the strip meets it: ONE backlog for the whole project session,
// handed out whole by getState and appended to as lines arrive. Both halves
// matter — the Multiplayer Server is spawned at project open, so its cards can
// be in the backlog before the strip ever registers a listener.
let backlog: string[] = []
let pushLine: ((line: string) => void) | null = null
const shellStub = {
  getState: async () => ({ logs: [...backlog] }),
  onStackLog: (cb: (line: string) => void) => {
    pushLine = cb
  }
}

// The Multiplayer Server's own cards never reach this client's console; they
// arrive on the relayed build stream, which is where a server card must be put
// for a test to mean anything.
/** Printed while the project was opening — in the backlog before any Play. */
function serverPrintedAtOpen(...lines: string[]): void {
  backlog.push(...lines)
}

/** Printed while a run is on screen: pushed live, and kept in the backlog. */
function serverRelays(...lines: string[]): void {
  for (const line of lines) {
    backlog.push(line)
    pushLine?.(line)
  }
}

// One poll of both log sources.
async function nextPoll(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(GAME_POLL_MS)
  })
}

// Verbatim what the runtime prints on the server: its own problem mark, with no
// engine stamp or verb in front of it — that console is not the engine's.
const SERVER_CARD = `${PROBLEM_MARKER} [server] round: 'round' from 0x1 dropped — too many per second.`
const SERVER_BOOT_CARD = `${PROBLEM_MARKER} [server] state: saved data could not be read — starting fresh.`

const GAME_SCRIPT = "import { game } from './runtime/game'\ngame.onReady(() => {})"

const RUNNING = `[1.0] Log: ${GAME_LIFE_MARKER} running`
const CLIENT_CARD = '[1.1] Error: [you] state.score: dropped'
// What a script's start() prints on a scene Play has just reloaded: the fresh
// instance's clock starts at 0, so this lands before the strip's first poll.
const START_CARD = '[0.2] Error: [you] game.openPool in start(): only the server opens the pool.'

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

beforeEach(() => {
  backlog = []
  pushLine = null
  resetForTest()
  shellHost.editorShell = shellStub
})

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
    sceneLogs.mockResolvedValue([RUNNING, CLIENT_CARD].join('\n'))
    const onLogs = vi.fn()
    const hud = mount(<PlayGame onLogs={onLogs} />)
    await hud.settle()
    expect(hud.text()).toBe('● Game running · 1 problemLogs')
    hud.click(hud.find('.eui-play-game-logs'))
    expect(onLogs).toHaveBeenCalledOnce()
    hud.unmount()
  })

  it('counts a card the Multiplayer Server printed, which never reaches this console', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(RUNNING)
    // The server is spawned with the dev server at project open, so its boot
    // cards are in the shell's backlog long before the first Play.
    serverPrintedAtOpen(SERVER_BOOT_CARD)
    const hud = mount(<PlayGame onLogs={vi.fn()} />)
    await nextPoll()
    expect(hud.text()).toBe('● Game running · 1 problemLogs')
    hud.unmount()
  })

  it('counts a card this run printed before its first poll, on the scene Play reloaded', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(`[30.0] Log: ${GAME_LIFE_MARKER} running`)
    const first = mount(<PlayGame onLogs={() => {}} />)
    await nextPoll()
    expect(first.text()).toBe('● Game running')
    first.unmount()
    // Play rebuilt and reloaded: a fresh instance, a fresh log, the clock back at
    // 0 — so start()'s card is already in the tail the run's first poll reads.
    sceneLogs.mockResolvedValue([START_CARD, RUNNING].join('\n'))
    const second = mount(<PlayGame onLogs={() => {}} />)
    await nextPoll()
    expect(second.text()).toBe('● Game running · 1 problemLogs')
    second.unmount()
  })

  it('counts the problems of this run, never the last run’s', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue(RUNNING)
    const first = mount(<PlayGame onLogs={() => {}} />)
    await nextPoll()
    serverRelays(SERVER_CARD)
    sceneLogs.mockResolvedValue([RUNNING, CLIENT_CARD].join('\n'))
    await nextPoll()
    expect(first.text()).toBe('● Game running · 2 problemsLogs')
    first.unmount() // Stop — the shell's backlog and the console tail both stay
    const second = mount(<PlayGame onLogs={() => {}} />)
    await nextPoll()
    expect(second.text()).toBe('● Game running')
    sceneLogs.mockResolvedValue([RUNNING, CLIENT_CARD, '[5.0] Error: [you] state.score: dropped'].join('\n'))
    await nextPoll()
    expect(second.text()).toBe('● Game running · 1 problemLogs')
    second.unmount()
  })

  it('keeps counting a problem that has scrolled out of the tail', async () => {
    vi.useFakeTimers()
    scene({ 'src/race.ts': GAME_SCRIPT })
    sceneLogs.mockResolvedValue([RUNNING, CLIENT_CARD].join('\n'))
    const hud = mount(<PlayGame onLogs={() => {}} />)
    await nextPoll()
    expect(hud.text()).toContain('1 problem')
    sceneLogs.mockResolvedValue('[9.0] Log: chatter that pushed the line out')
    await nextPoll()
    expect(hud.text()).toContain('1 problem')
    sceneLogs.mockResolvedValue('[9.5] Error: [you] game.newRound in start(): only the server ends a round.')
    await nextPoll()
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
