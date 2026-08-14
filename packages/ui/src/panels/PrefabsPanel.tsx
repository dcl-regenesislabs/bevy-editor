import { useEffect, useMemo, useRef, useState } from 'react'
import { state } from '@scene/state'
import { uiDeleteLibraryPrefab, uiDeletePrefab, uiPlaceLibraryPrefab, uiPlacePrefab, uiRenamePrefab, uiSavePrefabToLibrary } from '../actions/prefabs'
import { useStore } from '../core/store'
import { Button, ContextMenu, ControlButton, IconButton, LinkButton, Modal, Notice, SearchField, Shelf } from '../ds'
import { IconDots, IconEdit, IconExport, IconGear, IconImport, IconPlus, IconPrefab, IconRefresh, IconTrash } from '../icons'
import { LeftTabs, type LeftView } from './left-view'
import { sceneEmptiness } from './empty-scene'
import { SearchEmpty } from './SearchEmpty'
import { countCatalogMatches, matchHint, prefabMatches } from './search-hints'
import { originDetail, originLabel, originTip, scopeOrigin } from '../prefabs/provenance'
import { libraryAvailable } from '../prefabs/library'
import { unusedBuiltinCopies } from '../prefabs/unused'
import { consumerStore, ensureConsumersLoaded, refreshConsumers, sceneLayouts } from '../prefabs/consumers'
import {
  modesFromCalls,
  scanSpawnCalls,
  summariesFromModes,
  type GuaranteeChip
} from '../prefabs/guarantees'
import { instancesOf, sceneInstances, type PlacementInstance } from '../prefabs/placement'
import { NO_PREFABS_YET } from '../prefabs/copy'
import { createdDetail, createdHead } from './prefab-created'
import { INERT_COMPONENT, type PrefabData } from '../prefabs/format'
import type { OutdatedPrefab } from '../prefabs/outdated'
import { PrefabImportDialog } from './PrefabImportDialog'
import { PrefabUpdateDialog } from './PrefabUpdateDialog'
import { PrefabRuntimeChips, UpdateChip } from './prefab-widgets'
import { SdkGateDialog } from './SdkGateDialog'
import {
  beginPrefabDrag,
  clearCreated,
  clearLibraryReveal,
  clearPrefabReveal,
  endPrefabDrag,
  ensurePrefabsLoaded,
  groupPrefabCards,
  prefabStore,
  refreshLibrary,
  refreshPrefabs,
  revealPrefab,
  type PrefabEntry,
  type PrefabSource
} from './prefab-store'
import css from './prefabs.css?inline'
import { registerCss } from '../ds/styles/registry'

registerCss('panels/prefabs', 'features', css)

const REVEAL_MS = 3400
const CREATED_MS = 15000

interface PrefabCardModel {
  source: PrefabSource
  id: string
  data: PrefabData
  thumbnail?: string
}

type Scope = 'all' | PrefabSource

const SOURCES: PrefabSource[] = ['project', 'user', 'builtin']

// Section headers name the PLACE a prefab lives, in full.
const SCOPE_LABEL: Record<Scope, string> = {
  all: 'All',
  project: 'This project',
  user: 'My library',
  builtin: 'Built-in'
}

// An empty scene leads with the built-ins: nothing else in the panel can be
// placed yet, and the fastest way to a scene that does something is a prefab
// that already works.
const EMPTY_SCENE_SECTIONS: PrefabSource[] = ['builtin', 'project', 'user']

type CardMenu = { x: number; y: number; card: PrefabCardModel }

export function PrefabsPanel(props: {
  width?: number
  onView: (v: LeftView) => void
  onCreatePrefab: () => void
}): JSX.Element {
  return (
    <div className="eui-panel eui-left" style={{ width: props.width }}>
      <LeftTabs view="prefabs" onView={props.onView} />
      <PrefabsTab onCreatePrefab={props.onCreatePrefab} onView={props.onView} />
    </div>
  )
}

