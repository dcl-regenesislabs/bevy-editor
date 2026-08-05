import { describe, expect, it } from 'vitest'
import type { PrefabData } from '../../prefabs/format'
import { hasSpawnablePrefabs, prefabRefOptions, refOf, refsOf } from './prefab-options'

function prefab(id: string, name: string, spawnable = true): { data: PrefabData } {
  return {
    data: {
      id,
      name,
      category: 'custom',
      tags: [],
      ...(spawnable ? { spawnable: { max: 16 } } : {})
    }
  }
}

const ITEMS = [prefab('zombie-id', 'Zombie Basic'), prefab('arena-id', 'Arena Graveyard'), prefab('door-id', 'Door', false)]

describe('reading a PrefabRef param value', () => {
  it('accepts an array, the legacy comma string, and neither', () => {
    expect(refsOf(['a', 'b'])).toEqual(['a', 'b'])
    expect(refsOf(' a , b ')).toEqual(['a', 'b'])
    expect(refsOf('')).toEqual([])
    expect(refsOf(42)).toEqual([])
    expect(refsOf(['a', 'a', '', 7])).toEqual(['a'])
  })

  it('reads a single ref, blank when it is not a string', () => {
    expect(refOf(' zombie-id ')).toBe('zombie-id')
    expect(refOf(['zombie-id'])).toBe('')
  })
})

describe('the Spawnable prefab options', () => {
  it('lists Spawnable prefabs by name and leaves the rest out', () => {
    expect(prefabRefOptions(ITEMS, [])).toEqual([
      { value: 'arena-id', label: 'Arena Graveyard' },
      { value: 'zombie-id', label: 'Zombie Basic' }
    ])
  })

  it('prepends the empty choice only when asked', () => {
    expect(prefabRefOptions(ITEMS, [], true)[0]).toEqual({ value: '', label: 'none' })
  })

  // Dropping a ref the creator cannot see is how a param silently empties itself.
  it('keeps a selected prefab that is no longer Spawnable, and says why', () => {
    const options = prefabRefOptions(ITEMS, ['door-id'])
    expect(options.at(-1)).toEqual({ value: 'door-id', label: 'Door — Spawnable is off' })
  })

  it('keeps a selected ref from another project, shortened', () => {
    const options = prefabRefOptions(ITEMS, ['0123456789abcdef'])
    expect(options.at(-1)).toEqual({ value: '0123456789abcdef', label: '01234567… — prefab not in this project' })
  })

  it('never doubles a ref that is already an option', () => {
    expect(prefabRefOptions(ITEMS, ['zombie-id', ''])).toHaveLength(2)
  })

  it('knows when there is nothing to pick', () => {
    expect(hasSpawnablePrefabs(ITEMS)).toBe(true)
    expect(hasSpawnablePrefabs([prefab('door-id', 'Door', false)])).toBe(false)
  })
})
