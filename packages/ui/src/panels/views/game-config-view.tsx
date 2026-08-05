import { useState } from 'react'
import type { ComponentView, ComponentViewProps } from './types'
import {
  Button,
  Chip,
  ConfirmButton,
  ControlButton,
  GroupLabel,
  Notice,
  NumberField,
  PropRow,
  Select,
  TextInput,
  Toggle
} from '../../ds'
import { TableEditor } from '../../ds/TableEditor'
import {
  CONFIG_KINDS,
  blankCell,
  cellProblem,
  defaultGameConfig,
  gameConfigJson,
  isKeyedTable,
  normalizeGameConfig,
  type ConfigKind,
  type ConfigScalar,
  type ConfigTable,
  type GameConfigValue
} from '../../gameconfig/normalize'

const KIND_OPTIONS = CONFIG_KINDS.map((kind) => ({ value: kind, label: kind }))

const KEYED_NOTE =
  'Name every row to read it as gameConfig.<table>.<row>; leave the names blank and the table generates as an array.'

function ScalarEditor(props: { scalar: ConfigScalar; onChange: (value: string) => void }): JSX.Element {
  if (props.scalar.kind === 'boolean') {
    return (
      <Toggle
        size="sm"
        checked={props.scalar.value.trim().toLowerCase() === 'true'}
        aria-label={`${props.scalar.name} value`}
        onChange={(on) => props.onChange(on ? 'true' : 'false')}
      />
    )
  }
  if (props.scalar.kind === 'number') {
    return (
      <NumberField
        defaultValue={props.scalar.value}
        aria-label={`${props.scalar.name} value`}
        onBlur={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    )
  }
  return (
    <TextInput
      defaultValue={props.scalar.value}
      aria-label={`${props.scalar.name} value`}
      onBlur={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export const GameConfigView: ComponentView = (props: ComponentViewProps): JSX.Element => {
  const value = normalizeGameConfig(props.value)
  const [newTable, setNewTable] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newKind, setNewKind] = useState<ConfigKind>('number')

  const apply = (next: GameConfigValue): void => props.apply(gameConfigJson({ ...next, version: next.version + 1 }))

  const patchTable = (index: number, patch: Partial<ConfigTable>): void =>
    apply({ ...value, tables: value.tables.map((table, i) => (i === index ? { ...table, ...patch } : table)) })

  const taken = new Set([...value.tables.map((t) => t.name), ...value.values.map((v) => v.name), 'version'])

  const addTable = (): void => {
    const name = newTable.trim()
    if (name === '' || taken.has(name)) return
    setNewTable('')
    apply({ ...value, tables: [...value.tables, { name, columns: [{ name: 'value', kind: 'number' }], rows: [] }] })
  }

  const addValue = (): void => {
    const name = newValue.trim()
    if (name === '' || taken.has(name)) return
    setNewValue('')
    apply({ ...value, values: [...value.values, { name, kind: newKind, value: blankCell(newKind) }] })
  }

  const isEmpty = value.tables.length === 0 && value.values.length === 0

  return (
    <div>
      <Notice>
        Numbers only — anything that could exist twice is a prefab. A value lives in exactly one place: once it is here, read it
        through <code>gameConfig</code>, never through a script param. {KEYED_NOTE}
      </Notice>

      <PropRow label="version">
        <Chip size="xs" tip="Pinned by the plan tuple; bumps on every edit and lands at the next phase boundary.">
          v{value.version}
        </Chip>
      </PropRow>

      {isEmpty && (
        <Button size="xs" variant="ghost" onClick={() => apply(defaultGameConfig())}>
          Start from the wave-shooter defaults
        </Button>
      )}

      {value.tables.map((table, index) => (
        <TableEditor
          key={`${index}:${table.name}`}
          title={table.name === '' ? 'unnamed' : table.name}
          columns={table.columns}
          rows={table.rows}
          problemOf={cellProblem}
          blankCell={blankCell}
          keyLabel="row"
          note={isKeyedTable(table) ? undefined : KEYED_NOTE}
          onChange={(rows) => patchTable(index, { rows })}
          onColumnsChange={(columns, rows) => patchTable(index, { columns, rows })}
          actions={
            <ConfirmButton
              label="Remove"
              confirm="Remove table?"
              onConfirm={() => apply({ ...value, tables: value.tables.filter((_, i) => i !== index) })}
            />
          }
        />
      ))}

      <PropRow label="add table">
        <TextInput
          value={newTable}
          placeholder="waves"
          aria-label="new table name"
          onChange={(e) => setNewTable(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTable()
          }}
        />
        <Button size="xs" variant="ghost" disabled={newTable.trim() === '' || taken.has(newTable.trim())} onClick={addTable}>
          Add
        </Button>
      </PropRow>

      <GroupLabel>Values</GroupLabel>
      {value.values.map((scalar, index) => (
        <PropRow key={`${index}:${scalar.name}`} label={scalar.name === '' ? 'unnamed' : scalar.name}>
          <ScalarEditor
            scalar={scalar}
            onChange={(next) =>
              apply({ ...value, values: value.values.map((v, i) => (i === index ? { ...v, value: next } : v)) })
            }
          />
          <ControlButton
            size="sm"
            tip="Remove this value"
            aria-label={`remove ${scalar.name}`}
            onClick={() => apply({ ...value, values: value.values.filter((_, i) => i !== index) })}
          >
            ✕
          </ControlButton>
        </PropRow>
      ))}

      <PropRow label="add value">
        <TextInput
          value={newValue}
          placeholder="WINNER_POINTS"
          aria-label="new value name"
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addValue()
          }}
        />
        <Select
          density="compact"
          value={newKind}
          options={KIND_OPTIONS}
          aria-label="new value type"
          onChange={(kind) => setNewKind(kind as ConfigKind)}
        />
        <Button size="xs" variant="ghost" disabled={newValue.trim() === '' || taken.has(newValue.trim())} onClick={addValue}>
          Add
        </Button>
      </PropRow>
    </div>
  )
}