function PrefabsTab(props: { onCreatePrefab: () => void; onView: (v: LeftView) => void }): JSX.Element {
  const items = useStore(() => prefabStore.items)
  const library = useStore(() => prefabStore.library)
  const loading = useStore(() => prefabStore.loading)
  const loaded = useStore(() => prefabStore.loaded)
  const error = useStore(() => prefabStore.error)
  const libraryError = useStore(() => prefabStore.libraryError)
  const busy = useStore(() => state.assetBusy)
  const outdated = useStore(() => prefabStore.outdated)
  const reveal = useStore(() => prefabStore.reveal)
  const revealLibrary = useStore(() => prefabStore.revealLibrary)
  const created = useStore(() => prefabStore.created)
  const selected = useStore(() => state.selected)
  const [filter, setFilter] = useState('')
  const [menu, setMenu] = useState<CardMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PrefabCardModel | null>(null)
  const [updating, setUpdating] = useState<{ id: string; name: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [openBySection, setOpenBySection] = useState<Partial<Record<PrefabSource, string>>>({})
  const openGroup = (section: PrefabSource, name: string | undefined): void => {
    setOpenBySection((prev) => ({ ...prev, [section]: name }))
  }

  const hasLibrary = libraryAvailable()

  useEffect(ensurePrefabsLoaded, [])
  useEffect(() => {
    if (reveal === null) return
    const t = setTimeout(clearPrefabReveal, REVEAL_MS)
    return () => clearTimeout(t)
  }, [reveal])
  useEffect(() => {
    if (revealLibrary === null) return
    const target = prefabStore.library.find((p) => p.ref === revealLibrary)
    const groupName = target?.data.group
    if (target !== undefined && groupName !== undefined && groupName !== '') {
      openGroup(target.scope, groupName)
    }
    const t = setTimeout(clearLibraryReveal, REVEAL_MS)
    return () => clearTimeout(t)
  }, [revealLibrary])
  useEffect(() => {
    if (created === null) return
    const t = setTimeout(clearCreated, CREATED_MS)
    return () => clearTimeout(t)
  }, [created])


  const emptyScene = useStore(sceneEmptiness) === true
  const snapshot = useStore(() => state.snapshot)
  const scripts = useStore(() => consumerStore.scripts)
  useEffect(ensureConsumersLoaded, [])
  useEffect(() => {
    if (consumerStore.loaded) void refreshConsumers()
  }, [items])
  const calls = useMemo(() => scanSpawnCalls(scripts), [scripts])
  const layouts = useMemo(() => sceneLayouts(), [snapshot])
  const instances = useMemo(() => sceneInstances(snapshot), [snapshot])
  const guaranteesFor = (data: PrefabData): GuaranteeChip[] => {
    const placed = instancesOf(data, instances).some(
      (i) => snapshot[i.entityId]?.[INERT_COMPONENT] === undefined
    )
    return summariesFromModes(data, modesFromCalls(data, calls, layouts, scripts), !placed)
  }
  const unused = unusedBuiltinCopies(items, snapshot)
  const [doomed, setDoomed] = useState<Set<string> | null>(null)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    setDoomed(null)
    setDismissed(false)
  }, [unused.length])
  const reviewable = new Set(unused.map((i) => i.folder))
  const toggleDoom = (folder: string): void => {
    setDoomed((prev) => {
      if (prev === null) return prev
      const next = new Set(prev)
      if (!next.delete(folder)) next.add(folder)
      return next
    })
  }
  const removeDoomed = async (): Promise<void> => {
    const going = [...(doomed ?? [])]
    setDoomed(null)
    for (const folder of going) await uiDeletePrefab(folder)
  }
  const f = filter.toLowerCase()
  const cards: PrefabCardModel[] = [
    ...items.map((p) => ({
      source: 'project' as const,
      id: p.folder,
      data: p.data,
      thumbnail: p.thumbnail
    })),
    ...library.map((p) => ({ source: p.scope, id: p.ref, data: p.data, thumbnail: p.thumbnail }))
  ]
  const visible = cards.filter((c) => prefabMatches(c.data, c.id, f))
  const sections: PrefabSource[] = !hasLibrary
    ? ['project']
    : emptyScene
      ? EMPTY_SCENE_SECTIONS
      : SOURCES
  const shown = sections
  const menuCard =
    menu === null
      ? undefined
      : visible.find((c) => c.id === menu.card.id && c.source === menu.card.source)
  const updatingInfo = updating === null ? undefined : outdated.get(updating.id)

  const reload = (): void => {
    void refreshPrefabs()
    void refreshLibrary()
    void refreshConsumers()
  }

  return (
    <>
      <div className="eui-search" style={{ display: 'flex', gap: 6 }}>
        <SearchField size="sm" placeholder="Search prefabs…" value={filter} onChange={setFilter} />
        {hasLibrary && (
          <IconButton
            tip="Import a prefab from a folder, a .zip or GitHub"
            style={{ flex: 'none' }}
            onClick={() => setImporting(true)}
          >
            <IconImport />
          </IconButton>
        )}
        <IconButton tip="Reload prefabs" style={{ flex: 'none' }} onClick={reload}>
          <IconRefresh />
        </IconButton>
      </div>
      {(busy || (!loaded && loading)) && (
        <div className="eui-asset-count">{busy ? 'Working…' : 'Loading…'}</div>
      )}
      <div className="eui-panel-body">
        {emptyScene && f === '' && (
          <Notice tone="attention">Start with something that already works — drag it in.</Notice>
        )}
        {created !== null && (
          <Notice tone="attention" onDismiss={clearCreated} dismissTip="Got it">
            <div className="eui-prefab-created">
              <span>
                <strong>{created.name}</strong> {createdHead(created)}
              </span>
              <span>{createdDetail(created)}</span>
              <span className="path">{created.folder}</span>
            </div>
          </Notice>
        )}
        {error !== null && (
          <div className="eui-empty">
            {error}{' '}
            <button className="eui-link" onClick={() => void refreshPrefabs()}>
              Retry
            </button>
          </div>
        )}
        {libraryError !== null && (
          <div className="eui-empty">
            Your library could not be read: {libraryError}{' '}
            <button className="eui-link" onClick={() => void refreshLibrary()}>
              Retry
            </button>
          </div>
        )}
        {shown.map((section) => {
          const sectionCards = visible.filter((c) => c.source === section)
          const leadTile = section === 'project'
          if (sectionCards.length === 0 && !leadTile) return null
          const { groups, singles } = groupPrefabCards(sectionCards, f === '')
          const openName = openBySection[section]
          const openMembers = openName === undefined ? undefined : groups.get(openName)
          const label = SCOPE_LABEL[section]
          const cleanup = section === 'project' && unused.length > 0 && f === '' && (!dismissed || doomed !== null)
          const grid = (
            <div className="eui-asset-grid">
              {openMembers === undefined ? (
                <>
                  {leadTile && (
                    <button
                      className="eui-asset eui-asset-upload eui-prefab-new"
                      disabled={selected.size === 0}
                      data-tip={
                        selected.size === 0
                          ? 'Select entities in the scene, then create a prefab from them'
                          : 'Create a prefab from the selection'
                      }
                      onClick={props.onCreatePrefab}
                    >
                      <div className="glyph">+</div>
                      <span className="name">Create prefab</span>
                      <span className="pack">from selection</span>
                    </button>
                  )}
                  {[...groups].map(([name, members]) => (
                    <PrefabGroupTile
                      key={`group:${section}:${name}`}
                      name={name}
                      members={members}
                      onOpen={() => openGroup(section, name)}
                    />
                  ))}
                </>
              ) : (
                <button
                  className="eui-asset eui-prefab-back"
                  data-tip={`Back to all ${label.toLowerCase()} prefabs`}
                  onClick={() => openGroup(section, undefined)}
                >
                  <div className="glyph">←</div>
                  <span className="name">Back</span>
                  <span className="pack">{label}</span>
                </button>
              )}
              {(openMembers ?? singles).map((card) => (
                <PrefabCard
                  key={`${card.source}:${card.id}`}
                  card={card}
                  busy={busy}
                  revealed={card.source === 'project' ? reveal === card.id : revealLibrary === card.id}
                  renaming={renaming === card.id}
                  outdated={card.source === 'project' ? outdated.get(card.data.id) : undefined}
                  instances={instances}
                  guarantees={guaranteesFor(card.data)}
                  doomed={doomed?.has(card.id)}
                  onReview={
                    doomed !== null && reviewable.has(card.id) ? () => toggleDoom(card.id) : undefined
                  }
                  onUpdate={() => setUpdating({ id: card.data.id, name: card.data.name })}
                  onRenamed={() => setRenaming(null)}
                  onMenu={(e) => {
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const keyed = e.clientX === 0 && e.clientY === 0
                    setMenu({ x: keyed ? rect.left : e.clientX, y: keyed ? rect.bottom : e.clientY, card })
                  }}
                />
              ))}
            </div>
          )
          const body = (
            <>
              {cleanup && (
                <Notice
                  tone="attention"
                  onDismiss={doomed === null ? () => setDismissed(true) : undefined}
                  dismissTip="Hide this until the unused copies change"
                >
                  {doomed !== null ? (
                    <div className="eui-prefab-cleanup-row">
                      <span>
                        {doomed.size === 0
                          ? 'Nothing marked — click a card to mark it again.'
                          : `${doomed.size} marked in red. Click a card to keep it.`}
                      </span>
                      <span className="eui-prefab-cleanup-actions">
                        <LinkButton onClick={() => setDoomed(null)}>Cancel</LinkButton>
                        <LinkButton
                          tone="danger"
                          disabled={doomed.size === 0}
                          onClick={() => void removeDoomed()}
                        >
                          {doomed.size === 1 ? 'Remove copy' : `Remove ${doomed.size} copies`}
                        </LinkButton>
                      </span>
                    </div>
                  ) : (
                    <>
                      <strong>{unused.length}</strong>{' '}
                      {unused.length === 1
                        ? 'built-in copy isn’t used in this scene.'
                        : 'built-in copies aren’t used in this scene.'}{' '}
                      <LinkButton onClick={() => setDoomed(new Set(reviewable))}>Review</LinkButton>
                    </>
                  )}
                </Notice>
              )}
              {grid}
            </>
          )
          if (!hasLibrary) return <div key={section}>{body}</div>
          return (
            <Shelf
              key={section}
              title={openMembers === undefined ? label : `${label} › ${openName}`}
              count={sectionCards.length}
            >
              {body}
            </Shelf>
          )
        })}
        {loaded && cards.length === 0 && error === null && (
          <div className="eui-empty">
            <p className="eui-empty-line">{NO_PREFABS_YET}</p>
            <LinkButton onClick={() => props.onView('scene')}>Go to the Scene tab</LinkButton>
          </div>
        )}
        {loaded && cards.length > 0 && visible.length === 0 && (
          <SearchEmpty
            message="No prefabs match"
            query={filter}
            hints={matchHint(countCatalogMatches(f), 'Assets', () => props.onView('assets'))}
          />
        )}
      </div>
      {menu !== null && menuCard !== undefined && (
        <PrefabMenu
          x={menu.x}
          y={menu.y}
          card={menuCard}
          hasLibrary={hasLibrary}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(menuCard.id)}
          onDelete={() => setConfirmDelete(menuCard)}
        />
      )}
      {confirmDelete !== null &&
        (confirmDelete.source === 'project' ? (
          <DeletePrefabModal card={confirmDelete} onClose={() => setConfirmDelete(null)} />
        ) : (
          <RemoveFromLibraryModal card={confirmDelete} onClose={() => setConfirmDelete(null)} />
        ))}
      {importing && <PrefabImportDialog onClose={() => setImporting(false)} />}
      <SdkGateDialog />
      {updating !== null && updatingInfo !== undefined && (
        <PrefabUpdateDialog
          id={updating.id}
          name={updating.name}
          info={updatingInfo}
          onClose={() => setUpdating(null)}
        />
      )}
    </>
  )
}

