import { useState } from 'react'
import {
  state,
  componentKey,
  toggleComponent,
  getDraft,
  setDraft,
  revertDraft,
  entityLabel,
  clearComponentEdits,
  type Snapshot
} from '../../../scene/src/state'
import { entityName, customComponentNames, NAME_COMPONENT } from '../../../scene/src/custom-components'
import { restrictionUnmet, getSchema, ensureSchema } from '../../../scene/src/schema'
import {
  uiSetComponentValue,
  uiAddComponent,
  uiDeleteComponent,
  uiApplyStructuredEdits,
  uiApplyFromSchema
} from '../actions'
import { useStore } from '../store'
import { IconPlus, IconTrash } from '../icons'
import { SchemaEditor, ShapeEditor, TransformEditor, prettyLabel } from './properties'

export function InspectorPanel(): JSX.Element {
  const activeEntity = useStore(() => state.activeEntity)
  const snapshot = useStore(() => state.snapshot)
  const id = activeEntity
  const [pickerOpen, setPickerOpen] = useState(false)

  const all = id !== null ? Object.entries(snapshot[id] ?? {}) : []
  // Only show components a creator can meaningfully author. Engine result/state
  // components (loading state, pointer/raycast results, read-only globals) are
  // outputs, not inputs — they only add noise.
  const comps = all.filter(([name]) => !isResultComponent(name))
  // Transform first, then the rest alphabetically.
  const sorted = [...comps].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))

  return (
    <div className="eui-panel eui-right">
      <div className="eui-panel-head">
        <div className="eui-head-text">
          <span className="eui-overline">Inspector</span>
          {id === null ? (
            <span className="eui-title dim">Nothing selected</span>
          ) : (
            <NameEditor entityId={id} />
          )}
        </div>
        {id !== null && (
          <>
            <span className="eui-id-badge">#{id}</span>
            <button
              className={`eui-btn icon ${pickerOpen ? 'active' : ''}`}
              data-tip="Add component"
              onClick={() => setPickerOpen(!pickerOpen)}
            >
              <IconPlus />
            </button>
          </>
        )}
      </div>
      <div className="eui-panel-body">
        {id === null && <div className="eui-empty">Select an entity to edit it</div>}
        {id !== null && pickerOpen && (
          <AddComponentPicker entityId={id} onDone={() => setPickerOpen(false)} />
        )}
        {id !== null &&
          sorted.map(([name, value]) => (
            <ComponentCard key={name} entityId={id} name={name} value={value} />
          ))}
        {id !== null && comps.length === 0 && (
          <div className="eui-empty">No components on this entity</div>
        )}
      </div>
    </div>
  )
}

// Engine-written outputs the creator can't author — hidden from the inspector.
const RESULT_EXACT = new Set([
  'GltfContainerLoadingState',
  'PointerEventsResult',
  'RaycastResult',
  'VideoEvent',
  'VideoControlState',
  'AvatarEmoteCommand',
  'AvatarEquippedData',
  'EngineInfo',
  'UiCanvasInformation',
  'PrimaryPointerInfo',
  'GltfNodeState'
])
function isResultComponent(name: string): boolean {
  if (name === NAME_COMPONENT) return true // the name is edited in the header
  if (RESULT_EXACT.has(name)) return true
  // result/state outputs end in these; authorable components (States, Counter…)
  // don't, so this is safe
  if (name.endsWith('LoadingState') || name.endsWith('Result')) return true
  return getSchema(name)?.readOnly === true
}

function rank(name: string): number {
  if (name === 'Transform') return 0
  return 1
}

function NameEditor(props: { entityId: string }): JSX.Element {
  const { entityId } = props
  const snapshot = useStore(() => state.snapshot)
  const current = entityName(snapshot as Snapshot, entityId) ?? entityLabel(entityId)
  const hasName = snapshot[entityId]?.[NAME_COMPONENT] !== undefined
  return (
    <input
      key={`${entityId}:${current}`}
      className="eui-name-input"
      defaultValue={current}
      spellCheck={false}
      disabled={!hasName && entityId === '0'}
      data-tip="Entity name — edit and press enter"
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          ;(e.target as HTMLInputElement).value = current
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      onBlur={(e) => {
        const v = e.target.value.trim()
        if (v === '' || v === current) return
        const key = componentKey(entityId, NAME_COMPONENT)
        void uiSetComponentValue(key, entityId, NAME_COMPONENT, JSON.stringify({ value: v }))
      }}
    />
  )
}

