import { describe, expect, it } from 'vitest'
import { createdDetail, createdHead } from './prefab-created'
import type { PrefabCreated } from './prefab-store'

const made = (over: Partial<PrefabCreated> = {}): PrefabCreated => ({
  folder: 'custom/zombie',
  name: 'Zombie',
  max: 12,
  instancing: 'onDemand',
  placement: 'unplaced',
  ...over
})

describe('the sentence a just-created prefab gets', () => {
  it('tells a plain prefab how to place another one', () => {
    expect(createdHead(made({ max: null }))).toContain('in your prefabs')
    expect(createdDetail(made({ max: null }))).toContain('Drag it')
  })

  it('answers "why is it not in my scene?" before it is asked', () => {
    const detail = createdDetail(made())
    expect(detail).toContain('12')
    expect(detail).toContain('that is normal')
  })

  it('counts players, not copies, when every player gets one', () => {
    const detail = createdDetail(made({ instancing: 'perPlayer', max: 16 }))
    expect(detail).toContain('16 players')
    expect(detail).not.toContain('16 copies')
  })

  it('says the built copy stayed, and whether the game can see it', () => {
    expect(createdDetail(made({ placement: 'editorAndPlay' }))).toContain('stays in the scene')
    const ghost = createdDetail(made({ placement: 'editingOnly' }))
    expect(ghost).toContain('dimmed for editing')
    expect(ghost).toContain('never sees it')
  })

  it('never promises a spawn count for a prefab nothing can spawn', () => {
    expect(createdDetail(made({ max: null, placement: 'editorAndPlay' }))).not.toContain('while it runs')
  })
})