// What the prefab IS beats how to place it: the placement hint is identical on
// every card, so it stops being read. Keep it only as the fallback.
function cardTip(card: PrefabCardModel): string {
  const copies = card.source === 'project' ? '' : ' · a copy is added to this scene'
  const menu = card.source === 'project' ? ' · ⋯ to rename or remove it' : ''
  const description = card.data.description
  const head =
    description === undefined
      ? `${card.data.name} — drag into the viewport or click to place it`
      : `${card.data.name} — ${description}`
  return `${head}${copies}${menu}`
}

function placePrefab(source: PrefabSource, id: string): void {
  if (source === 'project') void uiPlacePrefab(id)
  else void uiPlaceLibraryPrefab(id)
}

function CardArt(props: { thumbnail: string | undefined }): JSX.Element {
  if (props.thumbnail === undefined) {
    return (
      <div className="glyph">
        <IconPrefab />
      </div>
    )
  }
  return <img src={props.thumbnail} loading="lazy" draggable={false} />
}

function PrefabGroupTile(props: {
  name: string
  members: PrefabCardModel[]
  onOpen: () => void
}): JSX.Element {
  const { members } = props
  return (
    <button
      className="eui-asset eui-prefab-group"
      data-tip={`${members.length} items — click to browse`}
      onClick={props.onOpen}
    >
      <CardArt thumbnail={members.find((m) => m.thumbnail !== undefined)?.thumbnail} />
      <span className="name">{props.name}</span>
      <span className="pack">
        {members.length} item{members.length === 1 ? '' : 's'} ▸
      </span>
    </button>
  )
}

