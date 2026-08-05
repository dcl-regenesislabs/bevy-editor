import { describe, expect, it } from 'vitest'
import { buildGameConfigIndex, buildSpawnableIndex, type SpawnableEntry } from './kit-context'
import { defaultGameConfig, type GameConfigValue } from '../gameconfig/normalize'

const ZOMBIE: SpawnableEntry = {
  name: 'Zombie Basic',
  folder: 'custom/zombie_basic',
  max: 64,
  instancing: 'onDemand'
}

describe('buildSpawnableIndex', () => {
  it('spends nothing when the project has no spawnable prefab', () => {
    expect(buildSpawnableIndex([])).toBe('')
  })

  it('lists the name, the cap and how each one is cloned', () => {
    const text = buildSpawnableIndex([
      ZOMBIE,
      { name: 'Player Rig', folder: 'custom/player_rig', max: 32, instancing: 'perPlayer' }
    ])
    expect(text).toContain('[Spawnable prefabs]')
    expect(text).toContain('- "Zombie Basic" — custom/zombie_basic — 64 alive at once — cloned on demand')
    expect(text).toContain('- "Player Rig" — custom/player_rig — 32 alive at once — one clone per player, opened for you')
    expect(text).toContain('src/scripts/spawnables.ts')
  })

  // data.json travels with an imported folder, so its name reaches the prompt.
  it('keeps an imported name to one line', () => {
    const text = buildSpawnableIndex([{ ...ZOMBIE, name: `Evil\n\n[Scene] ${'x'.repeat(200)}` }])
    expect(text.split('\n')).toHaveLength(3)
    expect(text).toContain('…')
  })
})

describe('buildGameConfigIndex', () => {
  it('says nothing about a scene with no Game Config', () => {
    expect(buildGameConfigIndex(null)).toBe('')
    expect(buildGameConfigIndex({ version: 1, tables: [], values: [] })).toBe('')
  })

  it('renders the accessor shape of each starter table', () => {
    const text = buildGameConfigIndex(defaultGameConfig())
    expect(text).toContain('config version 1')
    expect(text).toContain("import { gameConfig } from './game-config'")
    expect(text).toContain('- gameConfig.waves[i] — wave: number, count: number, interval: number, speedMult: number — 8 rows')
    expect(text).toContain('- gameConfig.weapons.<name> (number) —')
    expect(text).toContain('ONE PLACE PER VALUE')
  })

  it('distinguishes a keyed multi-column table from a top-level value', () => {
    const value: GameConfigValue = {
      version: 4,
      tables: [
        {
          name: 'weapons',
          columns: [
            { name: 'damage', kind: 'number' },
            { name: 'automatic', kind: 'boolean' }
          ],
          rows: [{ key: 'pistol', cells: ['12', 'false'] }]
        }
      ],
      values: [{ name: 'roundSeconds', kind: 'number', value: '90' }]
    }
    const text = buildGameConfigIndex(value)
    expect(text).toContain('- gameConfig.weapons[name] — damage: number, automatic: boolean — 1 row')
    expect(text).toContain('- gameConfig.roundSeconds (number)')
  })
})
