import { describe, expect, it } from 'vitest'
import { NAME_COMPONENT } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import type { Snapshot } from '@scene/state'
import { defaultPrefabName, selectionLead } from './create-prefab'

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

