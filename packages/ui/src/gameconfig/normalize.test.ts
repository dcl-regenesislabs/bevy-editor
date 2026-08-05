import { describe, expect, it } from 'vitest'
import {
  GAME_CONFIG_COMPONENT,
  blankCell,
  cellProblem,
  defaultGameConfig,
  findTable,
  gameConfigColumns,
  gameConfigJson,
  isKeyedTable,
  normalizeGameConfig,
  parseCell,
  tableProblemCount,
  tableRowsAsNumbers
} from './normalize'

describe('normalizeGameConfig', () => {
  it('turns anything at all into an empty config', () => {
    for (const junk of [undefined, null, 7, 'x', [], { tables: 'nope', values: 3 }]) {
      expect(normalizeGameConfig(junk)).toEqual({ version: 0, tables: [], values: [] })
    }
  })

  it('pads short rows and cuts long ones to the column count', () => {
    const value = normalizeGameConfig({
      version: 2,
      tables: [
        {
          name: 't',
          columns: [{ name: 'a', kind: 'number' }, { name: 'b', kind: 'string' }],
          rows: [{ key: '', cells: ['1'] }, { key: '', cells: ['1', 'x', 'extra'] }]
        }
      ],
      values: []
    })
    expect(value.tables[0].rows[0].cells).toEqual(['1', ''])
    expect(value.tables[0].rows[1].cells).toEqual(['1', 'x'])
  })

  it('falls back to number for an unknown kind and keeps min/max only when finite', () => {
    const value = normalizeGameConfig({
      tables: [
        {
          name: 't',
          columns: [
            { name: 'a', kind: 'vector' },
            { name: 'b', kind: 'boolean', min: 1, max: 'nope' }
          ],
          rows: []
        }
      ]
    })
    expect(value.tables[0].columns[0]).toEqual({ name: 'a', kind: 'number' })
    expect(value.tables[0].columns[1]).toEqual({ name: 'b', kind: 'boolean', min: 1 })
  })

  it('clamps a negative version to zero and truncates a float one', () => {
    expect(normalizeGameConfig({ version: -4 }).version).toBe(0)
    expect(normalizeGameConfig({ version: 3.9 }).version).toBe(3)
  })

  it('is the component name the registry declares', () => {
    expect(GAME_CONFIG_COMPONENT).toBe('editor::GameConfig')
  })
})

describe('gameConfigJson', () => {
  it('round-trips through normalize unchanged', () => {
    const value = defaultGameConfig()
    expect(normalizeGameConfig(JSON.parse(gameConfigJson(value)))).toEqual(value)
  })

  it('rebuilds in registry field order — the wire encoding depends on it', () => {
    const json = gameConfigJson({
      version: 1,
      tables: [{ name: 't', columns: [{ name: 'a', kind: 'number', max: 9, min: 0 }], rows: [{ key: 'k', cells: ['1'] }] }],
      values: [{ name: 'V', kind: 'string', value: 'x' }]
    })
    expect(json).toBe(
      '{"version":1,"tables":[{"name":"t","columns":[{"name":"a","kind":"number","min":0,"max":9}],' +
        '"rows":[{"key":"k","cells":["1"]}]}],"values":[{"name":"V","kind":"string","value":"x"}]}'
    )
  })

  it('drops undefined min/max rather than emitting nulls', () => {
    const json = gameConfigJson({ version: 0, tables: [{ name: 't', columns: [{ name: 'a', kind: 'number' }], rows: [] }], values: [] })
    expect(json).not.toContain('null')
    expect(json).toContain('{"name":"a","kind":"number"}')
  })
})

describe('cells', () => {
  it('parses by kind and never throws', () => {
    expect(parseCell(' 2.5 ', 'number')).toBe(2.5)
    expect(parseCell('nope', 'number')).toBe(0)
    expect(parseCell('TRUE', 'boolean')).toBe(true)
    expect(parseCell('no', 'boolean')).toBe(false)
    expect(parseCell(' hi ', 'string')).toBe(' hi ')
  })

  it('blank cells match the column kind', () => {
    expect(blankCell('number')).toBe('0')
    expect(blankCell('boolean')).toBe('false')
    expect(blankCell('string')).toBe('')
  })

  it('reports the problems the grid outlines in red', () => {
    const column = { name: 'count', kind: 'number' as const, min: 0, max: 10 }
    expect(cellProblem('4', column)).toBeNull()
    expect(cellProblem('', column)).toContain('empty')
    expect(cellProblem('abc', column)).toContain('not a number')
    expect(cellProblem('-1', column)).toContain('minimum')
    expect(cellProblem('11', column)).toContain('maximum')
    expect(cellProblem('yes', { name: 'b', kind: 'boolean' })).toContain('not true or false')
    expect(cellProblem('anything', { name: 's', kind: 'string' })).toBeNull()
  })

  it('counts every bad cell in a table', () => {
    const table = {
      name: 't',
      columns: [{ name: 'a', kind: 'number' as const }, { name: 'b', kind: 'boolean' as const }],
      rows: [{ key: '', cells: ['x', 'nope'] }, { key: '', cells: ['1', 'true'] }]
    }
    expect(tableProblemCount(table)).toBe(2)
  })
})