function PrefabCard(props: {
  card: PrefabCardModel
  busy: boolean
  revealed: boolean
  renaming: boolean
  outdated?: OutdatedPrefab
  /** every prefab instance in the scene, scanned once for the whole grid */
  instances: PlacementInstance[]
  /** derived from the code that opens this prefab's pool — never authored */
  guarantees: GuaranteeChip[]
  /** the running scene predates the last edit, so clones still come from the old bake */
  /** marked for removal in a cleanup review */
  doomed?: boolean
  /** while reviewing, a click spares or re-marks the card instead of placing it */
  onReview?: () => void
  onUpdate: () => void
  onRenamed: () => void
  onMenu: (e: React.MouseEvent) => void
}): JSX.Element {
  const { card, revealed, renaming } = props
  const ref = useRef<HTMLDivElement>(null)
  const origin = scopeOrigin(card.data.origin, card.source)
  const detail = originDetail(origin)

  useEffect(() => {
    if (revealed) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [revealed])

  const commit = (value: string): void => {
    props.onRenamed()
    const v = value.trim()
    if (v === '' || v === card.data.name) return
    void uiRenamePrefab(card.id, v)
  }

  const activate = (): void => {
    if (renaming) return
    if (props.onReview !== undefined) props.onReview()
    else placePrefab(card.source, card.id)
  }

  return (
    <div
      ref={ref}
      className={`eui-asset eui-prefab-card${revealed ? ' revealed' : ''}${props.busy ? ' busy' : ''}${props.doomed === true ? ' doomed' : ''}`}
      draggable={!renaming}
      data-tip={cardTip(card)}
      role="button"
      tabIndex={renaming ? -1 : 0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        activate()
      }}
      onContextMenu={props.onMenu}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', card.id)
        beginPrefabDrag({ source: card.source, id: card.id, name: card.data.name })
      }}
      onDragEnd={endPrefabDrag}
    >
      <CardArt thumbnail={card.thumbnail} />
      <ControlButton
        size="sm"
        className="eui-prefab-more"
        tip={card.source === 'project' ? 'Place, rename, delete' : 'Place, or remove from the library'}
        aria-label={`${card.data.name} menu`}
        onClick={(e) => {
          e.stopPropagation()
          props.onMenu(e)
        }}
      >
        <IconDots />
      </ControlButton>
      {props.outdated !== undefined && (
        <UpdateChip info={props.outdated} onClick={props.onUpdate} />
      )}
      {renaming ? (
        <input
          className="eui-prefab-rename"
          autoFocus
          defaultValue={card.data.name}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') props.onRenamed()
          }}
          onBlur={(e) => commit(e.target.value)}
        />
      ) : (
        <span className="name">{card.data.name}</span>
      )}
      <span className={`eui-prefab-badge ${origin?.source ?? 'user'}`} data-tip={originTip(origin)}>
        {originLabel(origin)}
      </span>
      <PrefabRuntimeChips
        data={card.data}
        instances={props.instances}
        guarantees={props.guarantees}
        inProject={card.source === 'project'}
      />
      {detail !== null && (
        <span className="eui-prefab-origin" data-tip={originTip(origin)}>
          {detail}
        </span>
      )}
    </div>
  )
}

