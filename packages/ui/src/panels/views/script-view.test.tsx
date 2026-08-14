import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state } from '@scene/state'
import { ScriptView } from './script-view'
import { consumerStore } from '../../prefabs/consumers'
import { aiStore } from '../ai-store'
import { prefabStore, type PrefabEntry } from '../prefab-store'
import { clearScriptFocus, focusScriptCreate, scriptFocus } from '../script-card'
import { mount, run } from '../../test/render'

vi.mock('../../engine/datalayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../engine/datalayer')>()),
  dataLayerAvailable: () => true
}))

const presence = vi.hoisted(() => ({ value: 'unknown' as 'present' | 'absent' | 'unknown' }))
vi.mock('../../features/play/server-presence', () => ({
  readServerPresence: async () => presence.value
}))

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

// The card the inspector synthesizes on an entity with no Script component: same
// view, no items (BL5).
function emptyCard(entityId = '512') {
  return mount(
    <ScriptView
      cKey={`${entityId}:asset-packs::Script`}
      entityId={entityId}
      name="asset-packs::Script"
      value={undefined}
      schema={undefined}
      commit={() => {}}
      apply={() => {}}
    />
  )
}

function withAssistant(): void {
  Object.defineProperty(window, 'editorShell', {
    configurable: true,
    value: { aiSend: () => {} }
  })
}

beforeEach(() => {
  presence.value = 'unknown'
  run(() => {
    aiStore.prefill = null
    clearScriptFocus()
  })
})

afterEach(() => {
  run(() => {
    consumerStore.scripts = {}
    consumerStore.loaded = false
    prefabStore.items = []
    prefabStore.loaded = false
    prefabStore.libraryLoaded = false
    state.snapshot = {}
  })
  Reflect.deleteProperty(window, 'editorShell')
})

// The complaint this answers, in the owner's words: they placed an Announcer,
// saw hold seconds and font size, and nothing on screen said that the thing
// which makes it speak is a game.broadcast the server sends. The line lives in
// the prefab's own data.json and lands under those very params.
describe('the line that drives a placed kit item', () => {
  const DRIVE = {
    rule: 'This item shows nothing by itself — the server sends a line.',
    code: "game.broadcast('announce', { text: 'Round over' })",
    next: 'Press New script below and write that line inside the isServer() block it comes with.'
  }
  const OWN = 'custom/announcer/scripts/announcer.tsx'

  function placed(drivenBy?: PrefabEntry['data']['drivenBy'], paths: string[] = [OWN]) {
    run(() => {
      prefabStore.loaded = true
      prefabStore.libraryLoaded = true
      prefabStore.items = [
        {
          folder: 'custom/announcer',
          hasGuide: true,
          data: {
            id: 'a1',
            name: 'Announcer',
            category: 'custom',
            tags: [],
            ...(drivenBy === undefined ? {} : { drivenBy })
          }
        }
      ]
      state.snapshot = { '512': { 'inspector::CustomAsset': { assetId: 'a1' } } }
    })
    return mount(
      <ScriptView
        cKey="512:asset-packs::Script"
        entityId="512"
        name="asset-packs::Script"
        value={{ value: paths.map((path) => ({ path, priority: 0 })) }}
        schema={undefined}
        commit={() => {}}
        apply={() => {}}
      />
    )
  }

  it('states the rule, the literal line and the next gesture', () => {
    const card = placed(DRIVE)
    expect(card.text()).toContain(DRIVE.rule)
    expect(card.find('.eui-drive-code')?.textContent).toBe(DRIVE.code)
    expect(card.text()).toContain(DRIVE.next)
    card.unmount()
  })

  it('offers the line for copying', () => {
    const writes: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (v: string) => void writes.push(v) }
    })
    const card = placed(DRIVE)
    card.click(card.byText('Copy', 'button'))
    expect(writes).toEqual([DRIVE.code])
    card.unmount()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  // An item that drives itself must not grow an empty row — the whole point of
  // the field being optional.
  it('grows no row for an item with nothing to say', () => {
    const card = placed(undefined)
    expect(card.find('.eui-drive')).toBeNull()
    card.unmount()
  })

  // A reaction the creator wrote is not what the prefab is talking about.
  it('sits under the prefab’s own script, not under the creator’s', () => {
    const card = placed(DRIVE, ['src/scripts/round-rules.ts', OWN])
    const entries = card.all('.eui-script-entry')
    expect(entries).toHaveLength(2)
    expect(entries[0].querySelector('.eui-drive')).toBeNull()
    expect(entries[1].querySelector('.eui-drive')).not.toBeNull()
    card.unmount()
  })
})

