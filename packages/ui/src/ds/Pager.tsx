// "‹ 1–50 of 132 ›" pagination row for server-paginated lists.
import type { PageInfo } from './hooks'

// "‹ 1–50 of 132 ›" pagination row; hidden when everything fits on one page
export function Pager(props: { page: PageInfo | undefined; onOffset: (o: number) => void; pageSize?: number }): JSX.Element | null {
  const p = props.page
  const pageSize = props.pageSize ?? 50
  if (p === undefined || p.total <= pageSize) return null
  const from = p.offset + 1
  const to = p.offset + p.items.length
  return (
    <div className="eui-pager">
      <button className="eui-link" disabled={p.offset === 0} onClick={() => props.onOffset(Math.max(0, p.offset - pageSize))}>
        ‹ Prev
      </button>
      <span className="rng">
        {from}–{to} of {p.total}
      </span>
      <button className="eui-link" disabled={to >= p.total} onClick={() => props.onOffset(p.offset + pageSize)}>
        Next ›
      </button>
    </div>
  )
}