function PrefabMenu(props: {
  x: number
  y: number
  card: PrefabCardModel
  hasLibrary: boolean
  onClose: () => void
  onRename: () => void
  onDelete: () => void
}): JSX.Element {
  const act = (fn: () => void): (() => void) => () => {
    fn()
    props.onClose()
  }
  const { card } = props
  return (
    <ContextMenu x={props.x} y={props.y} onClose={props.onClose}>
      <button className="eui-menu-item" onClick={act(() => placePrefab(card.source, card.id))}>
        <IconPlus /> Place in scene
      </button>
      {card.source === 'project' && (
        <>
          <button className="eui-menu-item" onClick={act(props.onRename)}>
            <IconEdit /> Rename
          </button>
          {props.hasLibrary && (
            <button className="eui-menu-item" onClick={act(() => void uiSavePrefabToLibrary(card.id))}>
              <IconExport /> Save to my library
            </button>
          )}
        </>
      )}
      {card.source !== 'builtin' && (
        <>
          <div className="eui-menu-sep" />
          <button className="eui-menu-item danger" onClick={act(props.onDelete)}>
            <IconTrash /> {card.source === 'project' ? 'Delete prefab' : 'Remove from library'}
          </button>
        </>
      )}
    </ContextMenu>
  )
}

function DeletePrefabModal(props: { card: PrefabCardModel; onClose: () => void }): JSX.Element {
  return (
    <Modal
      title={`Delete ${props.card.data.name}?`}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              props.onClose()
              void uiDeletePrefab(props.card.id)
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <p>
        <code>{props.card.id}</code> and everything in it — the composite, the models,
        the scripts — is removed from the project.
      </p>
      <p style={{ opacity: 0.8 }}>
        Copies placed in the scene leave with it — including anything in “When spawned”,
        which is the thing you built and edit. Their models and scripts load from this
        folder, so a copy without it is broken. Undo brings the scene entities back, not
        the folder.
      </p>
    </Modal>
  )
}

function RemoveFromLibraryModal(props: { card: PrefabCardModel; onClose: () => void }): JSX.Element {
  return (
    <Modal
      title={`Remove ${props.card.data.name} from your library?`}
      onClose={props.onClose}
      footer={
        <>
          <Button onClick={props.onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              props.onClose()
              void uiDeleteLibraryPrefab(props.card.id)
            }}
          >
            Remove
          </Button>
        </>
      }
    >
      <p>
        It disappears from every scene&apos;s Prefabs tab, but scenes that already placed it keep
        their own copy in <code>custom/</code> and go on working.
      </p>
    </Modal>
  )
}

export function PrefabDropLayer(): JSX.Element | null {
  const dragging = useStore(() => prefabStore.dragging)
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (dragging === null) setOver(false)
  }, [dragging])

  if (dragging === null) return null
  return (
    <div
      className={`eui-prefab-drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        endPrefabDrag()
        placePrefab(dragging.source, dragging.id)
      }}
    >
      <span className="hint">Drop to place {dragging.name}</span>
    </div>
  )
}
