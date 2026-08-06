import { describe, expect, it } from 'vitest'
import type { PrefabComposite, PrefabData } from '../../prefabs/format'
import {
  SPAWNER_REF_NOTE,
  compositeCarriesSpawner,
  hasSpawnablePrefabs,
  prefabRefOptions,
  refOf,
  refsOf
} from './prefab-options'

function prefab(
  id: string,
  name: string,
  spawnable = true,
  carriesSpawner?: boolean
): { data: PrefabData; carriesSpawner?: boolean } {
  return {
    data: {
      id,
      name,
      category: 'custom',
      tags: [],
      ...(spawnable ? { spawnable: { max: 16 } } : {})
    },
    ...(carriesSpawner === undefined ? {} : { carriesSpawner })
  }
}

function compositeWithScripts(paths: string[]): PrefabComposite {
  return {
    version: 1,
    components: [
      {
        name: 'asset-packs::Script',
        data: {
          '0': { json: { value: paths.map((path) => ({ path, priority: 0, layout: '' })) } }
        }
      }
    ]
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

describe('the prefab options', () => {
  it('lists every project prefab by name — every prefab is spawnable', () => {
    expect(prefabRefOptions(ITEMS, [])).toEqual([
      { value: 'arena-id', label: 'Arena Graveyard' },
      { value: 'door-id', label: 'Door' },
      { value: 'zombie-id', label: 'Zombie Basic' }
    ])
  })

  it('prepends the empty choice only when asked', () => {
    expect(prefabRefOptions(ITEMS, [], true)[0]).toEqual({ value: '', label: 'none' })
  })

  // Dropping a ref the creator cannot see is how a param silently empties itself.
  it('keeps a selected ref the project no longer has, and says why', () => {
    const options = prefabRefOptions(ITEMS, ['gone-id'])
    expect(options.at(-1)).toEqual({ value: 'gone-id', label: 'gone-id — prefab not in this project' })
  })

  it('keeps a selected ref from another project, shortened', () => {
    const options = prefabRefOptions(ITEMS, ['0123456789abcdef'])
    expect(options.at(-1)).toEqual({ value: '0123456789abcdef', label: '01234567… — prefab not in this project' })
  })

  it('never doubles a ref that is already an option', () => {
    expect(prefabRefOptions(ITEMS, ['zombie-id', ''])).toHaveLength(3)
  })

  it('knows when there is nothing to pick', () => {
    expect(hasSpawnablePrefabs(ITEMS)).toBe(true)
    expect(hasSpawnablePrefabs([])).toBe(false)
  })
})

// A spawner offered in a spawn dropdown is a copy that never starts: the bus
// refuses the duplicated spot name, so the pick would silently do nothing.
describe('the spawner filter', () => {
  const WITH_SPAWNER = [...ITEMS, prefab('spot-id', 'Crate Spawner', false, true)]

  it('never offers a prefab that carries a spawner script', () => {
    const options = prefabRefOptions(WITH_SPAWNER, [])
    expect(options.some((option) => option.value === 'spot-id')).toBe(false)
    expect(options).toHaveLength(3)
  })

  it('keeps a selected spawner ref visible, flagged rather than dropped', () => {
    const options = prefabRefOptions(WITH_SPAWNER, ['spot-id'])
    const kept = options.find((option) => option.value === 'spot-id')
    expect(kept?.label).toBe(`Crate Spawner — ${SPAWNER_REF_NOTE}`)
  })

  it('shows the empty state rather than a dropdown of only spawners', () => {
    expect(hasSpawnablePrefabs([prefab('spot-id', 'Crate Spawner', false, true)])).toBe(false)
  })

  it('reads a spawner script off a composite, ignoring carried runtime modules', () => {
    expect(compositeCarriesSpawner(compositeWithScripts(['{assetPath}/scripts/spawner.ts']))).toBe(true)
    expect(compositeCarriesSpawner(compositeWithScripts(['custom/spawner/scripts/spawner.ts']))).toBe(true)
    expect(compositeCarriesSpawner(compositeWithScripts(['{assetPath}/scripts/door.ts']))).toBe(false)
    expect(
      compositeCarriesSpawner(compositeWithScripts(['{assetPath}/scripts/runtime/spawner.ts']))
    ).toBe(false)
    expect(compositeCarriesSpawner({ version: 1, components: [] })).toBe(false)
  })
})
