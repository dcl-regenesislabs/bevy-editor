import { useEffect, useMemo, useState, type ReactNode } from 'react'
import css from './TableEditor.css?inline'
import { registerCss } from './styles/registry'
import { Button, ControlButton, GroupLabel, NumberField, PropRow, Select, TextInput, Toggle } from '.'
import { Chip } from './Chip'
import { ConfirmButton } from './ConfirmButton'
import { Pager } from './Pager'
import { usePageClamp } from './hooks'

registerCss('ds/TableEditor', 'primitives', css)

export const TABLE_KINDS = ['number', 'boolean', 'string'] as const
export type TableKind = (typeof TABLE_KINDS)[number]

export interface TableColumn {
  name: string
  kind: TableKind
  min?: number
  max?: number
}

export interface TableRow {
  key: string
  cells: string[]
}

export interface TableEditorProps {
  title: string
  columns: TableColumn[]
  rows: TableRow[]
  onChange: (rows: TableRow[]) => void
  /** columns and rows always land together: a column change rewrites every row */
  onColumnsChange?: (columns: TableColumn[], rows: TableRow[]) => void
  problemOf?: (cell: string, column: TableColumn) => string | null
  blankCell?: (kind: TableKind) => string
  keyLabel?: string
  keyPlaceholder?: string
  note?: string
  pageSize?: number
  actions?: ReactNode
}

const KIND_OPTIONS = TABLE_KINDS.map((kind) => ({ value: kind, label: kind }))
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ')
const defaultBlank = (kind: TableKind): string => (kind === 'number' ? '0' : kind === 'boolean' ? 'false' : '')

