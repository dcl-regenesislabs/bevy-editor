import { useEffect, useRef, useState } from 'react'
import {
  state,
  buildForest,
  toggleEntity,
  expandEntity,
  topLevelSelected,
  entityLabel,
  parentOf,
  componentKey,
  type Forest,
  type Snapshot
} from '../../../scene/src/state'
import { entityName, NAME_COMPONENT } from '../../../scene/src/custom-components'
import { childCount } from '../../../scene/src/inspector'
import {
  uiSelectEntity,
  uiClearSelection,
  uiFocusEntity,
  uiSetComponentValue,
  uiAddEntity,
  uiDuplicateEntity,
  uiDeleteEntity,
  uiDeleteEntityRecursive,
  uiDeleteEntityReparent,
  uiReparentToActive,
  uiReparentEntities,
  uiClearParent
} from '../actions'
import { useStore } from '../store'
import { IconPlus, IconImport, IconTrash, IconCamera, IconEdit } from '../icons'
import { LeftTabs, type LeftView } from './AssetsPanel'

// While editing (paused) only authored entities — those with a Name — are shown;
// runtime entities reappear when the scene is running or via the show-all toggle.
function namedForest(snapshot: typeof state.snapshot): Forest {
  const named = Object.keys(snapshot).filter(
    (id) => snapshot[id]?.[NAME_COMPONENT] !== undefined && id !== '0'
  )
  const namedSet = new Set(named)
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const id of named) {
    let p = parentOf(snapshot, id)
    while (p !== null && !namedSet.has(p)) p = parentOf(snapshot, p)
    if (p === null) {
      roots.push(id)
    } else {
      const siblings = children.get(p) ?? []
      siblings.push(id)
      children.set(p, siblings)
    }
  }
  const byId = (a: string, b: string): number => Number(a) - Number(b)
  roots.sort(byId)
  for (const s of children.values()) s.sort(byId)
  return { roots, children }
}

type CtxMenu = { x: number; y: number; id: string }

type DragHandlers = {
  dropTarget: string | null
  begin: (id: string) => void
  over: (id: string) => void
  end: () => void
  drop: (targetId: string) => void
}

export function HierarchyPanel(props: {
  showAll: boolean
  width?: number
  onNewEntity: () => void
  onView: (v: LeftView) => void
}): JSX.Element {
  const snapshotState = useStore(() => state.snapshot)
  const status = useStore(() => state.status)
  // only authored (Name-carrying) entities, running or paused — runtime
  // entities appear solely via the explicit show-all toggle
  const showAll = props.showAll
  const snapshot = snapshotState as Snapshot
  const forest = showAll ? buildForest(snapshot) : namedForest(snapshot)
  const [filter, setFilter] = useState('')
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // drag-to-reparent: `dropTarget` is the row id (or '0' for the root/unparent
  // zone) currently hovered; `dragIds` holds the entities being dragged.
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const dragIds = useRef<string[]>([])

  const drag: DragHandlers = {
    dropTarget,
    begin(id) {
      dragIds.current =
        state.selected.has(id) && state.selected.size > 1
          ? topLevelSelected(state.snapshot)
          : [id]
    },
    over(id) {
      // can't drop onto a member of the dragged set (incl. its own subtree)
      setDropTarget(dragIds.current.includes(id) ? null : id)
    },
    end() {
      dragIds.current = []
      setDropTarget(null)
    },
    drop(targetId) {
      const ids = dragIds.current
      dragIds.current = []
      setDropTarget(null)
      if (ids.length === 0 || ids.includes(targetId)) return
      void uiReparentEntities(ids, targetId)
      if (targetId !== '0') expandEntity(targetId)
    }
  }

  const matches = (id: string): boolean => {
    if (filter === '') return true
    const name = entityName(snapshot, id) ?? ''
    return name.toLowerCase().includes(filter.toLowerCase()) || id.includes(filter)
  }

  return (
    <div className="eui-panel eui-left" style={{ width: props.width }}>
      <LeftTabs view="scene" onView={props.onView} />
      <div className="eui-panel-head">
        <div className="eui-head-text">
          <span className="eui-overline">Scene</span>
          <span className="eui-title">{sceneTitle()}</span>
        </div>
        <button className="eui-btn icon" data-tip="Browse assets" onClick={() => props.onView('assets')}>
          <IconImport />
        </button>
        <button className="eui-btn icon" data-tip="New entity" onClick={props.onNewEntity}>
          <IconPlus />
        </button>
      </div>
      <div className="eui-search">
        <input
          className="eui-input"
          placeholder="Search…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div
        className={`eui-panel-body${dropTarget === '0' ? ' drop-root' : ''}`}
        style={{ padding: '8px 0' }}
        onClick={() => uiClearSelection()}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (dragIds.current.length === 0) return
          e.preventDefault()
          setDropTarget('0')
        }}
        onDrop={(e) => {
          e.preventDefault()
          drag.drop('0')
        }}
      >
        {forest.roots.map((id) => (
          <EntityRow
            key={id}
            id={id}
            depth={0}
            forest={forest}
            matches={matches}
            renaming={renaming}
            setRenaming={setRenaming}
            drag={drag}
            onContext={(e, rowId) => {
              e.preventDefault()
              e.stopPropagation()
              if (!state.selected.has(rowId)) uiSelectEntity(rowId, false, false)
              setCtx({ x: e.clientX, y: e.clientY, id: rowId })
            }}
          />
        ))}
        {forest.roots.length === 0 && (
          <div className="eui-empty">
            {status === 'ready' ? 'No named entities yet — create one with +' : sceneTitle()}
          </div>
        )}
      </div>
      {ctx !== null && (
        <ContextMenu
          ctx={ctx}
          onClose={() => setCtx(null)}
          onRename={(id) => setRenaming(id)}
        />
      )}
    </div>
  )
}

