import { describe, expect, it } from 'vitest'
import { createdDetail, createdHead } from './prefab-created'
import type { PrefabCreated } from './prefab-store'

const made = (over: Partial<PrefabCreated> = {}): PrefabCreated => ({
  folder: 'custom/zombie',
  name: 'Zombie',
  placement: 'unplaced',
  ...over
})

describe('the sentence a just-created prefab gets', () => {
  it('says where it went and how to place another one', () => {
    expect(createdHead(made())).toContain('in your prefabs')
    expect(createdDetail(made({ placement: 'editorAndPlay' }))).toContain('Drag it')
  })

  it('answers "why is it not in my scene?" before it is asked', () => {
    const detail = createdDetail(made())
    expect(detail).toContain('that is normal')
  })

  it('always says the game can spawn it — every prefab is spawnable', () => {
    expect(createdDetail(made())).toContain('spawn copies')
    expect(createdDetail(made({ placement: 'editorAndPlay' }))).toContain('spawn copies')
  })
})
