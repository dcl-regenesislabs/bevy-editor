import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  state,
  toggleEntity,
  expandEntity,
  topLevelSelected,
  componentKey,
  type Forest,
  provenanceBaseline,
  rowElementId,
  OUT_OF_BOUNDS_TIP,
  type Snapshot
} from '../../../scene/src/state'
import { describeEntity } from '../../../scene/src/entity-kind'
import { hierarchyModel, type HierarchyModel } from './hierarchy-model'
import { authoredFromComposite, loadAuthoredIds, subscribeAuthored } from './authored-ids'
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
import { IconPlus, IconImport, IconTrash, IconCamera, IconEdit, IconEye, IconEyeOff, IconLock, IconUnlock, IconPrefab, IconWarn } from '../icons'
import { LeftTabs, type LeftView } from './AssetsPanel'
import { PrefabMark, PrefabUpdateBadge } from './Prefabs'
import { prefabAssetId } from '../prefabs/provenance'
import { SceneSettingsModal } from '../features/scene-settings/SceneSettingsModal'
import { Chip } from '../ds'

const Chevron = (): JSX.Element => (
  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

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

// A labelled provenance shelf. The header is what earns the right to delete the
// per-row "code" chip: a marker true of every row in a labelled container carries
// no information. Sticky, because a header that scrolls away silently revokes it.
// Shelves are open by default, so the key stores CLOSED-ness — state.expandedEntities
// starts empty and a default-closed shelf would hide the panel's whole point.
const SHELF_STATIC = 'shelf-closed:static'
const SHELF_CODE = 'shelf-closed:code'
const SHELF_ENGINE = 'shelf-open:engine'

function Shelf(props: {
  id: string
  title: string
  count: number
  note?: string
  /** Engine rows are chrome, not content — they start closed. */
  startClosed?: boolean
  children: ReactNode
}): JSX.Element {
  const expanded = useStore(() => state.expandedEntities)
  // Content shelves store CLOSED-ness (they default open); a startClosed shelf
  // stores OPEN-ness, so both defaults work off the same empty set.
  const open = props.startClosed === true ? expanded.has(props.id) : !expanded.has(props.id)
  return (
    <div className="eui-shelf">
      <button className="eui-shelf-head" onClick={() => toggleEntity(props.id)}>
        <span className={`caret ${open ? 'open' : ''}`}>
          <Chevron />
        </span>
        <span className="t">{props.title}</span>
        <span className="n">{props.count}</span>
      </button>
      {open && props.note !== undefined && <p className="eui-shelf-note">{props.note}</p>}
      {open && props.children}
    </div>
  )
}

export function HierarchyPanel(props: {
  width?: number
  onNewEntity: () => void
  onCreatePrefab: () => void
  onView: (v: LeftView) => void
}): JSX.Element {
  const snapshotState = useStore(() => state.snapshot)
  const status = useStore(() => state.status)
  const selected = useStore(() => state.selected)
  // Must go through a selector: the baseline now drives layout, and reading it
  // bare left the panel stale whenever /crdt_initial resolved after the snapshot.
  const baseline = useStore(() => provenanceBaseline())
  const snapshot = snapshotState as Snapshot
  // Ground truth for "authored": the project's main.composite, read from disk.
  const projectDirParam = new URLSearchParams(window.location.search).get('project')
  const fromComposite = useSyncExternalStore(subscribeAuthored, authoredFromComposite)
  useEffect(() => loadAuthoredIds(projectDirParam), [projectDirParam])
  const model = hierarchyModel(snapshot, baseline, true, fromComposite)
  const forest = model.forest
  const [filter, setFilter] = useState('')
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // the scene itself, pinned above its entities — the discoverable path to
  // scene.json settings. Desktop-only: needs the project dir from the host URL.
  const [sceneSettings, setSceneSettings] = useState(false)
  const projectDir = new URLSearchParams(window.location.search).get('project')
  // Reveal: selecting in the viewport writes state.jumpTarget (state.ts:547) and
  // until now nothing in the DOM consumed it. Two shelves plus newly-visible
  // unnamed rows make the list longer, so scrolling to the row matters more.
  const jumpTarget = useStore(() => state.jumpTarget)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof jumpTarget !== 'string' || jumpTarget === '') return
    const el = bodyRef.current?.querySelector(`#${CSS.escape(jumpTarget)}`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [jumpTarget])
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

  // Search the label the row actually shows — since rows now display a derived
  // label ("Chairwood_02"), matching only on Name would make most rows unfindable.
  const matches = (id: string): boolean => {
    if (filter === '') return true
    const q = filter.toLowerCase()
    const name = entityName(snapshot, id)
    if (name !== undefined && name.toLowerCase().includes(q)) return true
    if (id.includes(filter)) return true
    const kind = describeEntity(snapshot, id, (forest.children.get(id) ?? []).length > 0)
    return kind.primary.toLowerCase().includes(q)
  }

  // Only split when there is something to split: a lone "In your scene" header
  // over every row is chrome that tells the creator nothing.
  const split = baseline !== null && model.counts.code > 0

  const rows = (ids: string[]): ReactNode =>
    ids.map((id) => (
      <EntityRow
        key={id}
        id={id}
        depth={0}
        model={model}
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
    ))

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
            // capture strips runtime entities (authoredOnly, prefabs/capture.ts), so
            // an all-code selection would otherwise save a silently empty prefab
            disabled={![...selected].some((id) => !model.isCode(id))}
            data-tip={
              [...selected].some((id) => !model.isCode(id))
                ? 'Save the selection as a prefab'
                : 'Only entities from your scene can be saved as a prefab — these are made by your code.'
            }
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
        ref={bodyRef}
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
        {model.counts.engine > 0 && (
          <Shelf id={SHELF_ENGINE} title="Engine" count={model.counts.engine} startClosed>
            {rows(model.engineRoots)}
          </Shelf>
        )}
        {split ? (
          <Shelf id={SHELF_STATIC} title="In your scene" count={model.counts.static}>
            {rows(model.staticRoots)}
          </Shelf>
        ) : (
          rows(model.staticRoots)
        )}
        {split && (
          <Shelf
            id={SHELF_CODE}
            title="Made by your code"
            count={model.counts.code}
            note="Your script builds these while the scene runs. You can look at them, select them and focus the camera — but changes here are not saved: the code puts it back on every restart."
          >
            {rows(model.codeRoots)}
          </Shelf>
        )}
        {forest.roots.length === 0 && (
          <div className="eui-empty">
            {status === 'ready' ? 'Nothing here yet — create an entity with +' : sceneTitle()}
          </div>
        )}
      </div>
      {ctx !== null && (
        <ContextMenu
          ctx={ctx}
          isCode={model.isCode(ctx.id)}
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
  isCode: boolean
  onClose: () => void
  onRename: (id: string) => void
  onCreatePrefab: () => void
}): JSX.Element {
  const { ctx, isCode, onClose, onRename } = props
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

  // Editing a code-spawned entity's VALUES is allowed — the inspector raises a card
  // offering to push the change into the code. What stays disabled is the structural
  // work that would write broken authored data: a child orphaned when its code-made
  // parent doesn't come back, a duplicate that coexists with the recreated original,
  // a prefab that captures nothing, and a delete the next run undoes.
  const tip = (why: string): string | undefined => (isCode ? why : undefined)
  const TIP_CHILD = "The parent is made by your code and won't exist on the next run — the child would be orphaned."
  const TIP_DUP = 'Your code recreates the original on every run, so the copy would end up alongside it.'
  const TIP_PREFAB = 'Prefabs only capture entities from your scene — these are made by your code.'
  const TIP_DELETE = 'Your code rebuilds it on every run, so deleting it here would not stick.'

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
      <button
        className="eui-menu-item"
        disabled={isCode}
        data-tip={tip(TIP_CHILD)}
        onClick={act(() => void uiAddEntity('Entity', Number(id)))}
      >
        <IconPlus /> New child entity
      </button>
      <button className="eui-menu-item" disabled={isCode} data-tip={tip(TIP_DUP)} onClick={act(() => void uiDuplicateEntity(id))}>
        <IconPlus /> Duplicate
      </button>
      <button className="eui-menu-item" disabled={isCode} data-tip={tip(TIP_PREFAB)} onClick={act(props.onCreatePrefab)}>
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
        <button className="eui-menu-item danger" disabled={isCode} data-tip={tip(TIP_DELETE)} onClick={act(() => void uiDeleteEntity(id))}>
          <IconTrash /> Delete
        </button>
      ) : (
        <>
          <button className="eui-menu-item danger" disabled={isCode} data-tip={tip(TIP_DELETE)} onClick={act(() => void uiDeleteEntityReparent(id))}>
            <IconTrash /> Delete, keep children
          </button>
          <button
            className="eui-menu-item danger"
            disabled={isCode}
            data-tip={tip(TIP_DELETE)}
            onClick={act(() => void uiDeleteEntityRecursive(id))}
          >
            <IconTrash /> Delete with {kids} child{kids === 1 ? '' : 'ren'}
          </button>
        </>
      )}
    </div>
  )
}

