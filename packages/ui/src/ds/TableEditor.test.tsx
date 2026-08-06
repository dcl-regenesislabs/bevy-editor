import { describe, expect, it, vi } from 'vitest'
import { TableEditor, type TableColumn, type TableRow } from './TableEditor'
import { mount } from '../test/render'

const columns: TableColumn[] = [
  { name: 'count', kind: 'number' },
  { name: 'boss', kind: 'boolean' },
  { name: 'note', kind: 'string' }
]

const rows: TableRow[] = [
  { key: 'wave1', cells: ['6', 'false', 'warmup'] },
  { key: 'wave2', cells: ['12', 'true', 'first boss'] }
]

describe('TableEditor render', () => {
  it('mounts with rows and shows the row count', () => {
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} />)
    expect(view.text()).toContain('waves')
    expect(view.find('.eui-ds-table-head .n')?.textContent).toBe('2')
    expect(view.all('.eui-ds-table-cell.head').map((c) => c.textContent)).toEqual(['row', 'count', 'boss', 'note', ''])
    view.unmount()
  })

  it('renders the empty state when there are no rows', () => {
    const view = mount(<TableEditor title="waves" columns={columns} rows={[]} onChange={() => {}} />)
    expect(view.find('.eui-ds-table-empty')?.textContent).toBeTruthy()
    expect(view.all('.eui-ds-table-cell').filter((c) => !c.classList.contains('head'))).toHaveLength(0)
    view.unmount()
  })

  it('survives zero columns without collapsing the grid template', () => {
    const view = mount(<TableEditor title="empty" columns={[]} rows={[{ key: 'a', cells: [] }]} onChange={() => {}} />)
    const grid = view.find('.eui-ds-table-rows')
    expect(grid?.style.gridTemplateColumns).toBe('minmax(120px, 0.8fr) 30px')
    view.unmount()
  })

  it('flags cells the generator cannot read', () => {
    const problemOf = (cell: string, column: TableColumn): string | null =>
      column.kind === 'number' && Number.isNaN(Number(cell)) ? 'not a number' : null
    const view = mount(
      <TableEditor
        title="waves"
        columns={columns}
        rows={[{ key: 'wave1', cells: ['six', 'false', ''] }]}
        onChange={() => {}}
        problemOf={problemOf}
      />
    )
    expect(view.find('.eui-ds-table-head .eui-ds-chip.danger')?.textContent).toContain('1')
    expect(view.all('.eui-ds-table-cell.bad')).toHaveLength(1)
    view.unmount()
  })

  it('adds a row through the header button', () => {
    const onChange = vi.fn()
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={onChange} />)
    view.click(view.byText('+ Row', 'button'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toHaveLength(3)
    view.unmount()
  })

  it('opens the row detail from the ⋯ button and labels every field', () => {
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} />)
    view.click(view.find('[aria-label="row 1 details"]'))
    const detail = view.find('.eui-ds-table-detail')
    expect(detail).not.toBeNull()
    expect(detail?.textContent).toContain('wave1')
    expect(view.find('.eui-ds-table-detail [aria-label="row name"]')).not.toBeNull()
    view.unmount()
  })

  it('only offers the column editor when the caller can accept one', () => {
    const withOut = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} />)
    expect(withOut.byText('Columns', 'button')).toBeNull()
    withOut.unmount()

    const withIn = mount(
      <TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} onColumnsChange={() => {}} />
    )
    withIn.click(withIn.byText('Columns', 'button'))
    expect(withIn.all('.eui-ds-table-col')).toHaveLength(3)
    withIn.unmount()
  })

  it('stages a cell keystroke and writes through only on settle', () => {
    const onChange = vi.fn()
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={onChange} />)
    view.type(view.find('[aria-label="row 1 note"]'), 'edited', false)
    expect(onChange).not.toHaveBeenCalled()
    expect((view.find('[aria-label="row 1 note"]') as HTMLInputElement).value).toBe('edited')
    view.type(view.find('[aria-label="row 1 note"]'), 'edited')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0].cells[2]).toBe('edited')
    view.unmount()
  })

  it('stages a row name the same way and keeps the other rows intact', () => {
    const onChange = vi.fn()
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={onChange} />)
    view.type(view.find('[aria-label="row 1 name"]'), 'opener', false)
    expect(onChange).not.toHaveBeenCalled()
    view.type(view.find('[aria-label="row 1 name"]'), 'opener')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].map((r: TableRow) => r.key)).toEqual(['opener', 'wave2'])
    view.unmount()
  })

  it('writes a boolean cell on the click itself, since there is nothing to settle', () => {
    const onChange = vi.fn()
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={onChange} />)
    view.click(view.find('[aria-label="row 1 boss"]'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0].cells[1]).toBe('true')
    view.unmount()
  })

  it('renames a column on settle, never once per keystroke', () => {
    const onColumnsChange = vi.fn()
    const view = mount(
      <TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} onColumnsChange={onColumnsChange} />
    )
    view.click(view.byText('Columns', 'button'))
    view.type(view.find('[aria-label="column 1 name"]'), 'amount', false)
    expect(onColumnsChange).not.toHaveBeenCalled()
    expect((view.find('[aria-label="column 1 name"]') as HTMLInputElement).value).toBe('amount')
    view.type(view.find('[aria-label="column 1 name"]'), 'amount')
    expect(onColumnsChange).toHaveBeenCalledTimes(1)
    expect(onColumnsChange.mock.calls[0][0][0]).toEqual({ name: 'amount', kind: 'number' })
    view.unmount()
  })

  it('rewrites every cell of a column when its type changes', () => {
    const onColumnsChange = vi.fn()
    const view = mount(
      <TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} onColumnsChange={onColumnsChange} />
    )
    view.click(view.byText('Columns', 'button'))
    view.click(view.find('[aria-label="column 1 type"]'))
    view.click(view.byText('string', '[role="option"]'))
    expect(onColumnsChange).toHaveBeenCalledTimes(1)
    expect(onColumnsChange.mock.calls[0][0][0].kind).toBe('string')
    expect(onColumnsChange.mock.calls[0][1].map((r: TableRow) => r.cells[0])).toEqual(['', ''])
    view.unmount()
  })

  it('keeps columns and row cells the same length when one is added or removed', () => {
    const onColumnsChange = vi.fn()
    const view = mount(
      <TableEditor title="waves" columns={columns} rows={rows} onChange={() => {}} onColumnsChange={onColumnsChange} />
    )
    view.click(view.byText('Columns', 'button'))
    view.click(view.byText('+ Column', 'button'))
    expect(onColumnsChange.mock.calls[0][0]).toHaveLength(4)
    expect(onColumnsChange.mock.calls[0][1][0].cells).toEqual(['6', 'false', 'warmup', '0'])
    view.click(view.find('[aria-label="remove column 1"]'))
    expect(onColumnsChange.mock.calls[1][0].map((c: TableColumn) => c.name)).toEqual(['boss', 'note'])
    expect(onColumnsChange.mock.calls[1][1][0].cells).toEqual(['false', 'warmup', '0'])
    view.unmount()
  })

  it('pages a table longer than one page, and lands a new row on the last page', () => {
    const many: TableRow[] = [1, 2, 3, 4, 5].map((n) => ({ key: `wave${n}`, cells: [String(n), 'false', ''] }))
    const view = mount(<TableEditor title="waves" columns={columns} rows={many} onChange={() => {}} pageSize={2} />)
    expect(view.find('[aria-label="row 1 name"]')).not.toBeNull()
    expect(view.find('[aria-label="row 3 name"]')).toBeNull()
    view.click(view.byText('Next ›', 'button'))
    expect(view.find('[aria-label="row 1 name"]')).toBeNull()
    expect(view.find('[aria-label="row 3 name"]')).not.toBeNull()
    view.click(view.byText('+ Row', 'button'))
    expect(view.find('[aria-label="row 5 name"]')).not.toBeNull()
    expect(view.find('[aria-label="row 6 name"]')).not.toBeNull()
    view.unmount()
  })

  it('deletes a row only after the confirm, and closes the detail behind it', () => {
    const onChange = vi.fn()
    const view = mount(<TableEditor title="waves" columns={columns} rows={rows} onChange={onChange} />)
    view.click(view.find('[aria-label="row 1 details"]'))
    view.click(view.byText('Delete row', 'button'))
    expect(onChange).not.toHaveBeenCalled()
    view.click(view.byText('Delete this row?', 'button'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].map((r: TableRow) => r.key)).toEqual(['wave2'])
    expect(view.find('.eui-ds-table-detail')).toBeNull()
    view.unmount()
  })

  it('renders an unnamed column header as a dash rather than an empty cell', () => {
    const view = mount(
      <TableEditor title="waves" columns={[{ name: '', kind: 'number' }]} rows={[]} onChange={() => {}} />
    )
    expect(view.all('.eui-ds-table-cell.head')[1]?.textContent).toBe('—')
    view.unmount()
  })
})
