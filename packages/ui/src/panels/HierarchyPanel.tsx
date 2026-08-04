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
} from '@scene/state'
import {
  consumeRenameRequest,
  revealSeq,
  revealTarget,
  expandToReveal,
  SHELF_STATIC,
  SHELF_CODE,
  SHELF_ENGINE,
  SHELF_UNKNOWN
} from './reveal'
import { describeEntity } from '@scene/entity-kind'
import { hierarchyModel, type HierarchyModel } from './hierarchy-model'
import { hierarchySearch, type HierarchySearch } from './hierarchy-search'
import { authoredFromComposite, loadAuthoredIds, subscribeAuthored } from './authored-ids'
import { entityName, NAME_COMPONENT } from '@scene/custom-components'
import { childCount } from '@scene/inspector'
import { outOfBoundsSet } from '@scene/out-of-bounds'
import { uiSetComponentValue, uiSetEntityFlag } from '../actions/components'
import { uiAddEntity, uiClearParent, uiDeleteEntity, uiDeleteEntityRecursive, uiDeleteEntityReparent, uiDuplicateEntity, uiReparentEntities, uiReparentToActive } from '../actions/entities'
import { uiClearSelection, uiFocusEntity, uiSelectEntity } from '../actions/selection'
import { useStore } from '../core/store'
import { IconPlus, IconImport, IconTrash, IconCamera, IconEdit, IconEye, IconEyeOff, IconLock, IconUnlock, IconPrefab, IconWarn, IconBot, IconGear } from '../icons'
import { canAskAssistant, prefillAssistant } from './ai-store'
import { LeftTabs, type LeftView } from './left-view'
import { sceneEmptiness } from './empty-scene'
import { PrefabMark, PrefabUpdateBadge } from './prefab-widgets'
import { prefabAssetId } from '../prefabs/provenance'
import { isMod } from '../lib/keys'
import { SceneSettingsModal } from '../features/scene-settings/SceneSettingsModal'
import { Button, Chip, ContextMenu, IconButton, Shelf } from '../ds'

const Chevron = (): JSX.Element => (
  <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4 2.5L8.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// The matched run of a label, marked so a hit reads at a glance in a tree that
// still shows its ancestors as context.
function Highlight(props: { text: string; query: string }): JSX.Element {
  const needle = props.query.toLowerCase()
  if (needle === '') return <>{props.text}</>
  const haystack = props.text.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    if (at > cursor) parts.push(props.text.slice(cursor, at))
    parts.push(<mark key={at}>{props.text.slice(at, at + needle.length)}</mark>)
    cursor = at + needle.length
    at = haystack.indexOf(needle, cursor)
  }
  parts.push(props.text.slice(cursor))
  return <>{parts}</>
}

type CtxMenu = { x: number; y: number; id: string }

