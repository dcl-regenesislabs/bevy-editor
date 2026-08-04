import { useMemo, useState } from 'react'
import { useLoad } from '../../ds/hooks'
import { PanelState, SearchField } from '../../ds'
import { dataLayerListFiles } from '../../engine/datalayer'
import { IGNORED_DIRS, buildTree, filterTree, allDirPaths, type TreeNode } from '../../script/project-files'

export function FileRail(props: {
  active: string | null
  onOpen: (path: string) => void
  reloadKey: number
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { data, err, reload } = useLoad(() => dataLayerListFiles(IGNORED_DIRS), [props.reloadKey])

  const tree = useMemo(() => buildTree(data ?? []), [data])
  const shown = useMemo(() => filterTree(tree, query), [tree, query])
  const searching = query.trim() !== ''
  const searchOpen = useMemo(() => (searching ? new Set(allDirPaths(shown)) : null), [searching, shown])

  const isOpen = (path: string): boolean => (searchOpen !== null ? searchOpen.has(path) : expanded.has(path))
  const toggle = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <div className="eui-studio-rail">
      <div className="eui-studio-rail-head">
        <SearchField value={query} onChange={setQuery} placeholder="Filter files" />
      </div>
      <div className="eui-studio-rail-body">
        <PanelState err={err} onRetry={reload} loading={false} />
        {data === undefined && err === null && <RailSkeleton />}
        {data !== undefined && shown.length === 0 && (
          <div className="eui-file-empty">
            <p>{searching ? `No files match "${query.trim()}"` : 'No files in this project yet.'}</p>
            {searching && (
              <button className="eui-link" onClick={() => setQuery('')}>
                Clear filter
              </button>
            )}
          </div>
        )}
        {shown.map((node) => (
          <Node
            key={node.path}
            node={node}
            depth={0}
            active={props.active}
            isOpen={isOpen}
            toggle={toggle}
            onOpen={props.onOpen}
          />
        ))}
      </div>
    </div>
  )
}

function Node(props: {
  node: TreeNode
  depth: number
  active: string | null
  isOpen: (path: string) => boolean
  toggle: (path: string) => void
  onOpen: (path: string) => void
}): JSX.Element {
  const { node, depth } = props
  const guides = Array.from({ length: depth }, (_, i) => <span key={i} className="ind" />)

  if (!node.dir) {
    if (!node.viewable) {
      const why = node.kind === 'model' ? 'No 3D preview yet — drop it in the scene to see it' : "Can't be previewed"
      return (
        <div className="eui-file-row off" title={why}>
          {guides}
          <span className="slot" />
          <KindGlyph kind={node.kind} />
          <span className="nm">{node.name}</span>
        </div>
      )
    }
    return (
      <button
        className={`eui-file-row k-${node.kind} ${node.path === props.active ? 'active' : ''}`}
        onClick={() => props.onOpen(node.path)}
        title={node.kind === 'code' ? node.path : `${node.path} — read-only`}
      >
        {guides}
        <span className="slot" />
        <KindGlyph kind={node.kind} />
        <span className="nm">{node.name}</span>
        {node.kind !== 'code' && <LockGlyph />}
      </button>
    )
  }

  const open = props.isOpen(node.path)
  return (
    <>
      <button className="eui-file-row dir" onClick={() => props.toggle(node.path)}>
        {guides}
        <span className={`caret ${open ? 'open' : ''}`}>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <FolderGlyph />
        <span className="nm">{node.name}</span>
      </button>
      {open &&
        node.children.map((child) => (
          <Node
            key={child.path}
            node={child}
            depth={depth + 1}
            active={props.active}
            isOpen={props.isOpen}
            toggle={props.toggle}
            onOpen={props.onOpen}
          />
        ))}
    </>
  )
}

const GLYPHS: Record<TreeNode['kind'], JSX.Element> = {
  code: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  text: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  image: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.6" cy="6.4" r="1.1" fill="currentColor" />
      <path d="M4 12.4l3.1-3.3 2.2 2.2 1.9-1.9 2.6 2.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  model: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.6l5.5 3.2v6.4L8 14.4l-5.5-3.2V4.8L8 1.6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2.6 4.9L8 8l5.4-3.1M8 8v6.2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  binary: (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.8h5.2L12.8 5.2v9H4V1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 1.8v3.6h3.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function KindGlyph(props: { kind: TreeNode['kind'] }): JSX.Element {
  return <span className={`ki k-${props.kind}`}>{GLYPHS[props.kind]}</span>
}

function FolderGlyph(): JSX.Element {
  return (
    <span className="ki">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.8 4c0-.66.54-1.2 1.2-1.2h3.1l1.5 1.6h5.4c.66 0 1.2.54 1.2 1.2v6c0 .66-.54 1.2-1.2 1.2H3c-.66 0-1.2-.54-1.2-1.2V4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function LockGlyph(): JSX.Element {
  return (
    <span className="ro" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 7V4.8a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  )
}

const SKELETON: Array<{ w: number; d: number }> = [
  { w: 74, d: 0 },
  { w: 96, d: 0 },
  { w: 62, d: 1 },
  { w: 108, d: 1 },
  { w: 82, d: 1 },
  { w: 58, d: 0 },
  { w: 90, d: 0 }
]

function RailSkeleton(): JSX.Element {
  return (
    <div className="eui-file-skel" aria-hidden="true">
      {SKELETON.map((r, i) => (
        <div key={i} className="row" style={{ paddingLeft: 6 + r.d * 14 }}>
          <span className="b ic" />
          <span className="b ln" style={{ width: r.w }} />
        </div>
      ))}
    </div>
  )
}
