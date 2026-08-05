// Shape + defaults for `editor::GameConfig`, the scene-root component that holds
// every tunable NUMBER in a project (wave curves, damage, points). Content never
// lives here — content is a prefab.
//
// The component is engine-opaque (no engine schema to walk), so the inspector
// view edits this normalized value and writes the whole thing back, exactly like
// `asset-packs::AdminTools` does. Everything here is pure so it can be
// unit-tested; the view and the codegen are thin layers on top.
//
// Field order matters on the way out: Schemas.Map serializes in insertion order,
// so `gameConfigJson` rebuilds the object in the registry's order rather than
// spreading whatever came off the wire. The registry order is
// custom-registry.ts's `editor::GameConfig`: version, tables[{name, columns,
// rows}], values[{name, kind, value}].

export const GAME_CONFIG_COMPONENT = 'editor::GameConfig'

export const CONFIG_KINDS = ['number', 'boolean', 'string'] as const
export type ConfigKind = (typeof CONFIG_KINDS)[number]

export interface ConfigColumnDef {
  name: string
  kind: ConfigKind
  min?: number
  max?: number
}

export interface ConfigRow {
  /** row name; blank on every row means the table generates as an array */
  key: string
  /** one raw cell per column, parsed by the column's `kind` */
  cells: string[]
}

export interface ConfigTable {
  name: string
  columns: ConfigColumnDef[]
  rows: ConfigRow[]
}

export interface ConfigScalar {
  name: string
  kind: ConfigKind
  value: string
}

export interface GameConfigValue {
  version: number
  tables: ConfigTable[]
  values: ConfigScalar[]
}

/** One tunable name the shadowing lint compares script params against. */
export interface ConfigColumn {
  /** table it belongs to; '' for a top-level value */
  table: string
  /** the name a script param must not shadow */
  column: string
  kind: ConfigKind
  /** how generated code reads it, e.g. `gameConfig.zombie.hp` */
  accessor: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function int(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function kindOf(value: unknown): ConfigKind {
  const name = str(value)
  return CONFIG_KINDS.includes(name as ConfigKind) ? (name as ConfigKind) : 'number'
}

function normalizeColumn(value: unknown): ConfigColumnDef {
  const source = isRecord(value) ? value : {}
  const column: ConfigColumnDef = { name: str(source.name), kind: kindOf(source.kind) }
  const min = optionalNumber(source.min)
  const max = optionalNumber(source.max)
  if (min !== undefined) column.min = min
  if (max !== undefined) column.max = max
  return column
}

// A row is always exactly as wide as the table: a short row is padded with the
// column's blank cell, a long one is cut. Ragged rows would otherwise reach the
// codegen and emit fields nobody declared.
function normalizeRow(value: unknown, columns: ConfigColumnDef[]): ConfigRow {
  const source = isRecord(value) ? value : {}
  const raw = Array.isArray(source.cells) ? source.cells : []
  const cells = columns.map((column, i) => str(raw[i], blankCell(column.kind)))
  return { key: str(source.key), cells }
}

function normalizeTable(value: unknown): ConfigTable {
  const source = isRecord(value) ? value : {}
  const columns = (Array.isArray(source.columns) ? source.columns : []).map(normalizeColumn)
  const rows = (Array.isArray(source.rows) ? source.rows : []).map((row) => normalizeRow(row, columns))
  return { name: str(source.name), columns, rows }
}

function normalizeScalar(value: unknown): ConfigScalar {
  const source = isRecord(value) ? value : {}
  const kind = kindOf(source.kind)
  return { name: str(source.name), kind, value: str(source.value, blankCell(kind)) }
}

export function blankCell(kind: ConfigKind): string {
  return kind === 'number' ? '0' : kind === 'boolean' ? 'false' : ''
}

export function normalizeGameConfig(value: unknown): GameConfigValue {
  const source = isRecord(value) ? value : {}
  return {
    version: Math.max(0, int(source.version, 0)),
    tables: (Array.isArray(source.tables) ? source.tables : []).map(normalizeTable),
    values: (Array.isArray(source.values) ? source.values : []).map(normalizeScalar)
  }
}

export function gameConfigJson(value: GameConfigValue): string {
  return JSON.stringify({
    version: value.version,
    tables: value.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({
        name: column.name,
        kind: column.kind,
        min: column.min,
        max: column.max
      })),
      rows: table.rows.map((row) => ({ key: row.key, cells: row.cells }))
    })),
    values: value.values.map((scalar) => ({
      name: scalar.name,
      kind: scalar.kind,
      value: scalar.value
    }))
  })
}

/** A table whose every row carries a name generates as a record, not an array. */
export function isKeyedTable(table: ConfigTable): boolean {
  return table.rows.length > 0 && table.rows.every((row) => row.key.trim() !== '')
}

export function findTable(value: GameConfigValue, name: string): ConfigTable | undefined {
  return value.tables.find((table) => table.name === name)
}

