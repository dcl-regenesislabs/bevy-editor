// Top-level UI builder surface: a left dock (Library tab = a storybook-style list
// of the scene's UI components; Edit tab = palette + layers + sample props), the
// proportional canvas, and the element inspector. Open a component from the
// Library, edit visually, Save it back (TS-AST round-trip).
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { setUiBuilderKeyHandler } from '../shortcuts'
import { setUiBuilderUndo } from '../history'
import { ui, deleteNode, undo, redo, setSampleProp, type UiNode } from './model'
import { UiCanvas } from './render'
import { Palette, Layers, BuilderInspector } from './panels'
import { generateTsx } from './codegen'
import { listUiFiles, openUiFromFile, importAvailable, canSave, saveUiToFile } from './importTsx'

type Tab = 'library' | 'edit'

// prop names referenced anywhere in the tree (incl. inlined previews)
function propNamesOf(node: UiNode): string[] {
  const set = new Set<string>()
  const visit = (n: UiNode): void => {
    for (const e of Object.values(n.exprs)) for (const m of e.matchAll(/\bprops\.([A-Za-z_$][\w$]*)/g)) set.add(m[1])
    n.children.forEach(visit)
    if (n.preview) visit(n.preview)
  }
  visit(node)
  return [...set]
}

export function UiBuilder(): JSX.Element {
  const [tab, setTab] = useState<Tab>(importAvailable() ? 'library' : 'edit')
  const [genOpen, setGenOpen] = useState(false)
  const [status, setStatus] = useState('')
  const componentName = useStore(() => ui.componentName)
  const sourcePath = useStore(() => ui.sourcePath)
  useStore(() => ui.historyTick) // re-render undo/redo availability

  useEffect(() => {
    setUiBuilderKeyHandler((e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && ui.selectedId && ui.selectedId !== ui.root.id) {
        e.preventDefault()
        deleteNode(ui.selectedId)
        return true
      }
      return false
    })
    return () => setUiBuilderKeyHandler(null)
  }, [])

  useEffect(() => {
    setUiBuilderUndo({ undo, redo })
    return () => setUiBuilderUndo(null)
  }, [])

  const save = async (): Promise<void> => {
    setStatus('Saving…')
    const res = await saveUiToFile()
    setStatus(res.ok ? `Saved ${sourcePath}` : `Save failed: ${res.error ?? ''}`)
    setTimeout(() => setStatus(''), 4000)
  }

  return (
    <>
      <div className="eui-panel eui-left">
        <div className="eui-panel-head">
          <div className="eui-head-text">
            <span className="eui-overline">UI Builder</span>
            <span className="eui-title">{sourcePath ?? 'Components'}</span>
          </div>
        </div>

        {importAvailable() && (
          <div className="eui-left-tabs">
            <button className={`eui-ltab${tab === 'library' ? ' active' : ''}`} onClick={() => setTab('library')}>Library</button>
            <button className={`eui-ltab${tab === 'edit' ? ' active' : ''}`} onClick={() => setTab('edit')}>Edit</button>
          </div>
        )}

        {tab === 'library' ? (
          <Library onOpen={() => setTab('edit')} />
        ) : (
          <>
            <div className="eui-panel-body" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="eui-group-label" style={{ padding: '8px 12px 0' }}>Add</div>
              <Palette />
              <div className="eui-group-label" style={{ padding: '4px 12px 0' }}>Layers</div>
              <Layers />
              <SampleProps />
            </div>
            <div className="eui-uib-foot">
              <input
                className="eui-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                value={componentName}
                spellCheck={false}
                onChange={(e) => (ui.componentName = e.target.value.replace(/[^A-Za-z0-9_]/g, '') || 'MyUi')}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                {canSave() ? (
                  <button className="eui-btn primary" style={{ flex: 1 }} data-tip={`Write changes back to ${sourcePath}`} onClick={() => void save()}>Save</button>
                ) : (
                  <button className="eui-btn primary" style={{ flex: 1 }} onClick={() => setGenOpen(true)}>Generate .tsx</button>
                )}
                {canSave() && <button className="eui-btn" style={{ flex: 1 }} onClick={() => setGenOpen(true)}>Generate…</button>}
              </div>
              {status !== '' && <div className="eui-comp-status ok" style={{ fontSize: 11 }}>{status}</div>}
            </div>
          </>
        )}
      </div>

      <UiCanvas />
      <BuilderInspector />

      {genOpen && <GenerateModal onClose={() => setGenOpen(false)} />}
    </>
  )
}

function Library(props: { onOpen: () => void }): JSX.Element {
  const [files, setFiles] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sourcePath = useStore(() => ui.sourcePath)

  useEffect(() => {
    void listUiFiles().then(setFiles)
  }, [])

  const open = async (rel: string): Promise<void> => {
    setBusy(rel)
    setError(null)
    const res = await openUiFromFile(rel)
    setBusy(null)
    if (res.ok) props.onOpen()
    else setError(res.error ?? 'Open failed')
  }

  const f = filter.toLowerCase()
  const shown = (files ?? []).filter((p) => p.toLowerCase().includes(f))

  return (
    <>
      <div className="eui-search">
        <input className="eui-input" placeholder="Search components…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="eui-panel-body">
        {error !== null && <div className="eui-comp-status err" style={{ padding: '4px 12px' }}>{error}</div>}
        {files === null && <div className="eui-empty">scanning project…</div>}
        {files !== null && shown.length === 0 && <div className="eui-empty">no .tsx components found</div>}
        {shown.map((p) => (
          <div
            key={p}
            className={`eui-row ${p === sourcePath ? 'selected' : ''}`}
            style={{ margin: '0 8px' }}
            onClick={() => void open(p)}
          >
            <span className="label">
              {p.split('/').pop()}
              <span className="dim">{p.replace(/\/[^/]+$/, '')}</span>
            </span>
            {busy === p && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>parsing…</span>}
          </div>
        ))}
      </div>
    </>
  )
}

function SampleProps(): JSX.Element | null {
  const root = useStore(() => ui.root)
  useStore(() => ui.sampleProps)
  const names = propNamesOf(root)
  if (names.length === 0) return null
  return (
    <>
      <div className="eui-group-label" style={{ padding: '8px 12px 0' }} data-tip="Stand-in values to preview the component — never saved">
        Sample props (preview)
      </div>
      <div style={{ padding: '2px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {names.map((p) => (
          <div className="eui-prop" key={p}>
            <span className="plabel">{p}</span>
            <div className="pvalue">
              <input className="eui-input" placeholder="sample value" value={ui.sampleProps[p] ?? ''} onChange={(e) => setSampleProp(p, e.target.value || null)} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function GenerateModal(props: { onClose: () => void }): JSX.Element {
  const root = useStore(() => ui.root)
  const componentName = useStore(() => ui.componentName)
  const propsType = useStore(() => ui.propsType)
  const importLines = useStore(() => ui.importLines)
  const code = generateTsx(root, componentName, { propsType, importLines })
  const [copied, setCopied] = useState(false)

  return (
    <div className="eui-modal-backdrop" onClick={props.onClose}>
      <div className="eui-modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="eui-modal-head">Generated component — {componentName}.tsx</div>
        <div className="eui-modal-body">
          <textarea className="eui-raw" style={{ minHeight: 360, fontSize: 12 }} value={code} readOnly spellCheck={false} />
        </div>
        <div className="eui-modal-foot">
          <button
            className="eui-btn"
            onClick={() => {
              void navigator.clipboard.writeText(code)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
          <button className="eui-btn primary" onClick={props.onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
