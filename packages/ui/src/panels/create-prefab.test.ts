import { describe, expect, it } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import type { Snapshot } from '@scene/state'
import { defaultPrefabName, selectionLead, selectionScriptTexts } from './create-prefab'

const named = (name: string, parent = 0, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  [NAME_COMPONENT]: { value: name },
  Transform: { parent },
  ...extra
})

const script = (path: string): Record<string, unknown> => ({
  [SCRIPT_COMPONENT]: { value: [{ path, layout: '' }] }
})

describe('defaultPrefabName', () => {
  it('takes the name of a lone root', () => {
    const snapshot = { '512': named('Zombie') } as unknown as Snapshot
    expect(defaultPrefabName(snapshot, ['512'])).toBe('Zombie')
  })

  it('falls back when the selection has no single owner to name it after', () => {
    const snapshot = { '512': named('Zombie'), '513': named('Crate') } as unknown as Snapshot
    expect(defaultPrefabName(snapshot, ['512', '513'])).toBe('Prefab')
  })
})

describe('selectionLead', () => {
  it('names the one thing being captured', () => {
    const snapshot = { '512': named('Zombie') } as unknown as Snapshot
    expect(selectionLead(snapshot, ['512'])).toContain('Zombie')
  })

  it('counts them when there is no one thing', () => {
    const snapshot = { '512': named('Zombie'), '513': named('Crate') } as unknown as Snapshot
    expect(selectionLead(snapshot, ['512', '513'])).toContain('2 selected entities')
  })
})

describe('selectionScriptTexts', () => {
  it('reads the scripts the capture will carry, descendants included', () => {
    const snapshot = {
      '512': named('Zombie', 0, script('custom/zombie/brain.ts')),
      '513': named('Arm', 512, script('custom/zombie/arm.ts'))
    } as unknown as Snapshot
    const scripts = { 'custom/zombie/brain.ts': 'brain', 'custom/zombie/arm.ts': 'arm' }
    expect(selectionScriptTexts(snapshot, ['512'], scripts).sort()).toEqual(['arm', 'brain'])
  })

  it('leaves out what the selection does not carry', () => {
    const snapshot = {
      '512': named('Zombie', 0, script('custom/zombie/brain.ts')),
      '600': named('Door', 0, script('src/door.ts'))
    } as unknown as Snapshot
    const scripts = { 'custom/zombie/brain.ts': 'brain', 'src/door.ts': 'door' }
    expect(selectionScriptTexts(snapshot, ['512'], scripts)).toEqual(['brain'])
  })

  it('says nothing when the project scripts have not been read', () => {
    const snapshot = { '512': named('Zombie', 0, script('custom/zombie/brain.ts')) } as unknown as Snapshot
    expect(selectionScriptTexts(snapshot, ['512'], {})).toEqual([])
  })

  it('survives a parent cycle rather than hanging on it', () => {
    const snapshot = {
      '512': named('A', 513),
      '513': named('B', 512, script('custom/x.ts'))
    } as unknown as Snapshot
    expect(selectionScriptTexts(snapshot, ['999'], { 'custom/x.ts': 'x' })).toEqual([])
  })
})
