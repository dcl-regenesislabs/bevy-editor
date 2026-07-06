// Bespoke inspector view for the asset-packs::Script editor component (the
// Creator Hub Script component, minus the smart-items Actions/Triggers layer).
// A script entry = { path, priority, layout } where layout is a JSON string of
// { params, actions, error } parsed from the script's constructor signature.
// Scripts are authored in-app: files live in the project (src/scripts) and are
// read/written over the dev server's data-layer RPC; @dcl/sdk-commands picks
// them up from main.composite at build time and runs start()/update(dt).
import { useEffect, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { keymap, tooltips } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { autocompletion } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { tsFacet, tsSync, tsLinter, tsAutocomplete, tsHover } from '@valtown/codemirror-ts'
import { createScriptTsEnv } from '../../script/ts-env'
import type { ComponentView, ComponentViewProps } from './types'
import { state, type Snapshot } from '../../../../scene/src/state'
import { entityName } from '../../../../scene/src/custom-components'
import { useStore } from '../../store'
import { restartScene } from '../../boot'
import { uiPlay } from '../../actions'
import {
  dataLayerAvailable,
  dataLayerReadFile,
  dataLayerRemoveFile,
  dataLayerSaveFile
} from '../../datalayer'
import {
  getScriptParams,
  mergeLayout,
  parseLayout,
  type ScriptLayout,
  type ScriptParam
} from '../../script/parser'
import { buildScriptPath, getScriptTemplateClass, isScriptFile } from '../../script/template'
import { Button, IconButton, Select, TextInput, Toggle } from '../../ds'
import { IconCode, IconEdit, IconRefresh, IconTrash } from '../../icons'

type ScriptItem = { path: string; priority: number; layout?: string }

function itemsOf(value: unknown): ScriptItem[] {
  const v = value as { value?: ScriptItem[] } | null
  return Array.isArray(v?.value) ? v.value : []
}

function freshLayout(content: string): string {
  const { params, actions, error } = getScriptParams(content)
  const layout: ScriptLayout = { params, actions, error }
  return JSON.stringify(layout)
}

export const ScriptView: ComponentView = (props: ComponentViewProps): JSX.Element => {
  const items = itemsOf(props.value)
  const [attaching, setAttaching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [editorPath, setEditorPath] = useState<string | null>(null)
  const online = dataLayerAvailable() === true

  const applyItems = (next: ScriptItem[]): void => {
    props.apply(JSON.stringify({ value: next }))
  }

  const addItem = (item: ScriptItem, openEditor: boolean): void => {
    applyItems([...items, item])
    setAttaching(false)
    if (openEditor) setEditorPath(item.path)
  }

  // one click: scaffold a fresh auto-named script and open it in the editor
  const createNew = async (): Promise<void> => {
    setCreating(true)
    setCreateErr(null)
    try {
      const name = await findAvailableName(items.map((it) => it.path))
      const path = buildScriptPath(name)
      const content = getScriptTemplateClass(name)
      await dataLayerSaveFile(path, content)
      addItem({ path, priority: 0, layout: freshLayout(content) }, true)
    } catch (e) {
      setCreateErr(String(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="eui-script-view">
      {!online && (
        <div className="eui-script-note">
          Project file access unavailable (no data-layer) — script files can’t be created or
          edited here.
        </div>
      )}
      {items.map((item, i) => (
        <ScriptEntry
          key={`${item.path}:${i}`}
          item={item}
          onChange={(next) => applyItems(items.map((it, j) => (j === i ? next : it)))}
          onRemove={() => applyItems(items.filter((_, j) => j !== i))}
          onEditCode={() => setEditorPath(item.path)}
          online={online}
          showPriority={items.length > 1}
        />
      ))}
      {items.length === 0 &&
        (attaching ? (
          <AddScriptForm
            existing={items.map((it) => it.path)}
            online={online}
            onCancel={() => setAttaching(false)}
            onAdd={addItem}
          />
        ) : (
          <div className="eui-script-actions">
            <button
              className="eui-btn eui-script-btn"
              disabled={!online || creating}
              onClick={() => void createNew()}
            >
              {creating ? 'Creating…' : '+ Create script'}
            </button>
            <button className="eui-link" disabled={!online} onClick={() => setAttaching(true)}>
              attach existing…
            </button>
          </div>
        ))}
      {createErr !== null && <div className="eui-script-err">{createErr}</div>}
      {editorPath !== null && (
        <ScriptCodeEditor
          path={editorPath}
          onClose={() => setEditorPath(null)}
          onSaved={(content) => {
            // re-parse the saved source and refresh that entry's layout, keeping edited values
            const next = items.map((it) => {
              if (it.path !== editorPath) return it
              const parsed = parseLayout(it.layout) ?? { params: {} }
              const merged = mergeLayout(JSON.parse(freshLayout(content)) as ScriptLayout, parsed)
              return { ...it, layout: JSON.stringify(merged) }
            })
            applyItems(next)
          }}
        />
      )}
    </div>
  )
}

function ScriptEntry(props: {
  item: ScriptItem
  onChange: (item: ScriptItem) => void
  onRemove: () => void
  onEditCode: () => void
  online: boolean
  /** run-order only matters with 2+ scripts — hidden otherwise */
  showPriority: boolean
}): JSX.Element {
  const { item, onChange, onRemove, onEditCode, online, showPriority } = props
  const layout = parseLayout(item.layout)
  const params = Object.entries(layout?.params ?? {})
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // rename = copy to the new path, drop the old file, repoint the component
  const rename = async (newName: string): Promise<void> => {
    const trimmed = newName.trim()
    const newPath = buildScriptPath(trimmed)
    if (trimmed === '' || newPath === item.path) {
      setRenaming(false)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const content = await dataLayerReadFile(item.path)
      await dataLayerSaveFile(newPath, content)
      void dataLayerRemoveFile(item.path).catch(() => {}) // best-effort cleanup
      onChange({ ...item, path: newPath })
      setRenaming(false)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setErr(null)
    try {
      const content = await dataLayerReadFile(item.path)
      const merged = mergeLayout(
        JSON.parse(freshLayout(content)) as ScriptLayout,
        layout ?? { params: {} }
      )
      onChange({ ...item, layout: JSON.stringify(merged) })
    } catch (e) {
      setErr(`could not read ${item.path}: ${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const setParam = (name: string, value: ScriptParam['value']): void => {
    if (layout === undefined) return
    const next: ScriptLayout = {
      ...layout,
      params: { ...layout.params, [name]: { ...layout.params[name], value } }
    }
    onChange({ ...item, layout: JSON.stringify(next) })
  }

  const iconStyle = { width: 20, height: 20 } as const
  return (
    <div className="eui-script-entry">
      <div className="eui-script-head">
        {renaming ? (
          <TextInput
            autoFocus
            defaultValue={(item.path.split('/').pop() ?? '').replace(/\.tsx?$/, '')}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="path" title={item.path}>
            {item.path.split('/').pop()}
          </span>
        )}
        <span className="spacer" />
        <IconButton
          tip="Rename script"
          style={iconStyle}
          disabled={!online || busy}
          onClick={() => setRenaming(true)}
        >
          <IconEdit />
        </IconButton>
        <IconButton tip="Edit code" style={iconStyle} disabled={!online} onClick={onEditCode}>
          <IconCode />
        </IconButton>
        <IconButton
          tip="Re-read params from the file"
          style={iconStyle}
          disabled={!online || busy}
          onClick={() => void refresh()}
        >
          <IconRefresh />
        </IconButton>
        <IconButton tip="Remove script" style={iconStyle} onClick={onRemove}>
          <IconTrash />
        </IconButton>
      </div>
      {params.map(([name, param]) => (
        <ParamField key={name} name={name} param={param} onChange={(v) => setParam(name, v)} />
      ))}
      {params.length === 0 && (
        <div className="eui-script-dim">
          No params — constructor params after <code>src, entity</code> become fields here.
        </div>
      )}
      {showPriority && (
        <div className="eui-prop">
          <span className="plabel" title="Run order across this entity's scripts — higher runs first each frame">
            run order
          </span>
          <div className="pvalue">
            <input
              key={String(item.priority)}
              className="eui-num eui-script-priority"
              type="number"
              defaultValue={item.priority}
              onBlur={(e) => {
                const v = parseFloat(e.target.value)
                if (!Number.isNaN(v) && v !== item.priority) onChange({ ...item, priority: v })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
          </div>
        </div>
      )}
      {layout?.error !== undefined && layout.error !== '' && (
        <div className="eui-script-err">parse error: {layout.error}</div>
      )}
      {err !== null && <div className="eui-script-err">{err}</div>}
    </div>
  )
}

function ParamField(props: {
  name: string
  param: ScriptParam
  onChange: (value: ScriptParam['value']) => void
}): JSX.Element {
  const { name, param, onChange } = props
  return (
    <div className="eui-prop">
      <span className="plabel" title={param.optional === true ? `${name} (optional)` : name}>
        {name}
      </span>
      <div className="pvalue">
        {param.type === 'number' && (
          <input
            key={String(param.value)}
            className="eui-num"
            type="number"
            defaultValue={param.value as number}
            onBlur={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v) && v !== param.value) onChange(v)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        )}
        {param.type === 'string' && (
          <TextInput
            key={String(param.value)}
            defaultValue={param.value as string}
            onBlur={(e) => {
              if (e.target.value !== param.value) onChange(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        )}
        {param.type === 'boolean' && (
          <Toggle checked={param.value === true} onChange={(v) => onChange(v)} />
        )}
        {param.type === 'entity' && (
          <EntityPicker value={Number(param.value)} onChange={(v) => onChange(v)} />
        )}
        {param.type === 'action' && (
          <span
            className="eui-script-dim"
            title="ActionCallback params bridge to the smart-items Actions system, which this editor does not use."
          >
            action callback — unsupported
          </span>
        )}
      </div>
    </div>
  )
}

function EntityPicker(props: { value: number; onChange: (v: number) => void }): JSX.Element {
  const snapshot = useStore(() => state.snapshot)
  const options = Object.keys(snapshot)
    .map(Number)
    .filter((id) => !Number.isNaN(id))
    .sort((a, b) => a - b)
    .map((id) => ({
      value: String(id),
      label: `#${id} ${entityName(snapshot as Snapshot, String(id)) ?? ''}`.trim()
    }))
  if (!options.some((o) => o.value === String(props.value))) {
    options.unshift({ value: String(props.value), label: `#${props.value}` })
  }
  return (
    <Select
      value={String(props.value)}
      options={options}
      onChange={(v) => props.onChange(Number(v))}
      aria-label="entity"
    />
  )
}

// First free "my-script[-N]" name: not attached to this entity and not already
// a file in the project (probed over the data-layer so one click never
// silently attaches an unrelated existing script).
async function findAvailableName(existing: string[]): Promise<string> {
  for (let i = 1; i <= 20; i++) {
    const name = i === 1 ? 'my-script' : `my-script-${i}`
    if (existing.includes(buildScriptPath(name))) continue
    try {
      await dataLayerReadFile(buildScriptPath(name))
    } catch {
      return name
    }
  }
  return `my-script-${Date.now()}`
}

function AddScriptForm(props: {
  existing: string[]
  online: boolean
  onCancel: () => void
  onAdd: (item: ScriptItem, openEditor: boolean) => void
}): JSX.Element {
  const { existing, online, onCancel, onAdd } = props
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '') return
    const path = buildScriptPath(trimmed)
    if (!isScriptFile(path)) {
      setErr('script files must end in .ts or .tsx')
      return
    }
    if (existing.includes(path)) {
      setErr('that script is already on this entity')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      let content: string
      let created = false
      try {
        content = await dataLayerReadFile(path) // attach if the file already exists
      } catch {
        content = getScriptTemplateClass(trimmed)
        await dataLayerSaveFile(path, content)
        created = true
      }
      onAdd({ path, priority: 0, layout: freshLayout(content) }, created)
    } catch (e) {
      setErr(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="eui-script-add">
      <TextInput
        autoFocus
        placeholder="script name (e.g. rotator) or path"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="eui-script-add-hint">
        Attaches <code>{name.trim() !== '' ? buildScriptPath(name.trim()) : 'assets/scene/Scripts/…'}</code>{' '}
        if it exists, or creates it from the template.
      </div>
      {err !== null && <div className="eui-script-err">{err}</div>}
      <div className="eui-script-actions" style={{ justifyContent: 'flex-end' }}>
        <button className="eui-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="eui-btn primary"
          disabled={!online || busy || name.trim() === ''}
          onClick={() => void submit()}
        >
          {busy ? 'Adding…' : 'Add script'}
        </button>
      </div>
    </div>
  )
}

// --- in-app code editor (CodeMirror 6 in a modal overlay) ---

// dev-server watch rebuild is sub-second for typical scenes; wait it out before
// reloading so the engine fetches the NEW bundle, not the one being replaced
const REBUILD_WAIT_MS = 1800

// design-system skin for CM's popups (autocomplete, hover, diagnostics) — the
// stock look clashes with the editor theme. Tokens resolve because the editor
// mounts inside .eui-root.
const editorChrome = EditorView.theme(
  {
    '.cm-tooltip': {
      backgroundColor: 'var(--paper-hi, #1d1c21)',
      border: '1px solid var(--divider)',
      borderRadius: '8px',
      boxShadow: 'var(--shadow-float, 0 8px 24px rgba(0,0,0,.5))',
      color: 'var(--text)',
      overflow: 'hidden'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'inherit',
      fontSize: '12px',
      maxHeight: '260px',
      padding: '4px'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      borderRadius: '6px',
      lineHeight: '1.3'
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'var(--primary-selected, rgba(152,45,226,.25))',
      color: 'var(--text)'
    },
    '.cm-completionLabel': { flex: 'none' },
    '.cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--primary, #a24df1)',
      fontWeight: '700'
    },
    '.cm-completionDetail': {
      marginLeft: 'auto',
      fontStyle: 'normal',
      fontSize: '10.5px',
      color: 'var(--text-3)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '160px'
    },
    '.cm-completionIcon': {
      width: '14px',
      flex: 'none',
      fontSize: '11px',
      opacity: '0.7',
      paddingRight: '0'
    },
    '.cm-tooltip .cm-completionInfo': {
      backgroundColor: 'var(--paper-hi, #1d1c21)',
      border: '1px solid var(--divider)',
      borderRadius: '8px',
      padding: '8px 10px',
      fontSize: '11.5px',
      maxWidth: '440px',
      whiteSpace: 'pre-wrap'
    },
    '.cm-tooltip.cm-tooltip-hover': {
      padding: '8px 10px',
      fontSize: '11.5px',
      maxWidth: '480px',
      whiteSpace: 'pre-wrap',
      fontFamily: 'ui-monospace, monospace'
    },
    '.cm-diagnostic': {
      padding: '6px 8px',
      fontSize: '11.5px',
      borderLeft: 'none',
      borderRadius: '6px'
    },
    '.cm-diagnostic-error': {
      borderLeft: '3px solid var(--danger, #e5726d)'
    },
    '.cm-lintRange-error': {
      backgroundImage: 'none',
      textDecoration: 'underline wavy var(--danger, #e5726d) 1px',
      textUnderlineOffset: '3px'
    }
  },
  { dark: true }
)

function ScriptCodeEditor(props: {
  path: string
  onClose: () => void
  onSaved: (content: string) => void
}): JSX.Element {
  const { path, onClose, onSaved } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>(
    'loading'
  )
  const [message, setMessage] = useState('')
  const dirtyRef = useRef(false)

  const save = async (): Promise<void> => {
    const view = viewRef.current
    if (view === null) return
    const content = view.state.doc.toString()
    setStatus('saving')
    try {
      await dataLayerSaveFile(path, content)
      dirtyRef.current = false
      onSaved(content)
      // scripts are compiled into the scene bundle — restart the scene so the
      // saved code is what actually runs (resuming play if it was playing)
      setMessage('saved — restarting scene with the new code…')
      const wasPlaying = !state.frozen
      await new Promise((r) => setTimeout(r, REBUILD_WAIT_MS))
      await restartScene()
      if (wasPlaying) await uiPlay()
      setStatus('saved')
      setMessage(wasPlaying ? 'saved — scene restarted, new code running' : 'saved — new code runs on ▶ play')
    } catch (e) {
      setStatus('error')
      setMessage(String(e))
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (host === null) return
    void dataLayerReadFile(path)
      .then(async (content) => {
        // best-effort language service — plain editing if types fail to load
        const tsEnv = await createScriptTsEnv(path, content).catch(() => null)
        return { content, tsEnv }
      })
      .then(({ content, tsEnv }) => {
        if (cancelled) return
        // the UI lives in a shadow root — point CM's style injection at it
        const root = host.getRootNode()
        const view = new EditorView({
          parent: host,
          root: root instanceof ShadowRoot ? root : undefined,
          state: EditorState.create({
            doc: content,
            extensions: [
              basicSetup,
              keymap.of([
                {
                  key: 'Mod-s',
                  run: () => {
                    void saveRef.current()
                    return true
                  }
                },
                indentWithTab
              ]),
              javascript({ typescript: true }),
              oneDark,
              editorChrome,
              // fixed-position tooltips escape the modal's overflow clipping
              tooltips({ position: 'fixed' }),
              ...(tsEnv !== null
                ? [
                    tsFacet.of({ env: tsEnv.env, path: tsEnv.path }),
                    tsSync(),
                    tsLinter(),
                    autocompletion({ override: [tsAutocomplete()] }),
                    tsHover()
                  ]
                : []),
              EditorView.updateListener.of((u) => {
                if (u.docChanged) dirtyRef.current = true
              })
            ]
          })
        })
        viewRef.current = view
        setStatus('ready')
        if (tsEnv === null) setMessage('types unavailable — editing without checks')
      })
      .catch((e) => {
        if (cancelled) return
        setStatus('error')
        setMessage(`could not read ${path}: ${String(e)}`)
      })
    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [path])

  const requestClose = (): void => {
    if (dirtyRef.current && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  return (
    <div className="eui-modal-backdrop" onClick={requestClose}>
      <div className="eui-modal eui-script-editor" onClick={(e) => e.stopPropagation()}>
        <div className="eui-modal-head">
          <span className="eui-script-editor-title">{path}</span>
          <span className="spacer" />
          {status === 'loading' && <span className="eui-script-dim">loading…</span>}
          {status === 'saving' && <span className="eui-script-dim">saving…</span>}
          {status === 'saved' && <span className="eui-script-ok">{message}</span>}
          {status === 'error' && <span className="eui-script-err">{message}</span>}
        </div>
        <div className="eui-script-editor-body" ref={hostRef} />
        <div className="eui-modal-foot">
          <Button onClick={requestClose}>Close</Button>
          <Button variant="primary" disabled={status === 'loading'} onClick={() => void save()}>
            Save&ensp;⌘S
          </Button>
        </div>
      </div>
    </div>
  )
}