function ComponentCard(props: {
  entityId: string
  name: string
  value: unknown
}): JSX.Element {
  const { entityId, name, value } = props
  const expandedComponents = useStore(() => state.expandedComponents)
  const editStatus = useStore(() => state.editStatus)
  const key = componentKey(entityId, name)
  const expanded = expandedComponents.has(key) || name === 'Transform'
  const status = editStatus.get(key) ?? ''
  const [raw, setRaw] = useState(false)

  ensureSchema(name)
  // Subscribe to this component's schema: ensureSchema fetches async, so the
  // fields must re-render when it lands (getSchema reads state.schemas, which is
  // replace-on-write, so the selector value changes from undefined → schema).
  const schema = useStore(() => getSchema(name))
  const readOnly = schema?.readOnly === true || rank(name) === 8

  const [ns, short] = splitName(name)

  const commitSchema = (): void => {
    if (schema !== undefined) void uiApplyFromSchema(key, entityId, name, schema, value)
  }
  const commitShape = (): void => {
    void uiApplyStructuredEdits(key, entityId, name, value)
  }

  return (
    <div className="eui-comp">
      <div
        className={`eui-comp-head ${readOnly ? 'readonly' : ''}`}
        onClick={() => {
          toggleComponent(key)
        }}
      >
        <span className="twisty">{expanded ? '▾' : '▸'}</span>
        <span className="name">
          {ns !== null && <span className="ns">{ns} / </span>}
          {prettyLabel(short)}
        </span>
        <span className="spacer" />
        {expanded && !readOnly && name !== 'Transform' && (
          <button
            className="eui-link"
            onClick={(e) => {
              e.stopPropagation()
              setRaw(!raw)
            }}
          >
            {raw ? 'fields' : 'json'}
          </button>
        )}
        <button
          className="eui-btn icon"
          style={{ width: 20, height: 20 }}
          data-tip="Remove component"
          onClick={(e) => {
            e.stopPropagation()
            uiDeleteComponent(entityId, name)
          }}
        >
          <IconTrash />
        </button>
      </div>
      {expanded && (
        <div className="eui-comp-body">
          {name === 'Transform' && !raw ? (
            <TransformEditor
              entityId={entityId}
              value={(value ?? {}) as Record<string, unknown>}
              apply={(json) => {
                void uiSetComponentValue(key, entityId, 'Transform', json)
              }}
            />
          ) : raw || (!canStructure(value) && schema === undefined) ? (
            <RawEditor cKey={key} entityId={entityId} name={name} value={value} />
          ) : schema !== undefined && !isCustom(name) ? (
            <SchemaEditor cKey={key} schema={schema} value={value} commit={commitSchema} />
          ) : (
            <ShapeEditor cKey={key} value={value} commit={commitShape} />
          )}
          {status !== '' && (
            <div className={`eui-comp-status ${status.startsWith('✓') ? 'ok' : 'err'}`}>{status}</div>
          )}
        </div>
      )}
    </div>
  )
}

function splitName(name: string): [string | null, string] {
  const i = name.indexOf('::')
  return i === -1 ? [null, name] : [name.slice(0, i), name.slice(i + 2)]
}

function isCustom(name: string): boolean {
  return name.includes('::')
}

function canStructure(value: unknown): boolean {
  return value !== null && typeof value === 'object'
}

function RawEditor(props: {
  cKey: string
  entityId: string
  name: string
  value: unknown
}): JSX.Element {
  const { cKey, entityId, name, value } = props
  const drafts = useStore(() => state.drafts)
  const draft = getDraft(cKey, value)
  const dirty = drafts.has(cKey)
  return (
    <>
      <textarea
        className="eui-raw"
        value={pretty(draft)}
        spellCheck={false}
        onChange={(e) => {
          setDraft(cKey, e.target.value)
        }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className="eui-btn primary"
          style={{ height: 22 }}
          onClick={() => void uiSetComponentValue(cKey, entityId, name, getDraft(cKey, value))}
        >
          Apply
        </button>
        <button
          className="eui-btn"
          style={{ height: 22 }}
          disabled={!dirty}
          onClick={() => {
            revertDraft(cKey)
            clearComponentEdits(cKey)
          }}
        >
          Revert
        </button>
      </div>
    </>
  )
}

function pretty(draft: string): string {
  try {
    return JSON.stringify(JSON.parse(draft), null, 2)
  } catch {
    return draft
  }
}

function AddComponentPicker(props: { entityId: string; onDone: () => void }): JSX.Element {
  const snapshot = useStore(() => state.snapshot)
  const componentNames = useStore(() => state.componentNames)
  const [filter, setFilter] = useState('')
  const existing = new Set(Object.keys(snapshot[props.entityId] ?? {}))
  const all = [...new Set([...componentNames, ...customComponentNames()])]
    .filter((n) => !existing.has(n))
    .filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
    .sort()

  return (
    <div className="eui-pop">
      <input
        className="eui-input"
        autoFocus
        placeholder="Add component…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onDone()
        }}
      />
      <div className="eui-pop-list">
        {all.map((n) => {
          const hint = restrictionUnmet(n, props.entityId)
          return (
            <div
              key={n}
              className="eui-pop-item"
              onClick={() => {
                void uiAddComponent(props.entityId, n)
                props.onDone()
              }}
            >
              {n}
              {hint !== null && <span className="hint">{hint}</span>}
            </div>
          )
        })}
        {all.length === 0 && <div className="eui-empty">no matches</div>}
      </div>
    </div>
  )
}
