import { useEffect, useRef, useState } from 'react'
import { state } from '../../../scene/src/state'
import {
  uiDeleteLibraryPrefab,
  uiDeletePrefab,
  uiPlaceLibraryPrefab,
  uiPlacePrefab,
  uiRenamePrefab,
  uiSavePrefabToLibrary
} from '../actions'
import { useStore } from '../store'
import { Button, Chip, IconButton, LinkButton, Modal, Notice, SearchField, Shelf, useOutsideClose } from '../ds'
import { IconEdit, IconExport, IconImport, IconPlus, IconPrefab, IconRefresh, IconTrash } from '../icons'
import { LeftTabs, type LeftView } from './left-view'
import { sceneEmptiness } from './empty-scene'
import { SearchEmpty } from './SearchEmpty'
import { countCatalogMatches, matchHint, prefabMatches } from './search-hints'
import { originDetail, originLabel, originTip, scopeOrigin } from '../prefabs/provenance'
import { libraryAvailable } from '../prefabs/library'
import { unusedBuiltinCopies } from '../prefabs/unused'
import type { PrefabData } from '../prefabs/format'
import type { OutdatedPrefab } from '../prefabs/outdated'
import { PrefabImportDialog } from './PrefabImport'
import { PrefabUpdateDialog } from './PrefabUpdate'
import { SdkGateDialog } from './SdkGateDialog'
import {
  beginPrefabDrag,
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

  const emptyScene = useStore(sceneEmptiness) === true
  const snapshot = useStore(() => state.snapshot)
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
                          ? 'Select entities in the scene, then save them as a reusable prefab'
                          : 'Save the current selection as a prefab'
                      }
                      onClick={props.onCreatePrefab}
                    >
                      <div className="glyph">+</div>
                      <span className="name">Save selection</span>
                      <span className="pack">as a prefab</span>
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
                  doomed={doomed?.has(card.id)}
                  onReview={
                    doomed !== null && reviewable.has(card.id) ? () => toggleDoom(card.id) : undefined
                  }
                  onUpdate={() => setUpdating({ id: card.data.id, name: card.data.name })}
                  onRenamed={() => setRenaming(null)}
                  onMenu={(e) => {
                    e.preventDefault()
                    setMenu({ x: e.clientX, y: e.clientY, card })
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
            No prefabs yet — select entities in the scene and save them with the tile above.
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
  const description = card.data.description
  return description === undefined
    ? `${card.data.name} — drag into the viewport or click to place it${copies}`
    : `${card.data.name} — ${description}${copies}`
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
      data-tip={`${members.length} models — click to browse`}
      onClick={props.onOpen}
    >
      <CardArt thumbnail={members.find((m) => m.thumbnail !== undefined)?.thumbnail} />
      <span className="name">{props.name}</span>
      <span className="pack">
        {members.length} model{members.length === 1 ? '' : 's'} ▸
      </span>
    </button>
  )
}

function UpdateChip(props: { info: OutdatedPrefab; label?: string; onClick: () => void }): JSX.Element {
  return (
    <button
      className="eui-prefab-update-chip"
      data-tip={`v${props.info.copyVersion} → v${props.info.masterVersion} available — click to see what changed and update`}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
    >
      {props.label ?? 'Update'}
    </button>
  )
}

function PrefabCard(props: {
  card: PrefabCardModel
  busy: boolean
  revealed: boolean
  renaming: boolean
  outdated?: OutdatedPrefab
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

  return (
    <div
      ref={ref}
      className={`eui-asset eui-prefab-card${revealed ? ' revealed' : ''}${props.busy ? ' busy' : ''}${props.doomed === true ? ' doomed' : ''}`}
      draggable={!renaming}
      data-tip={cardTip(card)}
      onClick={() => {
        if (renaming) return
        if (props.onReview !== undefined) props.onReview()
        else placePrefab(card.source, card.id)
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
      {card.data.requiresSdk === 'auth-server' && (
        <Chip
          size="xs"
          tone="info"
          tip="Runs on the Multiplayer Server — needs a scene on the auth-server SDK. The editor offers to install it when you place this."
        >
          Server
        </Chip>
      )}
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
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(true, ref, props.onClose)
  const style: React.CSSProperties = {
    left: Math.min(props.x, window.innerWidth - 220),
    top: Math.min(props.y, window.innerHeight - 190)
  }
  const act = (fn: () => void): (() => void) => () => {
    fn()
    props.onClose()
  }
  const { card } = props
  return (
    <div ref={ref} className="eui-ctx" style={style}>
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
    </div>
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
        Entities already placed from it keep their components, but their models and scripts
        load from this folder, so they break. Delete those instances too, or place the prefab
        again before deleting.
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

function instanceLabel(entry: PrefabEntry | undefined, loaded: boolean): string {
  if (entry !== undefined) return entry.data.name
  return loaded ? 'a prefab no longer in this project' : 'a prefab'
}

export function PrefabUpdateBadge(props: { assetId: string; label?: string }): JSX.Element | null {
  const items = useStore(() => prefabStore.items)
  const outdated = useStore(() => prefabStore.outdated)
  const [updating, setUpdating] = useState(false)
  useEffect(ensurePrefabsLoaded, [])
  const entry = items.find((p) => p.data.id === props.assetId)
  const info = outdated.get(props.assetId)
  if (entry === undefined || info === undefined) return null
  return (
    <>
      <UpdateChip
        info={info}
        label={props.label ?? 'Update available'}
        onClick={() => setUpdating(true)}
      />
      {updating && (
        <PrefabUpdateDialog
          id={props.assetId}
          name={entry.data.name}
          info={info}
          onClose={() => setUpdating(false)}
        />
      )}
    </>
  )
}

export function PrefabInstanceStrip(props: { assetId: string }): JSX.Element {
  const items = useStore(() => prefabStore.items)
  const loaded = useStore(() => prefabStore.loaded)
  useEffect(ensurePrefabsLoaded, [])
  const entry = items.find((p) => p.data.id === props.assetId)
  const label = instanceLabel(entry, loaded)
  return (
    <div className="eui-prefab-instance">
      <IconPrefab />
      <span className="name">Instance of {label}</span>
      <PrefabUpdateBadge assetId={props.assetId} />
      {entry !== undefined && (
        <button className="eui-link" onClick={() => revealPrefab(entry.folder)}>
          Show
        </button>
      )}
    </div>
  )
}

export function PrefabMark(): JSX.Element {
  return (
    <span className="eui-prefab-mark" data-tip="Prefab instance — placed from the Prefabs library">
      <IconPrefab />
    </span>
  )
}
