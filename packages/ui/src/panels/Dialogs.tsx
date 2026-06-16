import { useEffect, useRef, useState } from 'react'
import { state } from '../../../scene/src/state'
import { entityName } from '../../../scene/src/custom-components'
import { uiAddEntity, uiFetchCatalog, uiImportAsset } from '../actions'
import { opendclUrl } from '../assets'
import { dismissPlayEditWarning } from '../autosave'

export function Modal(props: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
}): JSX.Element {
  return (
    <div className="eui-modal-backdrop" onClick={props.onClose}>
      <div className="eui-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eui-modal-head">{props.title}</div>
        <div className="eui-modal-body">{props.children}</div>
        {props.footer !== undefined && <div className="eui-modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}

// --- play-mode edit warning ---

// Shown once (per the "don't show again" opt-out) the first time the user edits
// while the scene is playing, so the Unity-like "these changes won't persist"
// rule isn't a silent surprise.
export function PlayEditWarningDialog(): JSX.Element {
  const [dontShow, setDontShow] = useState(false)
  const close = (): void => dismissPlayEditWarning(dontShow)
  return (
    <Modal
      title="Editing while playing"
      onClose={close}
      footer={
        <button className="eui-btn primary" onClick={close}>
          Got it
        </button>
      }
    >
      <p>
        The scene is <strong>playing</strong>. Changes you make now are runtime only —
        they’re live in the scene but <strong>won’t be saved</strong>, and revert when you
        press <strong>Stop</strong>.
      </p>
      <p style={{ opacity: 0.8 }}>Stop the scene to make changes that persist to the project.</p>
      <label className="eui-check">
        <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
        Don’t show this again
      </label>
    </Modal>
  )
}

// --- new entity ---

export function NewEntityDialog(props: { onClose: () => void }): JSX.Element {
  const [name, setName] = useState('')
  const active = state.activeEntity
  const [parent, setParent] = useState<'root' | 'active'>(active !== null ? 'active' : 'root')

  const create = (): void => {
    const parentId = parent === 'active' && active !== null ? Number(active) : 0
    void uiAddEntity(name, parentId)
    props.onClose()
  }

  return (
    <Modal
      title="New entity"
      onClose={props.onClose}
      footer={
        <>
          <button className="eui-btn" onClick={props.onClose}>
            Cancel
          </button>
          <button className="eui-btn primary" onClick={create}>
            Create
          </button>
        </>
      }
    >
      <input
        className="eui-input"
        autoFocus
        placeholder="Entity name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create()
        }}
      />
      {active !== null && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`eui-btn ${parent === 'root' ? 'active' : ''}`}
            onClick={() => setParent('root')}
          >
            At scene root
          </button>
          <button
            className={`eui-btn ${parent === 'active' ? 'active' : ''}`}
            onClick={() => setParent('active')}
          >
            Child of {entityName(state.snapshot, active) ?? active}
          </button>
        </div>
      )}
    </Modal>
  )
}

// --- asset import ---

const PAGE_SIZE = 80

export function AssetPickerDialog(props: { onClose: () => void }): JSX.Element {
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.assetCatalog.length === 0) void uiFetchCatalog()
  }, [])

  // reset the window whenever the query narrows/changes
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [filter, category])

  const f = filter.toLowerCase()
  const entries = state.assetCatalog.filter(
    (a) =>
      (category === '' || a.category === category) &&
      (f === '' ||
        a.name.toLowerCase().includes(f) ||
        a.category.toLowerCase().includes(f) ||
        a.pack.toLowerCase().includes(f) ||
        a.tags.some((t) => t.toLowerCase().includes(f)))
  )

  // infinite scroll: grow the window when the end-of-grid sentinel scrolls in
  useEffect(() => {
    const el = sentinelRef.current
    if (el === null) return
    const io = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) {
        setVisible((v) => v + PAGE_SIZE)
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [entries.length, visible])

  const categories = [...new Set(state.assetCatalog.map((a) => a.category))].sort()

  return (
    <Modal title="Import asset" onClose={props.onClose}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="eui-input"
          style={{ flex: 1 }}
          autoFocus
          placeholder="Search assets…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="eui-input"
          style={{ width: 150, flex: 'none' }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="eui-asset-count">
        {state.assetBusy
          ? 'Working…'
          : `${entries.length} model${entries.length === 1 ? '' : 's'}`}
      </div>
      <div className="eui-asset-grid">
        {entries.slice(0, visible).map((a) => (
          <div
            key={a.id}
            className="eui-asset"
            title={`${a.name} — ${a.pack}`}
            onClick={() => {
              void uiImportAsset(a.id, a.name)
              props.onClose()
            }}
          >
            {a.thumbnail !== null && a.thumbnail !== undefined ? (
              <img src={opendclUrl(a.thumbnail)} crossOrigin="anonymous" loading="lazy" />
            ) : (
              <div style={{ width: 56, height: 56, background: 'var(--input)', borderRadius: 6 }} />
            )}
            <span className="name">{a.name}</span>
            <span className="pack">{a.pack}</span>
          </div>
        ))}
        {visible < entries.length && <div ref={sentinelRef} className="eui-asset-sentinel" />}
      </div>
      {entries.length === 0 && !state.assetBusy && <div className="eui-empty">No assets match</div>}
    </Modal>
  )
}