// The stored values are the wire the kit scripts, their guides and the assistant prompt
// all write; the card is the one place a creator reads them, so it reads words.
describe('the Script card on a kit enum param', () => {
  function cardWithParam(param: object) {
    return mount(
      <ScriptView
        cKey="1:asset-packs::Script"
        entityId="1"
        name="asset-packs::Script"
        value={{ value: [{ path: PATH, priority: 0, layout: JSON.stringify({ params: { p: param }, actions: [] }) }] }}
        schema={undefined}
        commit={() => {}}
        apply={() => {}}
      />
    )
  }

  it('reads Game Flow’s endsWhen as words, not as timer / script', () => {
    const card = cardWithParam({ type: 'enum', value: 'timer', options: ['timer', 'script'] })
    card.click(card.find('.eui-ds-select-field'))
    expect(card.all('.eui-ds-pop-row').map((row) => row.textContent)).toEqual([
      'this clock',
      'your own script'
    ])
    card.unmount()
  })

  it('reads the Leaderboard’s sort as which end of the board wins', () => {
    const card = cardWithParam({ type: 'enum', value: 'desc', options: ['desc', 'asc'] })
    card.click(card.find('.eui-ds-select-field'))
    expect(card.all('.eui-ds-pop-row').map((row) => row.textContent)).toEqual([
      'highest wins',
      'lowest wins'
    ])
    card.unmount()
  })
})

// The headline fix: an entity with no script must still answer "how do I make
// this do something" on the card itself — the component picker was the only way
// in, and no creator finds it there.
describe('the Script card with nothing on it', () => {
  it('names the state and offers the three ways out of it', () => {
    withAssistant()
    const card = emptyCard()
    expect(card.text()).toContain('This entity does nothing yet — give it a script.')
    expect(card.byText('New script', 'button')).not.toBeNull()
    expect(card.byText('Attach an existing script…', 'button')).not.toBeNull()
    expect(card.byText('Ask the assistant', 'button')).not.toBeNull()
    card.unmount()
  })

  it('drops the assistant a prompt about this entity, unsent', () => {
    withAssistant()
    run(() => {
      state.snapshot = { '512': { 'core-schema::Name': { value: 'Wall Button' } } }
    })
    const card = emptyCard()
    card.click(card.byText('Ask the assistant', 'button'))
    expect(aiStore.prefill).toBe('Make "Wall Button" do something when a player clicks it')
    card.unmount()
  })

  // A scene with a Multiplayer Server is a scene where "do something" has two
  // answers, so the seed asks for the one every player sees.
  it('asks for something every player sees when the scene has a Multiplayer Server', async () => {
    withAssistant()
    presence.value = 'present'
    run(() => {
      state.snapshot = { '512': { 'core-schema::Name': { value: 'Wall Button' } } }
    })
    const card = emptyCard()
    await card.settle()
    card.click(card.byText('Ask the assistant', 'button'))
    expect(aiStore.prefill).toBe('Make "Wall Button" do something every player sees when one of them clicks it')
    card.unmount()
  })

  // An unnamed entity still gets a whole sentence — a seed the creator edits,
  // never a fragment they have to finish before it reads as a request.
  it('says "this entity" when the entity has no name yet', () => {
    withAssistant()
    const card = emptyCard()
    card.click(card.byText('Ask the assistant', 'button'))
    expect(aiStore.prefill).toBe('Make "this entity" do something when a player clicks it')
    card.unmount()
  })

  it('keeps the create and attach gestures once a script is on it, and drops the line', () => {
    withAssistant()
    const card = view('export class WallButton {}')
    expect(card.text()).not.toContain('This entity does nothing yet')
    expect(card.byText('New script', 'button')).not.toBeNull()
    expect(card.byText('Ask the assistant', 'button')).toBeNull()
    card.unmount()
  })

  it('lands the right-click gesture on the button that creates the script', () => {
    const card = emptyCard()
    run(() => focusScriptCreate('512'))
    expect(document.activeElement).toBe(card.byText('New script', 'button'))
    // taken once: reselecting the entity must not steal focus again
    expect(scriptFocus.entityId).toBeNull()
    card.unmount()
  })

  it('ignores a focus request aimed at another entity', () => {
    const card = emptyCard('600')
    run(() => focusScriptCreate('512'))
    expect(document.activeElement).not.toBe(card.byText('New script', 'button'))
    card.unmount()
  })
})
