// Asset picker modal for file-path fields: one scrollable browser over the
// project's files, plus (for models) the OpenDCL catalog — picking a catalog
// item downloads it into the project first, then commits its path. Free-text
// paths/URLs still work via the search box.
import { useEffect, useRef, useState } from 'react'
import { state } from '../../../../scene/src/state'
import { useStore } from '../../store'
import { cmd } from '../../cmd'
import { uiFetchCatalog } from '../../actions'
import { importCatalogFile, modelById, opendclUrl } from '../../assets'
import { Button, Segmented } from '../../ds'

type CatalogEntry = (typeof state.assetCatalog)[number]

const MODEL_EXT = ['glb', 'gltf']

export function AssetPickerModal(props: {
  ext: string[]
  current: string
  onPick: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const { ext, current, onPick, onClose } = props
  const catalogable = ext.some((e) => MODEL_EXT.includes(e.toLowerCase()))
  const [tab, setTab] = useState<'project' | 'catalog'>('project')

  return (
    <div className="eui-modal-backdrop" onClick={onClose}>
      <div className="eui-modal eui-asset-picker" onClick={(e) => e.stopPropagation()}>
        <div className="eui-modal-head eui-ap-head">
          <span>Choose a file</span>
          <span className="spacer" />
          {catalogable && (
            <Segmented
              value={tab}
              options={[
                { value: 'project', label: 'Project' },
                { value: 'catalog', label: 'Catalog' }
              ]}
              onChange={setTab}
            />
          )}
        </div>
        {tab === 'project' ? (
          <ProjectTab ext={ext} current={current} onPick={onPick} />
        ) : (
          <CatalogPickTab onPick={onPick} />
        )}
        <div className="eui-modal-foot">
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

function ProjectTab(props: {
  ext: string[]
  current: string
  onPick: (path: string) => void
}): JSX.Element {
  const { ext, current, onPick } = props
  const [files, setFiles] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    const exts = ext.map((e) => `.${e.toLowerCase()}`)
    cmd
      .sceneContent()
      .then((all) => {
        if (!cancelled) {
          setFiles(all.filter((f) => exts.some((e) => f.toLowerCase().endsWith(e))).sort())
        }
      })
      .catch(() => {
        if (!cancelled) setFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const shown = (files ?? []).filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
  const free = filter.trim()
  const freeIsNew = free !== '' && !shown.some((f) => f === free)

  return (
    <div className="eui-ap-body">
      <input
        className="eui-input"
        autoFocus
        placeholder={`search ${ext.join('/')} files — or type a path / URL and press enter`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && free !== '') onPick(free)
        }}
      />
      <div className="eui-ap-list">
        {files === null && <div className="eui-script-dim">loading project files…</div>}
        {freeIsNew && (
          <div className="eui-ap-row free" onClick={() => onPick(free)}>
            use “{free}”
          </div>
        )}
        {shown.map((f) => {
          const i = f.lastIndexOf('/')
          const dir = i === -1 ? '' : f.slice(0, i + 1)
          const name = i === -1 ? f : f.slice(i + 1)
          return (
            <div
              key={f}
              className={`eui-ap-row ${f === current ? 'on' : ''}`}
              onClick={() => onPick(f)}
            >
              <span className="name">{name}</span>
              {dir !== '' && <span className="dir">{dir}</span>}
            </div>
          )
        })}
        {files !== null && shown.length === 0 && !freeIsNew && (
          <div className="eui-script-dim">no matching files in the project</div>
        )}
      </div>
    </div>
  )
}

const PAGE = 48

function CatalogPickTab(props: { onPick: (path: string) => void }): JSX.Element {
  const { onPick } = props
  const catalog = useStore(() => state.assetCatalog)
  const [filter, setFilter] = useState('')
  const [visible, setVisible] = useState(PAGE)
  const [importing, setImporting] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (state.assetCatalog.length === 0) void uiFetchCatalog()
  }, [])
  useEffect(() => setVisible(PAGE), [filter])

  const f = filter.toLowerCase()
  const entries = catalog.filter(
    (a) =>
      f === '' ||
      a.name.toLowerCase().includes(f) ||
      a.category.toLowerCase().includes(f) ||
      a.pack.toLowerCase().includes(f) ||
      a.tags.some((t) => t.toLowerCase().includes(f))
  )

  useEffect(() => {
    const el = sentinelRef.current
    if (el === null) return
    const io = new IntersectionObserver((hits) => {
      if (hits.some((h) => h.isIntersecting)) setVisible((v) => v + PAGE)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [entries.length, visible])

  const pick = async (entry: CatalogEntry): Promise<void> => {
    if (importing !== null) return
    const asset = modelById(entry.id) // full record (with download url) from the catalog cache
    if (asset === undefined) return
    setImporting(entry.id)
    setErr(null)
    try {
      onPick(await importCatalogFile(asset))
    } catch (e) {
      setErr(String(e))
      setImporting(null)
    }
  }

  return (
    <div className="eui-ap-body">
      <input
        className="eui-input"
        autoFocus
        placeholder="search catalog models…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {err !== null && <div className="eui-script-err">{err}</div>}
      <div className="eui-ap-list">
        <div className="eui-asset-grid">
          {entries.slice(0, visible).map((a) => (
            <div
              key={a.id}
              className={`eui-asset ${importing === a.id ? 'busy' : ''}`}
              data-tip={`${a.name} — ${a.pack}`}
              onClick={() => void pick(a)}
            >
              {a.thumbnail !== null && a.thumbnail !== undefined ? (
                <img src={opendclUrl(a.thumbnail)} crossOrigin="anonymous" loading="lazy" />
              ) : (
                <div style={{ width: 56, height: 56, background: 'var(--input)', borderRadius: 6 }} />
              )}
              <span className="name">{importing === a.id ? 'importing…' : a.name}</span>
              <span className="pack">{a.pack}</span>
            </div>
          ))}
          {visible < entries.length && <div ref={sentinelRef} className="eui-asset-sentinel" />}
        </div>
        {entries.length === 0 && (
          <div className="eui-script-dim">
            {catalog.length === 0 ? 'loading catalog…' : 'no models match'}
          </div>
        )}
      </div>
    </div>
  )
}