function CellEditor(props: {
  column: TableColumn
  value: string
  /** `settle` = write through to onChange; typing only stages into the draft */
  onSet: (next: string, settle: boolean) => void
  label: string
}): JSX.Element {
  if (props.column.kind === 'boolean') {
    return (
      <Toggle
        size="sm"
        checked={props.value.trim().toLowerCase() === 'true'}
        aria-label={props.label}
        onChange={(on) => props.onSet(on ? 'true' : 'false', true)}
      />
    )
  }
  if (props.column.kind === 'number') {
    return (
      <NumberField
        value={props.value}
        aria-label={props.label}
        min={props.column.min}
        max={props.column.max}
        onChange={(e) => props.onSet(e.target.value, false)}
        onBlur={(e) => props.onSet(e.target.value, true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    )
  }
  return (
    <TextInput
      value={props.value}
      aria-label={props.label}
      onChange={(e) => props.onSet(e.target.value, false)}
      onBlur={(e) => props.onSet(e.target.value, true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function TableEditor(props: TableEditorProps): JSX.Element {
  const { columns, onChange, problemOf } = props
  const pageSize = props.pageSize ?? 25
  const blank = props.blankCell ?? defaultBlank
  const signature = JSON.stringify(props.rows)
  const [draft, setDraft] = useState<TableRow[]>(props.rows)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [showColumns, setShowColumns] = useState(false)

  useEffect(() => {
    setDraft(props.rows)
  }, [signature])

  const commit = (rows: TableRow[]): void => {
    setDraft(rows)
    onChange(rows)
  }

  // Every edit computes the next rows and either stages them (typing) or writes
  // through (blur, toggle, structural change). Staging never reads back from a
  // pending setState, so an immediate write-through cannot lose the keystroke
  // that caused it.
  const setCell = (rowIndex: number, cellIndex: number, next: string, settle: boolean): void => {
    const rows = draft.map((row, i) =>
      i === rowIndex ? { ...row, cells: row.cells.map((cell, j) => (j === cellIndex ? next : cell)) } : row
    )
    if (settle) commit(rows)
    else setDraft(rows)
  }

  const setKey = (rowIndex: number, next: string, settle: boolean): void => {
    const rows = draft.map((row, i) => (i === rowIndex ? { ...row, key: next } : row))
    if (settle) commit(rows)
    else setDraft(rows)
  }

  const problems = useMemo(() => {
    if (problemOf === undefined) return new Map<string, string>()
    const found = new Map<string, string>()
    draft.forEach((row, i) => {
      columns.forEach((column, j) => {
        const problem = problemOf(row.cells[j] ?? '', column)
        if (problem !== null) found.set(`${i}:${j}`, problem)
      })
    })
    return found
  }, [draft, columns, problemOf])

  const pageRows = draft.slice(offset, offset + pageSize)
  const page = { items: pageRows, total: draft.length, offset }
  usePageClamp(page, offset, setOffset, pageSize)

  const body = columns.length === 0 ? '' : ` repeat(${columns.length}, minmax(84px, 1fr))`
  const template = `minmax(120px, 0.8fr)${body} 30px`
  const detail = selected !== null && selected < draft.length ? draft[selected] : null

  const addRow = (): void => {
    commit([...draft, { key: '', cells: columns.map((column) => blank(column.kind)) }])
    setSelected(draft.length)
    setOffset(Math.floor(draft.length / pageSize) * pageSize)
  }

  const removeRow = (index: number): void => {
    commit(draft.filter((_, i) => i !== index))
    setSelected(null)
  }

  const setColumns = (next: TableColumn[], mapCells: (cells: string[]) => string[]): void => {
    const rows = draft.map((row) => ({ ...row, cells: mapCells(row.cells) }))
    setDraft(rows)
    props.onColumnsChange?.(next, rows)
  }

  return (
    <section className="eui-ds-table">
      <header className="eui-ds-table-head">
        <span className="t">{props.title}</span>
        <span className="n">{draft.length}</span>
        {problems.size > 0 && (
          <Chip tone="danger" size="xs" tip="Cells the generator cannot read">
            {problems.size} {problems.size === 1 ? 'error' : 'errors'}
          </Chip>
        )}
        <span className="sp" />
        {props.actions}
        {props.onColumnsChange !== undefined && (
          <Button size="xs" variant="ghost" active={showColumns} onClick={() => setShowColumns(!showColumns)}>
            Columns
          </Button>
        )}
        <Button size="xs" variant="ghost" onClick={addRow}>
          + Row
        </Button>
      </header>

      {props.note !== undefined && <p className="eui-ds-table-note">{props.note}</p>}

      {props.onColumnsChange !== undefined && showColumns && (
        <div className="eui-ds-table-cols">
          {columns.map((column, j) => (
            <div className="eui-ds-table-col" key={j}>
              <TextInput
                value={column.name}
                aria-label={`column ${j + 1} name`}
                onChange={(e) => setColumns(columns.map((c, i) => (i === j ? { ...c, name: e.target.value } : c)), (cells) => cells)}
              />
              <Select
                density="compact"
                value={column.kind}
                options={KIND_OPTIONS}
                aria-label={`column ${j + 1} type`}
                onChange={(kind) =>
                  setColumns(
                    columns.map((c, i) => (i === j ? { ...c, kind: kind as TableKind } : c)),
                    (cells) => cells.map((cell, i) => (i === j ? blank(kind as TableKind) : cell))
                  )
                }
              />
              <ControlButton
                size="sm"
                tip="Remove this column"
                aria-label={`remove column ${j + 1}`}
                onClick={() => setColumns(columns.filter((_, i) => i !== j), (cells) => cells.filter((_, i) => i !== j))}
              >
                ✕
              </ControlButton>
            </div>
          ))}
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              setColumns([...columns, { name: `field${columns.length + 1}`, kind: 'number' }], (cells) => [...cells, blank('number')])
            }
          >
            + Column
          </Button>
        </div>
      )}

      <div className="eui-ds-table-grid">
        <div className="eui-ds-table-rows" style={{ gridTemplateColumns: template }}>
          <div className="eui-ds-table-cell head key">{props.keyLabel ?? 'row'}</div>
          {columns.map((column, j) => (
            <div className="eui-ds-table-cell head" key={j}>
              {column.name === '' ? '—' : column.name}
            </div>
          ))}
          <div className="eui-ds-table-cell head" />
          {pageRows.map((row, i) => {
            const index = offset + i
            return (
              <RowCells
                key={index}
                row={row}
                index={index}
                columns={columns}
                problems={problems}
                selected={selected === index}
                keyPlaceholder={props.keyPlaceholder ?? 'unnamed'}
                onSetKey={(next, settle) => setKey(index, next, settle)}
                onSetCell={(j, next, settle) => setCell(index, j, next, settle)}
                onSelect={() => setSelected(selected === index ? null : index)}
              />
            )
          })}
        </div>
        {draft.length === 0 && <p className="eui-ds-table-empty">No rows yet.</p>}
      </div>

      <Pager page={page} pageSize={pageSize} onOffset={setOffset} />

      {detail !== null && selected !== null && (
        <div className="eui-ds-table-detail">
          <GroupLabel>{detail.key === '' ? `Row ${selected + 1}` : detail.key}</GroupLabel>
          <PropRow label={props.keyLabel ?? 'row'}>
            <TextInput
              value={detail.key}
              aria-label="row name"
              placeholder={props.keyPlaceholder ?? 'unnamed'}
              onChange={(e) => setKey(selected, e.target.value, false)}
              onBlur={(e) => setKey(selected, e.target.value, true)}
            />
          </PropRow>
          {columns.map((column, j) => (
            <PropRow key={j} label={column.name === '' ? `field ${j + 1}` : column.name}>
              <CellEditor
                column={column}
                value={detail.cells[j] ?? ''}
                label={`${column.name} detail`}
                onSet={(next, settle) => setCell(selected, j, next, settle)}
              />
              {problems.get(`${selected}:${j}`) !== undefined && <span className="eui-ds-table-err">{problems.get(`${selected}:${j}`)}</span>}
            </PropRow>
          ))}
          <div className="eui-ds-table-detail-foot">
            <ConfirmButton label="Delete row" confirm="Delete?" onConfirm={() => removeRow(selected)} />
            <Button size="xs" variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function RowCells(props: {
  row: TableRow
  index: number
  columns: TableColumn[]
  problems: Map<string, string>
  selected: boolean
  keyPlaceholder: string
  onSetKey: (next: string, settle: boolean) => void
  onSetCell: (column: number, next: string, settle: boolean) => void
  onSelect: () => void
}): JSX.Element {
  return (
    <>
      <div className={cx('eui-ds-table-cell', 'key', props.selected && 'on')}>
        <TextInput
          value={props.row.key}
          aria-label={`row ${props.index + 1} name`}
          placeholder={props.keyPlaceholder}
          onChange={(e) => props.onSetKey(e.target.value, false)}
          onBlur={(e) => props.onSetKey(e.target.value, true)}
        />
      </div>
      {props.columns.map((column, j) => {
        const problem = props.problems.get(`${props.index}:${j}`)
        return (
          <div className={cx('eui-ds-table-cell', props.selected && 'on', problem !== undefined && 'bad')} key={j} data-tip={problem}>
            <CellEditor
              column={column}
              value={props.row.cells[j] ?? ''}
              label={`row ${props.index + 1} ${column.name}`}
              onSet={(next, settle) => props.onSetCell(j, next, settle)}
            />
          </div>
        )
      })}
      <div className={cx('eui-ds-table-cell', 'more', props.selected && 'on')}>
        <ControlButton size="sm" active={props.selected} tip="Row details" aria-label={`row ${props.index + 1} details`} onClick={props.onSelect}>
          ⋯
        </ControlButton>
      </div>
    </>
  )
}