export function parseCell(cell: string, kind: ConfigKind): number | boolean | string {
  if (kind === 'number') {
    const parsed = Number(cell.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (kind === 'boolean') return cell.trim().toLowerCase() === 'true'
  return cell
}

// Cell-level validation for the grid's red outline + error count. Returns null
// when the cell is fine; never throws, never coerces silently.
export function cellProblem(cell: string, column: ConfigColumnDef): string | null {
  if (column.kind === 'number') {
    const text = cell.trim()
    if (text === '') return 'empty — expected a number'
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return `"${cell}" is not a number`
    if (column.min !== undefined && parsed < column.min) return `below the minimum (${column.min})`
    if (column.max !== undefined && parsed > column.max) return `above the maximum (${column.max})`
    return null
  }
  if (column.kind === 'boolean') {
    const text = cell.trim().toLowerCase()
    return text === 'true' || text === 'false' ? null : `"${cell}" is not true or false`
  }
  return null
}

export function tableProblemCount(table: ConfigTable): number {
  let count = 0
  for (const row of table.rows) {
    table.columns.forEach((column, i) => {
      if (cellProblem(row.cells[i] ?? '', column) !== null) count += 1
    })
  }
  return count
}

/**
 * The flat name list the config-shadowing lint consumes. An array table
 * contributes its column names; a keyed single-column table contributes its row
 * keys, because those are what the accessor exposes (`gameConfig.zombie.hp`).
 */
export function gameConfigColumns(value: GameConfigValue): ConfigColumn[] {
  const out: ConfigColumn[] = []
  for (const table of value.tables) {
    if (table.name === '') continue
    const keyed = isKeyedTable(table)
    if (keyed && table.columns.length === 1) {
      const kind = table.columns[0].kind
      for (const row of table.rows) {
        out.push({
          table: table.name,
          column: row.key,
          kind,
          accessor: `gameConfig.${table.name}.${row.key}`
        })
      }
      continue
    }
    for (const column of table.columns) {
      if (column.name === '') continue
      out.push({
        table: table.name,
        column: column.name,
        kind: column.kind,
        accessor: keyed
          ? `gameConfig.${table.name}[key].${column.name}`
          : `gameConfig.${table.name}[i].${column.name}`
      })
    }
  }
  for (const scalar of value.values) {
    if (scalar.name === '') continue
    out.push({ table: '', column: scalar.name, kind: scalar.kind, accessor: `gameConfig.${scalar.name}` })
  }
  return out
}

/**
 * Every value of one numeric column, in row order — what the wave-count check
 * reads. Unknown table/column, or a non-numeric column, yields [].
 */
export function tableRowsAsNumbers(value: GameConfigValue, table: string, column: string): number[] {
  const found = findTable(value, table)
  if (found === undefined) return []
  const index = found.columns.findIndex((c) => c.name === column)
  if (index === -1 || found.columns[index].kind !== 'number') return []
  return found.rows.map((row) => Number(parseCell(row.cells[index] ?? '', 'number')))
}

function numberColumn(name: string, min?: number): ConfigColumnDef {
  return min === undefined ? { name, kind: 'number' } : { name, kind: 'number', min }
}

function keyedRows(entries: Array<[string, number]>): ConfigRow[] {
  return entries.map(([key, value]) => ({ key, cells: [String(value)] }))
}

/**
 * The starter table set a new Game Config component is seeded with: the four
 * tunables the zombie-arena walkthrough names. Numbers are shaped after a real
 * wave shooter's curve so the first Play is a game, not a blank sheet.
 */
export function defaultGameConfig(): GameConfigValue {
  return {
    version: 1,
    tables: [
      {
        name: 'waves',
        columns: [
          numberColumn('wave', 1),
          numberColumn('count', 0),
          numberColumn('interval', 0),
          numberColumn('speedMult', 0)
        ],
        rows: [
          { key: '', cells: ['1', '6', '4', '1'] },
          { key: '', cells: ['2', '8', '3.8', '1'] },
          { key: '', cells: ['3', '10', '3.6', '1'] },
          { key: '', cells: ['4', '12', '3.4', '1'] },
          { key: '', cells: ['5', '14', '3.2', '1.5'] },
          { key: '', cells: ['6', '16', '3', '1.5'] },
          { key: '', cells: ['7', '20', '2.8', '1.5'] },
          { key: '', cells: ['8', '24', '2.5', '2'] }
        ]
      },
      {
        name: 'weapons',
        columns: [numberColumn('value')],
        rows: keyedRows([
          ['gunDamage', 12],
          ['fireRate', 4],
          ['reloadSeconds', 1.6],
          ['range', 24]
        ])
      },
      {
        name: 'zombie',
        columns: [numberColumn('value')],
        rows: keyedRows([
          ['hp', 40],
          ['biteDamage', 8],
          ['biteCooldown', 1.2],
          ['pointsPerKill', 5]
        ])
      }
    ],
    values: [{ name: 'WINNER_POINTS', kind: 'number', value: '100' }]
  }
}
