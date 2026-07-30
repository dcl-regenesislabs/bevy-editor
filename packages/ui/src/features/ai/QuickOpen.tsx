import { useEffect, useMemo, useRef, useState } from 'react'
import { useLoad } from '../../ds/hooks'
import { dataLayerListFiles } from '../../datalayer'
import { IGNORED_DIRS, baseName, dirName, isHidden, isViewable, rankQuickOpen } from '../../script/project-files'

const MAX_SHOWN = 50

export function QuickOpen(props: { onOpen: (path: string) => void; onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { data } = useLoad(() => dataLayerListFiles(IGNORED_DIRS), [])

  const files = useMemo(() => (data ?? []).filter((p) => isViewable(p) && !isHidden(p)), [data])
  const shown = useMemo(() => rankQuickOpen(files, query).slice(0, MAX_SHOWN), [files, query])

  useEffect(() => inputRef.current?.focus(), [])
  useEffect(() => setIndex(0), [query])

  const open = (path: string | undefined): void => {
    if (path === undefined) return
    props.onOpen(path)
    props.onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(index + 1, shown.length - 1) : Math.max(index - 1, 0)
      setIndex(next)
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(shown[index])
    }
  }

  return (
    <div className="eui-qopen-veil" onMouseDown={props.onClose}>
      <div className="eui-qopen" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Go to file…"
          spellCheck={false}
        />
        <div className="eui-qopen-list" ref={listRef}>
          {data !== undefined && shown.length === 0 && <div className="eui-qopen-none">No files match “{query.trim()}”</div>}
          {shown.map((p, i) => (
            <button
              key={p}
              className={`eui-qopen-row ${i === index ? 'on' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => open(p)}
            >
              <span className="nm">{baseName(p)}</span>
              {dirName(p) !== '' && <span className="dir">{dirName(p)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
