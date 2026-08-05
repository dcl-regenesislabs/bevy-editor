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

  it('renders an unnamed column header as a dash rather than an empty cell', () => {
    const view = mount(
      <TableEditor title="waves" columns={[{ name: '', kind: 'number' }]} rows={[]} onChange={() => {}} />
    )
    expect(view.all('.eui-ds-table-cell.head')[1]?.textContent).toBe('—')
    view.unmount()
  })
})
