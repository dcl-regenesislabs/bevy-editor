// "Move to…" — file the selected entities into a folder.
//
// It reuses ContextMenu as its shell rather than authoring a floating surface:
// that component already owns pointer positioning, viewport clamping,
// shadow-DOM-safe outside-close and Escape, and its own comment records what
// went wrong the last time those were hand-rolled per call site.
//
// Two gestures, deliberately separate: a single click picks a destination, a
// double click walks into it. Merging them (drill in on one click, move to
// wherever you are) reads faster until you want the folder you are standing in
// and find there is no way to say so.
import { useMemo, useState } from 'react'
import { state, type Snapshot } from '@scene/state'
import { useStore } from '../core/store'
import { uiReparentEntities } from '../actions/entities'
import { Button, ContextMenu, SearchField } from '../ds'
import { IconFolder } from '../icons'
import { folderTree, levelOf, searchFolders, trailTo, type FolderNode } from './move-to'
import css from './move-to.css?inline'
import { registerCss } from '../ds/styles/registry'

registerCss('panels/move-to', 'features', css)

export interface MoveTarget {
  x: number
  y: number
  ids: string[]
}

export function MoveToPicker(props: { target: MoveTarget; onClose: () => void }): JSX.Element {
  const { ids } = props.target
  const snapshot = useStore(() => state.snapshot) as Snapshot
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [picked, setPicked] = useState<FolderNode | null>(null)

  const roots = useMemo(() => folderTree(snapshot, ids), [snapshot, ids])
  const searching = query.trim() !== ''
  const rows = searching ? searchFolders(roots, query) : levelOf(roots, openId)
  const trail = trailTo(roots, openId)

  const commit = (): void => {
    if (picked === null) return
    void uiReparentEntities(ids, picked.id)
    props.onClose()
  }

  // Searching flattens the tree, so a result may live anywhere; opening one has
  // to take the browser with it or the breadcrumb would lie about where you are.
  const open = (node: FolderNode): void => {
    setOpenId(node.id)
    setQuery('')
    setPicked(null)
  }

  return (
    <ContextMenu x={props.target.x} y={props.target.y} onClose={props.onClose} className="eui-moveto">
      <SearchField
        size="sm"
        value={query}
        placeholder="Search folders"
        onChange={(v) => {
          setQuery(v)
          setPicked(null)
        }}
      />
      {!searching && (
        <div className="eui-moveto-head">
          <button className={`eui-moveto-crumb ${openId === null ? 'here' : ''}`} onClick={() => setOpenId(null)}>
            All folders
          </button>
          {trail.map((n, i) => (
            <span key={n.id}>
              {' / '}
              <button
                className={`eui-moveto-crumb ${i === trail.length - 1 ? 'here' : ''}`}
                onClick={() => setOpenId(n.id)}
              >
                {n.name}
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="eui-moveto-list">
        {rows.length === 0 ? (
          <div className="eui-moveto-empty">
            {searching ? 'No folder matches' : openId === null ? 'This scene has no folders yet' : 'No folders in here'}
          </div>
        ) : (
          rows.map((n) => (
            <button
              key={n.id}
              className={`eui-moveto-row ${picked?.id === n.id ? 'picked' : ''}`}
              disabled={!n.enabled}
              data-tip={n.blockedReason}
              onClick={() => setPicked(n)}
              onDoubleClick={() => open(n)}
            >
              <span className="glyph">
                <IconFolder />
              </span>
              <span className="label">{n.name}</span>
              {n.children.length > 0 && <span className="into">›</span>}
            </button>
          ))
        )}
      </div>
      <div className="eui-moveto-foot">
        <span className="target">
          {picked === null ? `${ids.length} selected` : `Move ${ids.length} to ${picked.name}`}
        </span>
        <Button variant="primary" disabled={picked === null} onClick={commit}>
          OK
        </Button>
      </div>
    </ContextMenu>
  )
}
