import { useEffect, useRef, useState } from 'react'
import { state } from '../../../scene/src/state'
import { useStore } from '../store'
import {
  uiFetchCatalog,
  uiImportAsset,
  uiLoadLocalModels,
  uiPlaceLocalModel,
  uiUploadModel,
  uiCheckModelRefs
} from '../actions'
import { opendclUrl } from '../assets'
import { Button, Modal } from '../ds'
import { PrefabsTab } from './Prefabs'
import { prefabStore } from './prefab-store'

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
  const [pending, setPending] = useState<{ files: File[]; missing: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const carryRef = useRef<File[]>([])
  const busy = useStore(() => state.assetBusy)

  const refresh = (): void => {
    setModels(null)
    void uiLoadLocalModels().then(setModels)
  }
  useEffect(refresh, [])

  useEffect(() => {
    const el = fileRef.current
    if (el === null) return
    const clearCarry = (): void => {
      carryRef.current = []
    }
    el.addEventListener('cancel', clearCarry)
    return () => el.removeEventListener('cancel', clearCarry)
  }, [])

  const upload = async (files: File[]): Promise<void> => {
    await uiUploadModel(files)
    refresh()
  }

  const onFile = async (e: { target: HTMLInputElement }): Promise<void> => {
    const picked = Array.from(e.target.files ?? [])
    if (fileRef.current !== null) fileRef.current.value = ''
    const carried = carryRef.current
    carryRef.current = []
    if (picked.length === 0) return
    const byName = new Map<string, File>()
    for (const f of [...carried, ...picked]) byName.set(f.name.toLowerCase(), f)
    const files = [...byName.values()]
    const missing = await uiCheckModelRefs(files)
    if (missing.length > 0) {
      setPending({ files, missing })
      return
    }
    await upload(files)
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
          <label
            className="eui-asset eui-asset-upload"
            data-tip="Add a .glb / .gltf from your computer — select its textures/.bin along with it if the model keeps them in separate files"
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,.ktx2,model/gltf-binary"
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
      {pending !== null && (
        <Modal
          title="Missing model files"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button
                onClick={() => {
                  carryRef.current = pending.files
                  setPending(null)
                  fileRef.current?.click()
                }}
              >
                Select missing files
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setPending(null)
                  void upload(pending.files)
                }}
              >
                Import anyway
              </Button>
            </>
          }
        >
          <p>
            The model references files that aren’t in the project and weren’t selected with it:
          </p>
          <ul>
            {pending.missing.map((uri) => (
              <li key={uri}>
                <code>{uri}</code>
              </li>
            ))}
          </ul>
          <p>
            It won’t display correctly — in the editor or in-world — until they’re all in the
            project. Pick just the files above with <strong>Select missing files</strong>; the
            model you already chose stays in the import.
          </p>
        </Modal>
      )}
    </>
  )
}

type AssetTab = 'catalog' | 'local' | 'prefabs'

const TAB_LABEL: Record<AssetTab, string> = {
  catalog: 'Catalog',
  local: 'Local',
  prefabs: 'Prefabs'
}

export function AssetsPanel(props: {
  width?: number
  onView: (v: LeftView) => void
  onCreatePrefab: () => void
}): JSX.Element {
  // Beyond the reveal signal this panel reads no reactive state itself — each tab
  // subscribes to its own slices via useStore.
  const [tab, setTab] = useState<AssetTab>('catalog')
  const reveal = useStore(() => prefabStore.reveal)
  useEffect(() => {
    if (reveal !== null) setTab('prefabs')
  }, [reveal])
  return (
    <div className="eui-panel eui-left" style={{ width: props.width }}>
      <LeftTabs view="assets" onView={props.onView} />
      <div className="eui-seg">
        {(['catalog', 'local', 'prefabs'] as const).map((t) => (
          <button
            key={t}
            className={`eui-seg-btn${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {tab === 'catalog' && <CatalogTab />}
      {tab === 'local' && <LocalTab />}
      {tab === 'prefabs' && <PrefabsTab onCreatePrefab={props.onCreatePrefab} />}
    </div>
  )
}
