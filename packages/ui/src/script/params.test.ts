import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { state, type Snapshot } from '@scene/state'
import { setScriptParams, writeScriptParamValues } from './params'
import type { PrefabRefChoice } from '../ai/request-format'

const writes = vi.hoisted(() => [] as Array<{ entityId: string; name: string; json: string }>)

vi.mock('../actions/components', () => ({
  uiSetComponentValue: vi.fn(async (_key: string, entityId: string, name: string, json: string) => {
    writes.push({ entityId, name, json })
  })
}))
vi.mock('../engine/datalayer', () => ({ dataLayerReadFile: async () => '' }))

const SCRIPT = 'asset-packs::Script'

interface Row {
  path: string
  priority: number
  layout: string
}

function layout(params: Record<string, unknown>): string {
  return JSON.stringify({ params, actions: [] })
}

function rows(json: string): Row[] {
  return (JSON.parse(json) as { value: Row[] }).value
}

function paramsOf(row: Row): Record<string, { type: string; value: unknown }> {
  return (JSON.parse(row.layout) as { params: Record<string, { type: string; value: unknown }> }).params
}

const SPAWNER_PARAMS = {
  when: { type: 'enum', value: 'when clicked', options: ['when clicked', 'when a player enters'] },
  clickable: { type: 'entity', value: 0 },
  insideZone: { type: 'string', value: '' },
  atMostAtOnce: { type: 'number', value: 1 }
}

function place(params: Record<string, unknown> = SPAWNER_PARAMS, path = 'custom/spawner/scripts/spawner.ts'): void {
  state.snapshot = {
    '600': {
      'core-schema::Name': { value: 'Bench Spawner' },
      [SCRIPT]: { value: [{ path, priority: 0, layout: layout(params) }] }
    }
  } as Snapshot
}

beforeEach(() => {
  writes.length = 0
  place()
})

afterEach(() => {
  state.snapshot = {} as Snapshot
})

describe('writeScriptParamValues', () => {
  // The whole reason this entry point exists: the gesture knows the entity it
  // just right-clicked, and coercion by name can never resolve one.
  it('writes an entity param, which coercion by name refuses', async () => {
    const problems: string[] = []
    const applied = await writeScriptParamValues('600', { when: 'when clicked', clickable: 512 }, problems)
    expect(problems).toEqual([])
    expect(applied.sort()).toEqual(['clickable', 'when'])
    expect(writes).toHaveLength(1)
    const params = paramsOf(rows(writes[0].json)[0])
    expect(params.clickable).toEqual({ type: 'entity', value: 512 })
    expect(params.when.value).toBe('when clicked')
  })

  // One write is one undo step. A gesture that sets four params must not cost
  // the creator four ⌘Z presses to get back to a plain placed prefab.
  it('makes one component write however many params it sets', async () => {
    await writeScriptParamValues(
      '600',
      { when: 'when a player enters', insideZone: 'Front Door', atMostAtOnce: 3 },
      []
    )
    expect(writes).toHaveLength(1)
    expect(writes[0].name).toBe(SCRIPT)
  })

  it('leaves the params it was not given alone', async () => {
    await writeScriptParamValues('600', { insideZone: 'Front Door' }, [])
    const params = paramsOf(rows(writes[0].json)[0])
    expect(params.atMostAtOnce.value).toBe(1)
    expect(params.when.value).toBe('when clicked')
  })

  it('names a setting no script on the entity has, and writes nothing', async () => {
    const problems: string[] = []
    const applied = await writeScriptParamValues('600', { nonsense: 1 }, problems)
    expect(applied).toEqual([])
    expect(writes).toHaveLength(0)
    expect(problems).toEqual(['"Bench Spawner" has no setting called "nonsense"'])
  })

  it('says so when the entity carries no script at all', async () => {
    state.snapshot = { '600': { 'core-schema::Name': { value: 'Bench' } } } as Snapshot
    const problems: string[] = []
    expect(await writeScriptParamValues('600', { when: 'when clicked' }, problems)).toEqual([])
    expect(problems).toEqual(['"Bench" has no script, so its settings were left alone'])
  })
})

describe('setScriptParams', () => {
  const prefabs: PrefabRefChoice[] = [{ id: 'z1', name: 'Zombie Basic', folder: 'custom/zombie_basic' }]

  it('coerces a scalar against the declared type', async () => {
    const problems: string[] = []
    await setScriptParams('600', { atMostAtOnce: '5' }, prefabs, problems)
    expect(problems).toEqual([])
    expect(paramsOf(rows(writes[0].json)[0]).atMostAtOnce.value).toBe(5)
  })

  it('refuses an enum value the param does not offer, with the choices', async () => {
    const problems: string[] = []
    await setScriptParams('600', { when: 'whenever' }, prefabs, problems)
    expect(writes).toHaveLength(0)
    expect(problems[0]).toContain('only accepts "when clicked", "when a player enters"')
  })

  it('refuses an entity param by name, which is what writeScriptParamValues is for', async () => {
    const problems: string[] = []
    await setScriptParams('600', { clickable: 'Front Door' }, prefabs, problems)
    expect(writes).toHaveLength(0)
    expect(problems[0]).toContain('is an entity picker, which only the inspector can set')
  })

  it('resolves a prefab param from the name the assistant saw', async () => {
    place({ spawn: { type: 'prefab', value: '' } })
    await setScriptParams('600', { spawn: 'Zombie Basic' }, prefabs, [])
    expect(paramsOf(rows(writes[0].json)[0]).spawn.value).toBe('z1')
  })
})
