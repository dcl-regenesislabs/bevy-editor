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
  isRuntimeEntity,
  provenanceBaseline,
  RUNTIME_ENTITY_TIP,
  type Snapshot
} from '@scene/state'
import { entityName, customComponentNames, NAME_COMPONENT } from '@scene/custom-components'
import { isAllowedComponent, SCRIPT_COMPONENT, TRIGGER_AREA } from '@scene/allowed-components'
import { ADMIN_TOOLS_COMPONENT } from './views/admin-tools'
import { GAME_CONFIG_COMPONENT } from '../gameconfig/normalize'
import { FOLDER_COMPONENT } from '../prefabs/format'
import { getComponentView } from './views/registry'
import { restrictionUnmet, getSchema, ensureSchema } from '@scene/schema'
import { uiAddComponent, uiApplyFromSchema, uiApplyStructuredEdits, uiDeleteComponent, uiSetComponentValue } from '../actions/components'
import { useStore } from '../core/store'
import { aiStore, canAskAssistant, prefillAssistant } from './ai-store'
import { formatDelta, codeMovePrompt } from './code-move'
import { IconChevron, IconPlus, IconTrash } from '../icons'
import { PrefabInstanceStrip, SpawnedByStrip } from './prefab-widgets'
import { prefabAssetId } from '../prefabs/provenance'
import { prettyLabel } from './fields'
import { SchemaEditor } from './schema-editor'
import { ShapeEditor } from './shape-editor'
import { TransformEditor } from './transform-editor'

export function InspectorPanel(props: { min: boolean; onToggleMin: () => void }): JSX.Element {
  const activeEntity = useStore(() => state.activeEntity)
  const snapshot = useStore(() => state.snapshot)
  const id = activeEntity
  const [pickerOpen, setPickerOpen] = useState(false)

  // A code-spawned entity is read-only in EDIT mode: nothing about it lands in
  // main.composite (the code recreates it every run), so letting the user type
  // into dead fields only misleads. While PLAYING it stays editable — a runtime
  // tweak there is exactly as legitimate as on any authored entity.
  const frozen = useStore(() => state.frozen)
  const baseline = useStore(() => provenanceBaseline())
  // A code-spawned entity IS editable, stopped or playing — dragging or typing a
  // value is a genuinely useful way to find the one you want. What changes is that
  // the edit can't be saved, so every change raises the same card offering to put
  // it into the code. Inert fields taught nothing and just blocked the workflow.
  const isCode = id !== null && isRuntimeEntity(id, baseline)
  const readOnly = false
  const codeMove = useStore(() => aiStore.codeMove)
  const pendingMove = isCode && codeMove !== null && codeMove.entityId === id ? codeMove.move : null

  const assetId = id === null ? null : prefabAssetId(snapshot[id])
  const all = id !== null ? Object.entries(snapshot[id] ?? {}) : []
  // A folder organizes, it does not place: its Transform is an identity frame
  // that exists only to carry `parent`, the gizmo skips it, and showing the
  // card would invite setting a position the folder is not supposed to have.
  const isFolder = id !== null && snapshot[id]?.[FOLDER_COMPONENT] !== undefined
  // Only show components a creator can meaningfully author. Engine result/state
  // components (loading state, pointer/raycast results, read-only globals) are
  // outputs, not inputs — they only add noise.
  const comps = all.filter(([name]) => !isResultComponent(name) && !(isFolder && name === 'Transform'))
  // Transform first, then the rest alphabetically.
  const sorted = [...comps].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))

  return (
    <div className={`eui-panel eui-right${props.min ? ' min' : ''}`}>
      <div className="eui-panel-head">
        <button
          className={`eui-btn icon eui-panel-min${props.min ? ' min' : ''}`}
          data-tip={props.min ? 'Expand the inspector' : 'Minimize to the title bar'}
          aria-label={props.min ? 'Expand the inspector' : 'Minimize the inspector'}
          onClick={props.onToggleMin}
        >
          <IconChevron />
        </button>
        <div className="eui-head-text">
          <span className="eui-overline">Inspector</span>
          {id === null ? (
            <span className="eui-title dim">Nothing selected</span>
          ) : isCode ? (
            <span className="eui-title dim" data-tip={RUNTIME_ENTITY_TIP}>
              {entityLabel(id)}
            </span>
          ) : (
            <NameEditor entityId={id} />
          )}
        </div>
        {id !== null && (
          <>
            {isRuntimeEntity(id, baseline) && (
              <span className="eui-id-badge code" data-tip={RUNTIME_ENTITY_TIP}>
                code
              </span>
            )}
            <span className="eui-id-badge">#{id}</span>
            {!readOnly && (
              <button
                className={`eui-btn icon ${pickerOpen ? 'active' : ''}`}
                data-tip="Add component"
                onClick={() => setPickerOpen(!pickerOpen)}
              >
                <IconPlus />
              </button>
            )}
          </>
        )}
      </div>
      <div className="eui-panel-body" hidden={props.min}>
        {assetId !== null && id !== null && <PrefabInstanceStrip assetId={assetId} rootId={id} />}
        {id !== null && <SpawnedByStrip hostId={id} />}
        {id === null && <div className="eui-empty">Select an entity to edit it</div>}
        {isCode && pendingMove === null && <div className="eui-ro-note">{RUNTIME_ENTITY_TIP}</div>}
        {pendingMove !== null && (
          <div className="eui-ro-card">
            <div className="eui-ro-delta">{formatDelta(pendingMove)}</div>
            <p className="eui-ro-why">The code puts it back on restart. Change the code to keep it.</p>
            {canAskAssistant() && (
              <button className="eui-ro-action" onClick={() => prefillAssistant(codeMovePrompt(pendingMove))}>
                {pendingMove.fields.length > 0 ? 'Ask the assistant to change it in code' : 'Ask the assistant to move it in code'}
              </button>
            )}
          </div>
        )}
        {id !== null && pickerOpen && !readOnly && (
          <AddComponentPicker entityId={id} onDone={() => setPickerOpen(false)} />
        )}
        <div className={readOnly ? 'eui-ro' : undefined}>
          {id !== null &&
            sorted.map(([name, value]) => (
              <ComponentCard key={name} entityId={id} name={name} value={value} />
            ))}
        </div>
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
  if (name.startsWith('inspector::')) return true // editor tooling state, not authorable
  if (RESULT_EXACT.has(name)) return true
  // result/state outputs end in these; authorable components (States, Counter…)
  // don't, so this is safe
  if (name.endsWith('LoadingState') || name.endsWith('Result')) return true
  return getSchema(name)?.readOnly === true
}

