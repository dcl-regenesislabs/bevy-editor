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
  isRuntimeEntity,
  provenanceBaseline,
  isUiEntity,
  RUNTIME_ENTITY_TIP,
  OUT_OF_BOUNDS_TIP,
  type Snapshot
} from '../../../scene/src/state'
import { entityName, NAME_COMPONENT } from '../../../scene/src/custom-components'
import { childCount } from '../../../scene/src/inspector'
import { outOfBoundsSet } from '../../../scene/src/out-of-bounds'
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
  uiClearParent,
  uiSetEntityFlag
} from '../actions'
import { useStore } from '../store'
import { IconPlus, IconImport, IconTrash, IconCamera, IconEdit, IconEye, IconEyeOff, IconLock, IconUnlock, IconPrefab } from '../icons'
import { LeftTabs, type LeftView } from './AssetsPanel'
import { PrefabMark } from './Prefabs'
import { prefabAssetId } from '../prefabs/provenance'
import { SceneSettingsModal } from '../features/scene-settings/SceneSettingsModal'

// While editing (paused) only authored entities — those with a Name — are shown;
// runtime entities reappear when the scene is running or via the show-all toggle.
function namedForest(snapshot: typeof state.snapshot): Forest {
  const named = Object.keys(snapshot).filter(
    (id) =>
      snapshot[id]?.[NAME_COMPONENT] !== undefined &&
      id !== '0' &&
      // the scene's UI is entities too, but they aren't scene content — they have
      // no place in the world and only crowd out what is
      !isUiEntity(snapshot as Snapshot, id)
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

// SDK7 reserves the first block of entity ids for the engine and the player
// (camera, avatar, the scene root). Those are always "not in the baseline" too,
// but they aren't the creator's code — listing them would be noise.
const RESERVED_ENTITIES = 512

// Entities the scene's own code created. They have no Name, so namedForest drops
// them and they're invisible in the default tree — reachable only by clicking
// them in the viewport. Returns [] until the provenance baseline has loaded, so
// the tree doesn't reshuffle a beat after boot.
function codeSpawned(snapshot: typeof state.snapshot, baseline: Snapshot | null): string[] {
  if (baseline === null) return []
  // isUiEntity only inspects an entity's OWN components, so a UI node whose
  // UiTransform hasn't synced yet — or any child under a UI root — reads as
  // world content. Walk up: anything under the scene's UI is UI.
  const underUi = (id: string): boolean => {
    let cur: string | null = id
    for (let hops = 0; cur !== null && hops < 64; hops++) {
      if (isUiEntity(snapshot as Snapshot, cur)) return true
      cur = parentOf(snapshot, cur)
    }
    return false
  }
  return Object.keys(snapshot)
    .filter((id) => {
      const n = Number(id)
      if (!Number.isFinite(n) || n < RESERVED_ENTITIES) return false
      if (!isRuntimeEntity(id, baseline)) return false
      // nothing to select or inspect — an id with no components is not a thing
      // the creator made, it's bookkeeping
      if (Object.keys(snapshot[id] ?? {}).length === 0) return false
      return !underUi(id)
    })
    .sort((a, b) => Number(a) - Number(b))
}

const Chevron = (): JSX.Element => (
  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

function CodeGroup(props: { ids: string[] }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const selected = useStore(() => state.selected)
  if (props.ids.length === 0) return null
  return (
    <div className="eui-codegroup">
      <button className="eui-codegroup-head" onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? 'open' : ''}`}>
          <Chevron />
        </span>
        From code ({props.ids.length})
      </button>
      {open &&
        props.ids.map((id) => (
          <button
            key={id}
            className={`eui-codegroup-row ${selected.has(id) ? 'sel' : ''}`}
            onClick={() => uiSelectEntity(id, false, false)}
            onDoubleClick={() => uiFocusEntity(id)}
          >
            {entityLabel(id)}
            <span className="badge">code</span>
          </button>
        ))}
    </div>
  )
}

type CtxMenu = { x: number; y: number; id: string }

type DragHandlers = {
  dropTarget: string | null
  begin: (id: string) => void
  over: (id: string) => void
  end: () => void
  drop: (targetId: string) => void
}

// Lock / hide toggles. Shown only when set (or on row hover, via CSS) so the tree
// stays quiet — but always reachable, because honouring an imported project's
// flags is only safe if they can also be cleared.
function EntityFlags(props: { id: string }): JSX.Element {
  const snapshot = useStore(() => state.snapshot)
  const flag = (name: string): boolean =>
    (snapshot[props.id]?.[name] as { value?: boolean } | undefined)?.value === true
  const locked = flag('inspector::Lock')
  const hiddenFlag = flag('inspector::Hide')
  return (
    <span className="row-flags">
      <button
        className={`flag ${hiddenFlag ? 'on' : ''}`}
        data-tip={hiddenFlag ? 'Show in the editor' : 'Hide in the editor'}
        onClick={(e) => {
          e.stopPropagation()
          void uiSetEntityFlag(props.id, 'inspector::Hide', !hiddenFlag)
        }}
      >
        {hiddenFlag ? <IconEyeOff /> : <IconEye />}
      </button>
      <button
        className={`flag ${locked ? 'on' : ''}`}
        data-tip={locked ? 'Unlock — allow selecting and moving' : 'Lock — stop it being selected or moved'}
        onClick={(e) => {
          e.stopPropagation()
          void uiSetEntityFlag(props.id, 'inspector::Lock', !locked)
        }}
      >
        {locked ? <IconLock /> : <IconUnlock />}
      </button>
    </span>
  )
}

export function HierarchyPanel(props: {
  showAll: boolean
  width?: number
  onNewEntity: () => void
  onCreatePrefab: () => void
  onView: (v: LeftView) => void
}): JSX.Element {
  const snapshotState = useStore(() => state.snapshot)
  const status = useStore(() => state.status)
  const selected = useStore(() => state.selected)
  // only authored (Name-carrying) entities, running or paused — runtime
  // entities appear solely via the explicit show-all toggle
  const showAll = props.showAll
  const snapshot = snapshotState as Snapshot
  const forest = showAll ? buildForest(snapshot) : namedForest(snapshot)
  const [filter, setFilter] = useState('')
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // the scene itself, pinned above its entities — the discoverable path to
  // scene.json settings. Desktop-only: needs the project dir from the host URL.
  const [sceneSettings, setSceneSettings] = useState(false)
  const projectDir = new URLSearchParams(window.location.search).get('project')
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
        {selected.size > 0 && (
          <button
            className="eui-btn icon"
            data-tip="Save the selection as a prefab"
            onClick={props.onCreatePrefab}
          >
            <IconPrefab />
          </button>
        )}
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
        {projectDir !== null && window.editorShell?.sceneSettings !== undefined && (
          <button
            className="eui-scene-row"
            data-tip="Name, thumbnail, parcels, spawn points…"
            onClick={(e) => {
              e.stopPropagation() // the body click would clear the selection
              setSceneSettings(true)
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            {sceneTitle()}
            <span className="sub">Scene settings</span>
          </button>
        )}
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
        {!showAll && <CodeGroup ids={codeSpawned(snapshot, provenanceBaseline())} />}
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
          onCreatePrefab={props.onCreatePrefab}
        />
      )}
      {sceneSettings && projectDir !== null && (
        <SceneSettingsModal
          dir={projectDir}
          onClose={() => setSceneSettings(false)}
          // parcels/base/spawn feed the engine's launch — relaunch to reflect them
          onSaved={(layoutChanged) => {
            if (layoutChanged) void window.editorShell?.openProject(projectDir)
          }}
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
  onCreatePrefab: () => void
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
      <button className="eui-menu-item" onClick={act(props.onCreatePrefab)}>
        <IconPrefab /> Create prefab…
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
  const isPrefab = prefabAssetId(snapshot[id]) !== null
  // memoised on the snapshot, so this is one lookup per row, not a recompute
  const outOfBounds = outOfBoundsSet(snapshot as Snapshot, state.scene?.parcels)

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
          }${isPrefab ? ' eui-prefab-row' : ''}`}
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
          {Array.from({ length: depth }, (_, i) => (
            <span key={i} className="ind" />
          ))}
          <span
            className={`twisty ${expanded ? 'open' : ''}`}
            data-tip="Expand / collapse"
            onClick={(e) => {
              e.stopPropagation()
              if (children.length > 0) {
                toggleEntity(id)
              }
            }}
          >
            {children.length > 0 && <Chevron />}
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
              {isPrefab && <PrefabMark />}
              {name ?? entityLabel(id)}
              {name === undefined && <span className="dim">#{id}</span>}
              {isRuntimeEntity(id, provenanceBaseline()) && (
                <span className="dim code" data-tip={RUNTIME_ENTITY_TIP}>
                  code
                </span>
              )}
              {outOfBounds.has(id) && (
                <span className="dim oob" data-tip={OUT_OF_BOUNDS_TIP}>
                  outside
                </span>
              )}
              {children.length > 0 && <span className="dim">{children.length}</span>}
            </span>
          )}
          <EntityFlags id={id} />
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
