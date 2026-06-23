import { useEffect, useRef, useState } from 'react'
import { state } from '../../../scene/src/state'
import { useStore } from '../store'
import {
  uiFetchCatalog,
  uiImportAsset,
  uiLoadLocalModels,
  uiPlaceLocalModel,
  uiUploadModel
} from '../actions'
import { opendclUrl } from '../assets'

export type LeftView = 'scene' | 'assets'

// Shared tab strip at the top of the left dock; rendered by both HierarchyPanel
// (Scene) and AssetsPanel (Assets) so either tab can switch to the other.
export function LeftTabs(props: { view: LeftView; onView: (v: LeftView) => void }): JSX.Element {
  return (
    <div className="eui-left-tabs">
      {(['scene', 'assets'] as LeftView[]).map((v) => (
        <button
          key={v}
          className={`eui-ltab${props.view === v ? ' active' : ''}`}
          onClick={() => props.onView(v)}
        >
          {v === 'scene' ? 'Scene' : 'Assets'}
        </button>
      ))}
    </div>
  )
}

const PAGE_SIZE = 60

function CatalogTab(): JSX.Element {
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Re-render only when these slices change (Object.is). Writes go through the
  // live `state` (in actions / useEffect); render derives from the selected slices.
  const catalog = useStore(() => state.assetCatalog)
  const busy = useStore(() => state.assetBusy)

  useEffect(() => {
    if (state.assetCatalog.length === 0) void uiFetchCatalog()
  }, [])
  useEffect(() => setVisible(PAGE_SIZE), [filter, category])

  const f = filter.toLowerCase()
  const entries = catalog.filter(
    (a) =>
      (category === '' || a.category === category) &&
      (f === '' ||
        a.name.toLowerCase().includes(f) ||
        a.category.toLowerCase().includes(f) ||
        a.pack.toLowerCase().includes(f) ||
        a.tags.some((t) => t.toLowerCase().includes(f)))
  )

  useEffect(() => {
    const el = sentinelRef.current
    if (el === null) return
    const io = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) setVisible((v) => v + PAGE_SIZE)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [entries.length, visible])

  const categories = [...new Set(catalog.map((a) => a.category))].sort()

  return (
    <>
      <div className="eui-search" style={{ display: 'flex', gap: 6 }}>
        <input
          className="eui-input"
          style={{ flex: 1 }}
          placeholder="Search boedo models…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="eui-input"
          style={{ width: 96, flex: 'none' }}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="eui-asset-count">
        {busy ? 'Working…' : `${entries.length} model${entries.length === 1 ? '' : 's'}`}
      </div>
      <div className="eui-panel-body">
        <div className="eui-asset-grid">
          {entries.slice(0, visible).map((a) => (
            <div
              key={a.id}
              className="eui-asset"
              data-tip={`${a.name} — ${a.pack}`}
              onClick={() => void uiImportAsset(a.id, a.name)}
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
        {entries.length === 0 && !busy && <div className="eui-empty">No models match</div>}
      </div>
    </>
  )
}

const ModelGlyph = (): JSX.Element => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 2.5 21 7v10l-9 4.5L3 17V7l9-4.5Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M3 7l9 4.5L21 7M12 11.5V21.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

function LocalTab(): JSX.Element {
  const [models, setModels] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = useStore(() => state.assetBusy)

  const refresh = (): void => {
    setModels(null)
    void uiLoadLocalModels().then(setModels)
  }
  useEffect(refresh, [])

  const onFile = async (e: { target: HTMLInputElement }): Promise<void> => {
    const file = e.target.files?.[0]
    if (file === undefined || file === null) return
    await uiUploadModel(file)
    if (fileRef.current !== null) fileRef.current.value = ''
    refresh()
  }

  const f = filter.toLowerCase()
  const list = (models ?? []).filter((p) => f === '' || p.toLowerCase().includes(f))
  return (
    <>
      <div className="eui-search" style={{ display: 'flex', gap: 6 }}>
        <input
          className="eui-input"
          style={{ flex: 1 }}
          placeholder="Filter local models…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className="eui-btn" data-tip="Refresh" onClick={refresh} style={{ flex: 'none' }}>
          ↻
        </button>
      </div>
      <div className="eui-asset-count">
        {busy
          ? 'Working…'
          : models === null
            ? 'Loading…'
            : `${list.length} model${list.length === 1 ? '' : 's'} in this project`}
      </div>
      <div className="eui-panel-body">
        <div className="eui-asset-grid">
          {/* upload tile: same card language as the models, leads the grid */}
          <label className="eui-asset eui-asset-upload" data-tip="Add a .glb / .gltf from your computer">
            <input
              ref={fileRef}
              type="file"
              accept=".glb,.gltf,model/gltf-binary"
              style={{ display: 'none' }}
              onChange={(e) => void onFile(e)}
            />
            <div className="glyph">+</div>
            <span className="name">Add model</span>
            <span className="pack">from your computer</span>
          </label>
          {list.map((p) => {
            const name = p.split('/').pop() ?? p
            const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
            return (
              <div
                key={p}
                className="eui-asset"
                data-tip={`Place ${p}`}
                onClick={() => void uiPlaceLocalModel(p)}
              >
                <div className="glyph">
                  <ModelGlyph />
                </div>
                <span className="name">{name.replace(/\.(glb|gltf)$/i, '')}</span>
                <span className="pack">{folder.replace(/^assets\//, '') || 'model'}</span>
              </div>
            )
          })}
        </div>
        {models !== null && list.length === 0 && (
          <div className="eui-empty">No local models match — add one with the tile above.</div>
        )}
      </div>
    </>
  )
}

export function AssetsPanel(props: { width?: number; onView: (v: LeftView) => void }): JSX.Element {
  // This panel reads no reactive state itself — CatalogTab and LocalTab each
  // subscribe to their own slices via useStore.
  const [tab, setTab] = useState<'catalog' | 'local'>('catalog')
  return (
    <div className="eui-panel eui-left" style={{ width: props.width }}>
      <LeftTabs view="assets" onView={props.onView} />
      <div className="eui-seg">
        {(['catalog', 'local'] as const).map((t) => (
          <button
            key={t}
            className={`eui-seg-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'catalog' ? 'Catalog' : 'Local'}
          </button>
        ))}
      </div>
      {tab === 'catalog' ? <CatalogTab /> : <LocalTab />}
    </div>
  )
}
