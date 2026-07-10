// Bespoke inspector view for the asset-packs::Script editor component (the
// Creator Hub Script component, minus the smart-items Actions/Triggers layer).
// A script entry = { path, priority, layout } where layout is a JSON string of
// { params, actions, error } parsed from the script's constructor signature.
// Scripts are authored in-app: files live in the project (src/scripts) and are
// read/written over the dev server's data-layer RPC; @dcl/sdk-commands picks
// them up from main.composite at build time and runs start()/update(dt).
import { useState } from 'react'
import type { ComponentView, ComponentViewProps } from './types'
import { state, type Snapshot } from '../../../../scene/src/state'
import { entityName } from '../../../../scene/src/custom-components'
import { useStore } from '../../store'
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
import { IconButton, Select, TextInput, Toggle } from '../../ds'
import { IconCode, IconEdit, IconRefresh, IconTrash } from '../../icons'
import { openStudio } from '../ai-store'

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
  const online = dataLayerAvailable() === true

  const applyItems = (next: ScriptItem[]): void => {
    props.apply(JSON.stringify({ value: next }))
  }

  // Refresh a script entry's params after the Studio saves/accepts an edit.
  const refreshSaved = (savedPath: string, content: string): void => {
    applyItems(
      items.map((it) =>
        it.path === savedPath
          ? {
              ...it,
              layout: JSON.stringify(
                mergeLayout(JSON.parse(freshLayout(content)) as ScriptLayout, parseLayout(it.layout) ?? { params: {} })
              )
            }
          : it
      )
    )
  }
  // Open the Script Studio (editor + AI) on a script, listing the entity's scripts as tabs.
  const openEditor = (path: string, filePaths: string[]): void => {
    openStudio(path, filePaths, refreshSaved)
  }

  const addItem = (item: ScriptItem, openEditorAfter: boolean): void => {
    const next = [...items, item]
    applyItems(next)
    setAttaching(false)
    if (openEditorAfter) openEditor(item.path, next.map((it) => it.path))
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
          onEditCode={() => openEditor(item.path, items.map((it) => it.path))}
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
