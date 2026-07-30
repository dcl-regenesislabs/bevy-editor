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
import { Button, Modal, useOutsideClose } from '../ds'
import { IconEdit, IconExport, IconImport, IconPlus, IconPrefab, IconRefresh, IconTrash } from '../icons'
import { originDetail, originLabel, originTip, scopeOrigin } from '../prefabs/provenance'
import { libraryAvailable } from '../prefabs/library'
import type { PrefabData } from '../prefabs/format'
import { PrefabImportDialog } from './PrefabImport'
import {
  beginPrefabDrag,
  clearLibraryReveal,
  clearPrefabReveal,
  endPrefabDrag,
  ensurePrefabsLoaded,
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
}

type Scope = 'all' | PrefabSource

const SOURCES: PrefabSource[] = ['project', 'user', 'builtin']
const SCOPES: Scope[] = ['all', ...SOURCES]

const SCOPE_LABEL: Record<Scope, string> = {
  all: 'All',
  project: 'This project',
  user: 'My library',
  builtin: 'Built-in'
}

type CardMenu = { x: number; y: number; card: PrefabCardModel }

function matches(data: PrefabData, id: string, filter: string): boolean {
  if (filter === '') return true
  return (
    data.name.toLowerCase().includes(filter) ||
    id.toLowerCase().includes(filter) ||
    data.tags.some((t) => t.toLowerCase().includes(filter))
  )
}

export function PrefabsTab(props: { onCreatePrefab: () => void }): JSX.Element {
  const items = useStore(() => prefabStore.items)
  const library = useStore(() => prefabStore.library)
  const loading = useStore(() => prefabStore.loading)
  const loaded = useStore(() => prefabStore.loaded)
  const error = useStore(() => prefabStore.error)
  const libraryError = useStore(() => prefabStore.libraryError)
  const busy = useStore(() => state.assetBusy)
  const reveal = useStore(() => prefabStore.reveal)
  const revealLibrary = useStore(() => prefabStore.revealLibrary)
  const selected = useStore(() => state.selected)
  const [filter, setFilter] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [menu, setMenu] = useState<CardMenu | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PrefabCardModel | null>(null)
  const [importing, setImporting] = useState(false)

  const hasLibrary = libraryAvailable()

  useEffect(ensurePrefabsLoaded, [])
  useEffect(() => {
    if (reveal === null) return
    const t = setTimeout(clearPrefabReveal, REVEAL_MS)
    return () => clearTimeout(t)
  }, [reveal])
  useEffect(() => {
    if (revealLibrary === null) return
    setScope('all')
    const t = setTimeout(clearLibraryReveal, REVEAL_MS)
    return () => clearTimeout(t)
  }, [revealLibrary])

  const f = filter.toLowerCase()
  const cards: PrefabCardModel[] = [
    ...items.map((p) => ({ source: 'project' as const, id: p.folder, data: p.data })),
    ...library.map((p) => ({ source: p.scope, id: p.ref, data: p.data }))
  ]
  const visible = cards.filter(
    (c) => (scope === 'all' || scope === c.source) && matches(c.data, c.id, f)
  )
  const sections: PrefabSource[] = hasLibrary ? SOURCES : ['project']
  const shown = sections.filter((s) => scope === 'all' || scope === s)
  const menuCard =
    menu === null
      ? undefined
      : visible.find((c) => c.id === menu.card.id && c.source === menu.card.source)

  const reload = (): void => {
    void refreshPrefabs()
    void refreshLibrary()
  }

  return (
    <>
      <div className="eui-search" style={{ display: 'flex', gap: 6 }}>
        <input
          className="eui-input"
          style={{ flex: 1 }}
          placeholder="Filter prefabs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {hasLibrary && (
          <button
            className="eui-btn icon"
            data-tip="Import a prefab from a folder, a .zip or GitHub"
            style={{ flex: 'none' }}
            onClick={() => setImporting(true)}
          >
            <IconImport />
          </button>
        )}
        <button
          className="eui-btn icon"
          data-tip="Reload prefabs"
          style={{ flex: 'none' }}
          onClick={reload}
        >
          <IconRefresh />
        </button>
      </div>
      {hasLibrary && (
        <div className="eui-prefab-scopes">
          {SCOPES.map((s) => (
            <button
              key={s}
              className={`eui-prefab-scope${scope === s ? ' active' : ''}`}
              onClick={() => setScope(s)}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <div className="eui-asset-count">
        {busy
          ? 'Working…'
          : !loaded && loading
            ? 'Loading…'
            : `${visible.length} prefab${visible.length === 1 ? '' : 's'}`}
      </div>
      <div className="eui-panel-body">
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
          const group = visible.filter((c) => c.source === section)
          const leadTile = section === 'project'
          if (group.length === 0 && !leadTile) return null
          return (
            <div key={section} className="eui-prefab-section">
              {hasLibrary && <div className="eui-prefab-section-head">{SCOPE_LABEL[section]}</div>}
              <div className="eui-asset-grid">
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
                {group.map((card) => (
                  <PrefabCard
                    key={`${card.source}:${card.id}`}
                    card={card}
                    busy={busy}
                    revealed={card.source === 'project' ? reveal === card.id : revealLibrary === card.id}
                    renaming={renaming === card.id}
                    onRenamed={() => setRenaming(null)}
                    onMenu={(e) => {
                      e.preventDefault()
                      setMenu({ x: e.clientX, y: e.clientY, card })
                    }}
                  />
                ))}
              </div>
            </div>
          )
        })}
        {loaded && cards.length === 0 && error === null && (
          <div className="eui-empty">
            No prefabs yet — select entities in the scene and save them with the tile above.
          </div>
        )}
        {loaded && cards.length > 0 && visible.length === 0 && (
          <div className="eui-empty">No prefabs match</div>
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
    </>
  )
}

function placePrefab(source: PrefabSource, id: string): void {
  if (source === 'project') void uiPlacePrefab(id)
  else void uiPlaceLibraryPrefab(id)
}

function PrefabCard(props: {
  card: PrefabCardModel
  busy: boolean
  revealed: boolean
  renaming: boolean
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
      className={`eui-asset eui-prefab-card${revealed ? ' revealed' : ''}${props.busy ? ' busy' : ''}`}
      draggable={!renaming}
      data-tip={`${card.data.name} — drag into the viewport or click to place it${
        card.source === 'project' ? '' : ' (a copy is added to this scene)'
      }`}
      onClick={() => {
        if (!renaming) placePrefab(card.source, card.id)
      }}
      onContextMenu={props.onMenu}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData('text/plain', card.id)
        beginPrefabDrag({ source: card.source, id: card.id, name: card.data.name })
      }}
      onDragEnd={endPrefabDrag}
    >
      <div className="glyph">
        <IconPrefab />
      </div>
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