// Code entities parented to an authored entity stay nested under it, in an inline
// bucket. seat.ts parents a marker dot to every authored Sit Spot, so exiling them
// to the bottom shelf would misdescribe the scene graph.
function CodeBucket(props: { parent: string; ids: string[]; depth: number; render: (id: string, depth: number) => ReactNode }): JSX.Element {
  const expanded = useStore(() => state.expandedEntities)
  const key = `code:${props.parent}`
  const open = expanded.has(key)
  return (
    <>
      <div className="eui-row eui-bucket" style={{ paddingLeft: props.depth * 9 }} onClick={() => toggleEntity(key)}>
        <span className={`twisty ${open ? 'open' : ''}`}>
          <Chevron />
        </span>
        <span className="label">From your code ({props.ids.length})</span>
      </div>
      {open && props.ids.map((id) => props.render(id, props.depth + 1))}
    </>
  )
}

function EntityRow(props: {
  id: string
  depth: number
  model: HierarchyModel
  matches: (id: string) => boolean
  renaming: string | null
  setRenaming: (id: string | null) => void
  drag: DragHandlers
  onContext: (e: React.MouseEvent, id: string) => void
}): JSX.Element | null {
  const { id, depth, model, matches, renaming, setRenaming, drag, onContext } = props
  const forest = model.forest
  const expandedEntities = useStore(() => state.expandedEntities)
  const selected = useStore(() => state.selected)
  const snapshot = useStore(() => state.snapshot)
  const children = forest.children.get(id) ?? []
  const expanded = expandedEntities.has(id)
  const name = entityName(snapshot as Snapshot, id)
  const visible = matches(id)
  const assetId = prefabAssetId(snapshot[id])
  const isPrefab = assetId !== null
  // memoised on the snapshot, so this is one lookup per row, not a recompute
  const outOfBounds = outOfBoundsSet(snapshot as Snapshot, state.scene?.parcels)
  const codeKids = model.codeChildren.get(id) ?? []
  const isCode = model.isCode(id)
  const kind = describeEntity(snapshot as Snapshot, id, children.length + codeKids.length > 0)

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
          id={rowElementId(id)}
          className={`eui-row ${selected.has(id) ? 'selected' : ''}${
            drag.dropTarget === id ? ' drop-into' : ''
          }${isPrefab ? ' eui-prefab-row' : ''}${isCode ? ' code' : ''}`}
          draggable={renaming !== id && !isCode}
          onClick={(e) => {
            e.stopPropagation()
            uiSelectEntity(id, e.shiftKey, e.ctrlKey || e.metaKey)
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            // one gesture for every row: focus. Double-click used to open an inline
            // rename on authored rows, which auto-submitted on the next blur and so
            // renamed things by accident. Rename lives in the context menu.
            uiFocusEntity(id)
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
              if (children.length + codeKids.length > 0) {
                toggleEntity(id)
              }
            }}
          >
            {children.length + codeKids.length > 0 && <Chevron />}
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
            <>
              <span className="label">
                {isPrefab && <PrefabMark />}
                <span className={kind.derived ? 'kind' : undefined}>{kind.primary}</span>
                {kind.detail !== null && kind.detail !== 'ui' && <span className="detail">{kind.detail}</span>}
              </span>
              <span className="row-marks">
                {kind.detail === 'ui' && <Chip size="xs" tone="info">UI</Chip>}
                {assetId !== null && <PrefabUpdateBadge assetId={assetId} label="update" />}
                {outOfBounds.has(id) && !model.isEngine(id) ? (
                  <Chip size="xs" tone="danger" icon={<IconWarn />} tip={OUT_OF_BOUNDS_TIP}>
                    outside
                  </Chip>
                ) : (
                  !expanded &&
                  children.length + codeKids.length > 0 && (
                    <span className="count">{children.length + codeKids.length}</span>
                  )
                )}
              </span>
            </>
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
            model={model}
            matches={matches}
            renaming={renaming}
            setRenaming={setRenaming}
            drag={drag}
            onContext={onContext}
          />
        ))}
      {expanded && codeKids.length > 0 && (
        <CodeBucket
          parent={id}
          ids={codeKids}
          depth={depth + 1}
          render={(cid, d) => (
            <EntityRow
              key={cid}
              id={cid}
              depth={d}
              model={model}
              matches={matches}
              renaming={renaming}
              setRenaming={setRenaming}
              drag={drag}
              onContext={onContext}
            />
          )}
        />
      )}
    </>
  )
}