function rank(name: string): number {
  if (name === 'Transform') return 0
  // A zone's volume before what it does; "asset-packs::Script" would otherwise
  // sort ahead of "TriggerArea" and put the behaviour first.
  if (name === TRIGGER_AREA) return 0.5
  // The scene's Game Config is the first thing a creator tunes on entity 0; it
  // belongs right under Transform, ahead of everything alphabetical.
  if (name === GAME_CONFIG_COMPONENT) return 0.25
  return 1
}

// On a zone the raw component names are the wrong labels: "trigger area" is the
// zone itself, and the Script card is where its behaviour lives — including, once
// the detector renders as plain settings, entities with no script of their own yet.
function zoneCardTitle(entityId: string, name: string): string | null {
  if (state.snapshot[entityId]?.[TRIGGER_AREA] === undefined) return null
  if (name === TRIGGER_AREA) return 'Trigger zone'
  if (name === SCRIPT_COMPONENT) return 'Behavior'
  return null
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
  const retitled = zoneCardTitle(entityId, name)

  const View = getComponentView(name)
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
          {retitled === null && ns !== null && <span className="ns">{ns} / </span>}
          {retitled ?? prettyLabel(short)}
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
          ) : View !== undefined && !raw ? (
            <View
              cKey={key}
              entityId={entityId}
              name={name}
              value={value}
              schema={schema}
              commit={commitSchema}
              apply={(json) => {
                void uiSetComponentValue(key, entityId, name, json)
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

// Creator-facing names for components whose wire name is an implementation
// detail (the Script component is "asset-packs::Script" only for Creator Hub
// compatibility — to a creator it's just Script).
const DISPLAY_NAMES: Record<string, string> = {
  [SCRIPT_COMPONENT]: 'Script',
  [ADMIN_TOOLS_COMPONENT]: 'Admin Tools',
  [GAME_CONFIG_COMPONENT]: 'Game Config'
}

export function componentDisplayName(name: string): string {
  return DISPLAY_NAMES[name] ?? name
}

function splitName(name: string): [string | null, string] {
  if (DISPLAY_NAMES[name] !== undefined) return [null, DISPLAY_NAMES[name]]
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
    .filter((n) => isAllowedComponent(n))
    .filter((n) => !existing.has(n))
    .filter((n) => componentDisplayName(n).toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => componentDisplayName(a).localeCompare(componentDisplayName(b)))

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
              {componentDisplayName(n)}
              {hint !== null && <span className="hint">{hint}</span>}
            </div>
          )
        })}
        {all.length === 0 && <div className="eui-empty">no matches</div>}
      </div>
    </div>
  )
}