describe('table shape', () => {
  it('a table is keyed only when every row carries a name', () => {
    expect(isKeyedTable({ name: 't', columns: [], rows: [{ key: 'a', cells: [] }, { key: 'b', cells: [] }] })).toBe(true)
    expect(isKeyedTable({ name: 't', columns: [], rows: [{ key: 'a', cells: [] }, { key: '', cells: [] }] })).toBe(false)
    expect(isKeyedTable({ name: 't', columns: [], rows: [] })).toBe(false)
  })

  it('finds a table by name', () => {
    expect(findTable(defaultGameConfig(), 'waves')?.columns.map((c) => c.name)).toEqual([
      'wave',
      'count',
      'interval',
      'speedMult'
    ])
    expect(findTable(defaultGameConfig(), 'nope')).toBeUndefined()
  })
})

describe('gameConfigColumns', () => {
  const columns = gameConfigColumns(defaultGameConfig())

  it('lists an array table by column name', () => {
    expect(columns.find((c) => c.column === 'count')).toEqual({
      table: 'waves',
      column: 'count',
      kind: 'number',
      accessor: 'gameConfig.waves[i].count'
    })
  })

  it('lists a keyed single-column table by row key — that is what the accessor exposes', () => {
    expect(columns.find((c) => c.column === 'hp')).toEqual({
      table: 'zombie',
      column: 'hp',
      kind: 'number',
      accessor: 'gameConfig.zombie.hp'
    })
    expect(columns.some((c) => c.table === 'zombie' && c.column === 'value')).toBe(false)
  })

  it('lists top-level values with an empty table', () => {
    expect(columns.find((c) => c.column === 'WINNER_POINTS')).toEqual({
      table: '',
      column: 'WINNER_POINTS',
      kind: 'number',
      accessor: 'gameConfig.WINNER_POINTS'
    })
  })

  it('leaves `speed` alone — client-simulated values stay script params', () => {
    expect(columns.some((c) => c.column === 'speed')).toBe(false)
  })

  it('skips unnamed tables, columns and values', () => {
    const out = gameConfigColumns({
      version: 0,
      tables: [
        { name: '', columns: [{ name: 'a', kind: 'number' }], rows: [] },
        { name: 't', columns: [{ name: '', kind: 'number' }], rows: [] }
      ],
      values: [{ name: '', kind: 'number', value: '1' }]
    })
    expect(out).toEqual([])
  })
})

describe('tableRowsAsNumbers', () => {
  const value = defaultGameConfig()

  it('reads one numeric column in row order', () => {
    expect(tableRowsAsNumbers(value, 'waves', 'count')).toEqual([6, 8, 10, 12, 14, 16, 20, 24])
  })

  it('returns nothing for an unknown table or column', () => {
    expect(tableRowsAsNumbers(value, 'nope', 'count')).toEqual([])
    expect(tableRowsAsNumbers(value, 'waves', 'nope')).toEqual([])
  })

  it('returns nothing for a non-numeric column', () => {
    const text = { version: 0, tables: [{ name: 't', columns: [{ name: 'a', kind: 'string' as const }], rows: [{ key: '', cells: ['3'] }] }], values: [] }
    expect(tableRowsAsNumbers(text, 't', 'a')).toEqual([])
  })
})

describe('defaultGameConfig', () => {
  it('seeds the four tunables the zombie-arena walkthrough names', () => {
    const value = defaultGameConfig()
    expect(value.tables.map((t) => t.name)).toEqual(['waves', 'weapons', 'zombie'])
    expect(value.values.map((v) => v.name)).toEqual(['WINNER_POINTS'])
  })

  it('has no invalid cells', () => {
    for (const table of defaultGameConfig().tables) expect(tableProblemCount(table)).toBe(0)
  })

  it('starts at version 1 so a pinned configVersion is never 0', () => {
    expect(defaultGameConfig().version).toBe(1)
  })
})
