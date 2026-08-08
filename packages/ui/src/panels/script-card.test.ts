import { describe, expect, it } from 'vitest'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { isAuthoredEntity, synthesizesScriptCard } from './script-card'

describe('who gets a Script card they did not ask for', () => {
  it('every authored entity, whatever else is on it', () => {
    expect(synthesizesScriptCard('512', { Transform: {} }, false)).toBe(true)
    expect(synthesizesScriptCard('4096', {}, false)).toBe(true)
    expect(synthesizesScriptCard('512', undefined, false)).toBe(true)
  })

  it('not the engine entities — Scene root, Player, Camera author nothing', () => {
    expect(isAuthoredEntity('0')).toBe(false)
    expect(isAuthoredEntity('511')).toBe(false)
    expect(isAuthoredEntity('512')).toBe(true)
    expect(synthesizesScriptCard('1', { Transform: {} }, false)).toBe(false)
  })

  it('not a code-spawned entity — the next run would drop the script', () => {
    expect(synthesizesScriptCard('512', { Transform: {} }, true)).toBe(false)
  })

  it('not where the real component already is — that card renders itself', () => {
    expect(synthesizesScriptCard('512', { [SCRIPT_COMPONENT]: { value: [] } }, false)).toBe(false)
  })
})