type RenameTarget = { id: string; preselect: boolean }

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
// The shelf ids and their open/closed defaults live in reveal.ts, which also has
// to reason about them.
function ProvenanceShelf(props: {
  id: string
  title: string
  count: number
  note?: string
  /** Engine rows are chrome, not content — they start closed. */
  startClosed?: boolean
  /** a search hit lives in here: a closed shelf would hide it */
  forceOpen: boolean
  children: ReactNode
}): JSX.Element {
  const expanded = useStore(() => state.expandedEntities)
  // Content shelves store CLOSED-ness (they default open); a startClosed shelf
  // stores OPEN-ness, so both defaults work off the same empty set.
  const stored = props.startClosed === true ? expanded.has(props.id) : !expanded.has(props.id)
  const open = props.forceOpen || stored
  return (
    <Shelf
      title={props.title}
      count={props.count}
      note={props.note}
      open={open}
      onToggle={() => toggleEntity(props.id)}
    >
      {props.children}
    </Shelf>
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
  const emptyScene = useStore(sceneEmptiness)
  const forest = model.forest
  const [filter, setFilter] = useState('')
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  // scene.json settings, reached from the gear in the panel head. Desktop-only:
  // needs the project dir from the host URL.
  const [sceneSettings, setSceneSettings] = useState(false)
  const projectDir = new URLSearchParams(window.location.search).get('project')
  const sceneSettingsAvailable = projectDir !== null && window.editorShell?.sceneSettings !== undefined
  // Reveal: expand first (the row may be collapsed or in a closed shelf, so it
  // is not in the DOM yet), then scroll one render later once it has mounted.
  // 'center', not 'nearest': nearest parks the row half-hidden under the sticky
  // shelf header.
  const revealAt = useStore(revealSeq)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = revealTarget()
    const rename = consumeRenameRequest()
    if (id === null || !(id in snapshot)) return
    expandToReveal(model, snapshot, id)
    if (rename) setRenaming({ id, preselect: true })
    const t = setTimeout(() => {
      bodyRef.current?.querySelector(`#${CSS.escape(rowElementId(id))}`)?.scrollIntoView({ block: 'center' })
    }, 0)
    return () => clearTimeout(t)
  }, [revealAt])
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

  const search = hierarchySearch(filter, snapshot, model)

  // Only split when there is something to split: a lone "In your scene" header
  // over every row is chrome that tells the creator nothing.
  const split = baseline !== null && model.counts.code > 0
  // capture strips runtime entities (authoredOnly, prefabs/capture.ts), so an
  // all-code selection would otherwise save a silently empty prefab
  const savable = [...selected].some((id) => !model.isCode(id))
  // Nothing of the creator's in the scene yet: the tree has no rows to show and
  // no gesture to suggest, so it points at the one place that has something.
  // Through the shared signal, so it waits for provenance instead of flashing a
  // CTA over a scene whose baseline hasn't landed.
  const nothingAuthored = emptyScene === true

  const rows = (ids: string[]): ReactNode =>
    ids.map((id) => (
      <EntityRow
        key={id}
        id={id}
        depth={0}
        model={model}
        search={search}
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
        {sceneSettingsAvailable && (
          <>
            <IconButton
              tip="Scene settings — name, thumbnail, parcels, spawn points…"
              onClick={() => setSceneSettings(true)}
            >
              <IconGear />
            </IconButton>
            <span className="eui-head-sep" />
          </>
        )}
        <div className="eui-head-actions">
          <button className="eui-btn icon" data-tip="Browse assets" onClick={() => props.onView('assets')}>
            <IconImport />
          </button>
          <IconButton
            disabled={!savable}
            tip={
              savable
                ? 'Save the selection as a prefab'
                : selected.size === 0
                  ? 'Select entities to save them as a prefab'
                  : 'Only entities from your scene can be saved as a prefab — these are made by your code.'
            }
            onClick={props.onCreatePrefab}
          >
            <IconPrefab />
          </IconButton>
          <button className="eui-btn icon" data-tip="New entity" onClick={props.onNewEntity}>
            <IconPlus />
          </button>
        </div>
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
        // No TOP padding: a sticky header sticks to the scrollport edge, but the
        // padding band above it still scrolls its rows through — which read as a
        // strip of half-entities floating above "Made by your code".
        style={{ padding: '0 0 8px' }}
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
        {model.counts.engine > 0 && (
          <ProvenanceShelf
            id={SHELF_ENGINE}
            title="Engine"
            count={model.counts.engine}
            startClosed
            forceOpen={search.keptAny(model.engineRoots)}
          >
            {rows(model.engineRoots)}
          </ProvenanceShelf>
        )}
        {split ? (
          <ProvenanceShelf
            id={SHELF_STATIC}
            title="In your scene"
            count={model.counts.static}
            forceOpen={search.keptAny(model.staticRoots)}
          >
            {nothingAuthored ? <StartCta onView={props.onView} /> : rows(model.staticRoots)}
          </ProvenanceShelf>
        ) : nothingAuthored ? (
          <StartCta onView={props.onView} />
        ) : (
          rows(model.staticRoots)
        )}
        {split && (
          <ProvenanceShelf
            id={SHELF_CODE}
            title="Made by your code"
            count={model.counts.code}
            note="Your script builds these while the scene runs. You can look at them, select them and focus the camera — but changes here are not saved: the code puts it back on every restart."
            forceOpen={search.keptAny(model.codeRoots)}
          >
            {rows(model.codeRoots)}
          </ProvenanceShelf>
        )}
        {model.counts.unknown > 0 && (
          <ProvenanceShelf
            id={SHELF_UNKNOWN}
            title="Unknown"
            count={model.counts.unknown}
            note="Entities carrying nothing the editor can read — a position, and at most a component the scene defined itself. Usually anchors a script parents things to. Nothing to inspect or edit here, so they sit out of the way."
            startClosed
            forceOpen={search.keptAny(model.unknownRoots)}
          >
            {rows(model.unknownRoots)}
          </ProvenanceShelf>
        )}
        {forest.roots.length === 0 && !nothingAuthored && (
          <div className="eui-empty">
            {status === 'ready' ? 'Nothing here yet — create an entity with +' : sceneTitle()}
          </div>
        )}
      </div>
      {ctx !== null && (
        <EntityContextMenu
          ctx={ctx}
          isCode={model.isCode(ctx.id)}
          onClose={() => setCtx(null)}
          onRename={(id) => setRenaming({ id, preselect: false })}
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

function StartCta(props: { onView: (v: LeftView) => void }): JSX.Element {
  return (
    <div className="eui-empty">
      <p className="eui-empty-line">Nothing of yours in the scene yet.</p>
      <Button variant="primary" onClick={() => props.onView('prefabs')}>
        Start with a ready-made prefab
      </Button>
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

function EntityContextMenu(props: {
  ctx: CtxMenu
  isCode: boolean
  onClose: () => void
  onRename: (id: string) => void
  onCreatePrefab: () => void
}): JSX.Element {
  const { ctx, isCode, onClose, onRename } = props
  const snapshot = useStore(() => state.snapshot)
  const selected = useStore(() => state.selected)
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
    <ContextMenu x={ctx.x} y={ctx.y} onClose={onClose}>
      <button className="eui-menu-item" onClick={act(() => uiFocusEntity(id))}>
        <IconCamera /> Focus camera
      </button>
      <button className="eui-menu-item" onClick={act(() => onRename(id))}>
        <IconEdit /> Rename
      </button>
      {canAskAssistant() && (
        <button className="eui-menu-item" onClick={act(() => prefillAssistant('Make this '))}>
          <IconBot /> Ask AI about this…
        </button>
      )}
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
    </ContextMenu>
  )
}

// Code entities parented to an authored entity stay nested under it, in an inline
// bucket. seat.ts parents a marker dot to every authored Sit Spot, so exiling them
// to the bottom shelf would misdescribe the scene graph.
function CodeBucket(props: {
  parent: string
  ids: string[]
  depth: number
  forceOpen: boolean
  render: (id: string, depth: number) => ReactNode
}): JSX.Element {
  const expanded = useStore(() => state.expandedEntities)
  const key = `code:${props.parent}`
  const open = props.forceOpen || expanded.has(key)
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

function RenameInput(props: {
  value: string
  preselect: boolean
  onCommit: (value: string) => void
  onCancel: () => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    el.focus()
    if (props.preselect) el.select()
  }, [props.preselect])
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={props.value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onCommit((e.target as HTMLInputElement).value)
        if (e.key === 'Escape') props.onCancel()
      }}
      onBlur={(e) => props.onCommit(e.target.value)}
    />
  )
}

function EntityRow(props: {
  id: string
  depth: number
  model: HierarchyModel
  search: HierarchySearch
  renaming: RenameTarget | null
  setRenaming: (target: RenameTarget | null) => void
  drag: DragHandlers
  onContext: (e: React.MouseEvent, id: string) => void
}): JSX.Element | null {
  const { id, depth, model, search, renaming, setRenaming, drag, onContext } = props
  const forest = model.forest
  const expandedEntities = useStore(() => state.expandedEntities)
  const selected = useStore(() => state.selected)
  const snapshot = useStore(() => state.snapshot)
  const children = forest.children.get(id) ?? []
  const name = entityName(snapshot as Snapshot, id)
  const visible = search.keep(id)
  const assetId = prefabAssetId(snapshot[id])
  const isPrefab = assetId !== null
  // memoised on the snapshot, so this is one lookup per row, not a recompute
  const outOfBounds = outOfBoundsSet(snapshot as Snapshot, state.scene?.parcels)
  const codeKids = model.codeChildren.get(id) ?? []
  const isCode = model.isCode(id)
  const kind = describeEntity(snapshot as Snapshot, id, children.length + codeKids.length > 0)
  const isRenaming = renaming?.id === id
  // While searching the tree opens itself down to the hits; the stored open/closed
  // state is left untouched, so clearing the search restores the creator's tree.
  const expanded =
    search.query === ''
      ? expandedEntities.has(id)
      : search.keptAny(children) || search.keptAny(codeKids)

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
          draggable={!isRenaming && !isCode}
          onClick={(e) => {
            e.stopPropagation()
            uiSelectEntity(id, e.shiftKey, isMod(e))
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
          {isRenaming ? (
            <RenameInput
              value={name ?? ''}
              preselect={renaming?.preselect === true}
              onCommit={commitRename}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <>
              <span className="label">
                {isPrefab && <PrefabMark />}
                <span className={kind.derived ? 'kind' : undefined}>
                  <Highlight text={kind.primary} query={search.hit(id) ? search.query : ''} />
                </span>
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
            search={search}
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
          forceOpen={search.keptAny(codeKids)}
          render={(cid, d) => (
            <EntityRow
              key={cid}
              id={cid}
              depth={d}
              model={model}
              search={search}
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