function sceneTitle(): string {
  if (state.scene !== undefined) return state.scene.title
  if (state.status === 'logging-in') return 'Connecting…'
  if (state.status === 'no-scene') return 'No scene'
  if (state.status === 'loading-snapshot') return 'Loading…'
  return 'Entities'
}

function ContextMenu(props: {
  ctx: CtxMenu
  onClose: () => void
  onRename: (id: string) => void
}): JSX.Element {
  const { ctx, onClose, onRename } = props
  const snapshot = useStore(() => state.snapshot)
  const selected = useStore(() => state.selected)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent): void => {
      // composedPath: targets inside the shadow root are retargeted on document
      if (ref.current !== null && !e.composedPath().includes(ref.current)) onClose()
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [onClose])

  // keep the menu inside the viewport
  const style: React.CSSProperties = {
    left: Math.min(ctx.x, window.innerWidth - 220),
    top: Math.min(ctx.y, window.innerHeight - 240)
  }

  const id = ctx.id
  const kids = childCount(id)
  const parented = (snapshot[id]?.Transform as { parent?: number } | undefined)?.parent !== 0
  const multi = selected.size >= 2

  const act = (fn: () => void): (() => void) => () => {
    fn()
    onClose()
  }

  return (
    <div ref={ref} className="eui-ctx" style={style}>
      <button className="eui-menu-item" onClick={act(() => uiFocusEntity(id))}>
        <IconCamera /> Focus camera
      </button>
      <button className="eui-menu-item" onClick={act(() => onRename(id))}>
        <IconEdit /> Rename
      </button>
      <button className="eui-menu-item" onClick={act(() => void uiAddEntity('Entity', Number(id)))}>
        <IconPlus /> New child entity
      </button>
      <button className="eui-menu-item" onClick={act(() => void uiDuplicateEntity(id))}>
        <IconPlus /> Duplicate
      </button>
      <div className="eui-menu-sep" />
      {multi && (
        <button className="eui-menu-item" onClick={act(() => void uiReparentToActive())}>
          Parent selection here
        </button>
      )}
      {parented && (
        <button className="eui-menu-item" onClick={act(() => void uiClearParent())}>
          Unparent
        </button>
      )}
      {(multi || parented) && <div className="eui-menu-sep" />}
      {kids === 0 ? (
        <button className="eui-menu-item danger" onClick={act(() => void uiDeleteEntity(id))}>
          <IconTrash /> Delete
        </button>
      ) : (
        <>
          <button className="eui-menu-item danger" onClick={act(() => void uiDeleteEntityReparent(id))}>
            <IconTrash /> Delete, keep children
          </button>
          <button className="eui-menu-item danger" onClick={act(() => void uiDeleteEntityRecursive(id))}>
            <IconTrash /> Delete with {kids} child{kids === 1 ? '' : 'ren'}
          </button>
        </>
      )}
    </div>
  )
}

function EntityRow(props: {
  id: string
  depth: number
  forest: Forest
  matches: (id: string) => boolean
  renaming: string | null
  setRenaming: (id: string | null) => void
  drag: DragHandlers
  onContext: (e: React.MouseEvent, id: string) => void
}): JSX.Element | null {
  const { id, depth, forest, matches, renaming, setRenaming, drag, onContext } = props
  const expandedEntities = useStore(() => state.expandedEntities)
  const selected = useStore(() => state.selected)
  const snapshot = useStore(() => state.snapshot)
  const children = forest.children.get(id) ?? []
  const expanded = expandedEntities.has(id)
  const name = entityName(snapshot as Snapshot, id)
  const visible = matches(id)

  const commitRename = (value: string): void => {
    setRenaming(null)
    const v = value.trim()
    if (v === '' || v === name) return
    const key = componentKey(id, NAME_COMPONENT)
    void uiSetComponentValue(key, id, NAME_COMPONENT, JSON.stringify({ value: v }))
  }

  return (
    <>
      {visible && (
        <div
          className={`eui-row ${selected.has(id) ? 'selected' : ''}${
            drag.dropTarget === id ? ' drop-into' : ''
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={renaming !== id}
          onClick={(e) => {
            e.stopPropagation()
            uiSelectEntity(id, e.shiftKey, e.ctrlKey || e.metaKey)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            setRenaming(id)
          }}
          onContextMenu={(e) => onContext(e, id)}
          onDragStart={(e) => {
            e.stopPropagation()
            // an unselected drag acts on just this row
            if (!selected.has(id)) uiSelectEntity(id, false, false)
            drag.begin(id)
          }}
          onDragEnd={() => drag.end()}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            drag.over(id)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            drag.drop(id)
          }}
        >
          <span
            className="twisty"
            data-tip="Expand / collapse"
            onClick={(e) => {
              e.stopPropagation()
              if (children.length > 0) {
                toggleEntity(id)
              }
            }}
          >
            {children.length > 0 ? (expanded ? '▾' : '▸') : ''}
          </span>
          {renaming === id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={name ?? ''}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') setRenaming(null)
              }}
              onBlur={(e) => commitRename(e.target.value)}
            />
          ) : (
            <span className="label">
              {name ?? entityLabel(id)}
              {name === undefined && <span className="dim">#{id}</span>}
              {children.length > 0 && <span className="dim">{children.length}</span>}
            </span>
          )}
        </div>
      )}
      {expanded &&
        children.map((c) => (
          <EntityRow
            key={c}
            id={c}
            depth={depth + 1}
            forest={forest}
            matches={matches}
            renaming={renaming}
            setRenaming={setRenaming}
            drag={drag}
            onContext={onContext}
          />
        ))}
    </>
  )
}
