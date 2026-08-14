import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EditorShell, HostState } from '@dcl-editor/contract'
import { LogsDrawer } from './LogsDrawer'
import { BUILD_TAB_EMPTY, GAME_TAB_EMPTY, GAME_TAB_TIP } from './log-roles'
import { GAME_LIFE_MARKER } from '../play/game-life'
import { mount, run } from '../../test/render'

const LOGS = ['[1.0] Log: [server] openChest: already open', '[1.1] Log: [you] popup shown', `[1.2] Log: ${GAME_LIFE_MARKER} running`].join('\n')

const { sceneLogs } = vi.hoisted(() => ({ sceneLogs: vi.fn(async () => '') }))

vi.mock('../../engine/cmd', () => ({ cmd: { sceneLogs } }))

function hostState(logs: string[]): HostState {
  return {
    recentProjects: [],
    projects: [],
    logs,
    bevyWebDir: '',
    editorSceneDir: '',
    webPort: 8000,
    scenePort: 8004,
    editorScenePort: 8005,
    favourites: []
  }
}

function shell(logs: string[], live?: { push: (line: string) => void }): EditorShell {
  return {
    pickProject: async () => {},
    openProject: async () => {},
    getState: async () => hostState(logs),
    onStackLog: (fn) => {
      if (live !== undefined) live.push = (line) => run(() => fn(line))
    }
  }
}

afterEach(() => {
  sceneLogs.mockReset()
  window.editorShell = undefined
})

describe('the Game tab', () => {
  it('shows which copy of the scene printed each line, and hides the strip’s machinery', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    const drawer = mount(<LogsDrawer open onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.byText('Game', '.eui-logs-tabs button')).not.toBeNull()
    expect(drawer.all('.eui-logs-role').map((el) => el.textContent)).toEqual(['[server]', '[you]'])
    expect(drawer.find('.eui-logs-role.server')).not.toBeNull()
    expect(drawer.find('.eui-logs-role.you')).not.toBeNull()
    expect(drawer.text()).not.toContain(GAME_LIFE_MARKER)
    // the tag is rendered once — the row keeps the rest of the line
    expect(drawer.text()).toContain('openChest: already open')
    drawer.unmount()
  })

  it('shows the shared copy’s lines, which arrive on the build stream', async () => {
    sceneLogs.mockResolvedValue('')
    window.editorShell = shell(['✓ port 8004: server is up (3.1s)', '[server] round 2 started'])
    const drawer = mount(<LogsDrawer open initialTab="scene" onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.text()).toContain('round 2 started')
    expect(drawer.text()).not.toContain('server is up')
    drawer.unmount()
  })

  it('names the gesture that fills it when nothing has printed', async () => {
    sceneLogs.mockResolvedValue('')
    const drawer = mount(<LogsDrawer open onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.text()).toContain(GAME_TAB_EMPTY)
    drawer.unmount()
  })

  it('places a line the server printed among the screen’s, not in front of them', async () => {
    sceneLogs.mockResolvedValue(['[1.0] Log: [you] asked', '[9.0] Log: [you] saw the answer'].join('\n'))
    const live = { push: (_line: string) => {} }
    window.editorShell = shell([], live)
    const drawer = mount(<LogsDrawer open initialTab="scene" onClose={() => {}} />)
    await drawer.settle()
    live.push('[server] answered')
    const rows = drawer.all('.eui-logs-body > span').map((el) => el.textContent ?? '')
    expect(rows.findIndex((r) => r.includes('asked'))).toBeLessThan(rows.findIndex((r) => r.includes('answered')))
    drawer.unmount()
  })

  it('says how the two copies were ordered on the tab, not over the output', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    window.editorShell = shell(['[server] round 2 started'])
    const drawer = mount(<LogsDrawer open initialTab="scene" onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.byText('Game', '.eui-logs-tabs button')?.getAttribute('data-tip')).toBe(GAME_TAB_TIP)
    expect(drawer.find('.eui-logs-body')?.textContent).not.toContain(GAME_TAB_TIP)
    drawer.unmount()
  })

  it('gives an error row the tone that says a creator has to read it', async () => {
    sceneLogs.mockResolvedValue(['[1.0] Log: [you] popup shown', '[1.1] Error: [you] state.score: dropped'].join('\n'))
    const drawer = mount(<LogsDrawer open initialTab="scene" onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.all('.eui-logs-line.error').map((el) => el.textContent)).toEqual([
      '[you][1.1] Error: state.score: dropped\n'
    ])
    drawer.unmount()
  })
})

describe('which tab an opening lands on', () => {
  it('lands on Build by default, where the shell’s output is', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    window.editorShell = shell([])
    const drawer = mount(<LogsDrawer open onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Build')
    expect(drawer.text()).toContain(BUILD_TAB_EMPTY)
    drawer.unmount()
  })

  it('lands on Game when the caller asks for it — the strip’s Logs button', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    window.editorShell = shell([])
    const drawer = mount(<LogsDrawer open initialTab="scene" onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Game')
    expect(drawer.text()).toContain('openChest: already open')
    drawer.unmount()
  })

  it('switches to Game on a later opening that asks for it', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    window.editorShell = shell([])
    const drawer = mount(<LogsDrawer open onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Build')
    drawer.render(<LogsDrawer open initialTab="scene" openKey={1} onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Game')
    drawer.unmount()
  })

  it('goes back to Game when the same opener asks a second time', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    window.editorShell = shell([])
    const drawer = mount(<LogsDrawer open initialTab="scene" openKey={1} onClose={() => {}} />)
    await drawer.settle()
    drawer.click(drawer.byText('Build', '.eui-logs-tabs button'))
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Build')
    drawer.render(<LogsDrawer open initialTab="scene" openKey={2} onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Game')
    drawer.unmount()
  })

  it('an opening that asks for nothing keeps the tab the creator chose', async () => {
    sceneLogs.mockResolvedValue(LOGS)
    window.editorShell = shell([])
    const drawer = mount(<LogsDrawer open initialTab="scene" openKey={1} onClose={() => {}} />)
    await drawer.settle()
    drawer.render(<LogsDrawer open={false} initialTab="scene" openKey={1} onClose={() => {}} />)
    drawer.render(<LogsDrawer open openKey={2} onClose={() => {}} />)
    await drawer.settle()
    expect(drawer.find('.eui-logs-tabs button.on')?.textContent).toBe('Game')
    drawer.unmount()
  })
})
