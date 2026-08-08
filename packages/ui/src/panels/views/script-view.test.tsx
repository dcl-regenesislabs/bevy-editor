import { afterEach, describe, expect, it } from 'vitest'
import { state } from '@scene/state'
import { ScriptView } from './script-view'
import { consumerStore } from '../../prefabs/consumers'
import { RUNS_ON_BLUE, RUNS_ON_GREEN, RUNS_ON_GREEN_TIP, RUNS_ON_BLUE_TIP } from '../../script/runs-on'
import { mount, run } from '../../test/render'

const PATH = 'src/scripts/wall-button.ts'

function view(source?: string) {
  run(() => {
    consumerStore.loaded = true
    consumerStore.scripts = source === undefined ? {} : { [PATH]: source }
  })
  return mount(
    <ScriptView
      cKey="1:asset-packs::Script"
      entityId="1"
      name="asset-packs::Script"
      value={{ value: [{ path: PATH, priority: 0 }] }}
      schema={undefined}
      commit={() => {}}
      apply={() => {}}
    />
  )
}

afterEach(() => {
  run(() => {
    consumerStore.scripts = {}
    consumerStore.loaded = false
    state.snapshot = {}
  })
})

describe('the runs-on line on a behavior card', () => {
  it('says where the code runs, in the game’s words', () => {
    const card = view(
      `import { game, onClick } from './runtime/game'
      game.onMessage('openChest', () => {})
      game.onEnterZone('Vault', () => {})
      onClick(this.entity, () => {})`
    )
    expect(card.text()).toContain(`${RUNS_ON_GREEN}openChest · enter Vault`)
    expect(card.text()).toContain(`${RUNS_ON_BLUE}clicks`)
    // the same tone chips a prefab card wears, so the colour language is one
    expect(card.find('.eui-script-runs-on .eui-ds-chip.server')?.dataset.tip).toBe(RUNS_ON_GREEN_TIP)
    expect(card.find('.eui-script-runs-on .eui-ds-chip.client')?.dataset.tip).toBe(RUNS_ON_BLUE_TIP)
    card.unmount()
  })

  it('says nothing on a script that never uses the game', () => {
    const card = view('export class WallButton { start() {} }')
    expect(card.find('.eui-script-runs-on')).toBeNull()
    card.unmount()
  })

  it('says nothing while the script’s text is still unread', () => {
    const card = view()
    expect(card.find('.eui-script-runs-on')).toBeNull()
    card.unmount()
  })
})
