import ReactEcs, { Input, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { inputSystem, InputAction } from '@dcl/sdk/ecs'
import {
  state,
  toggleEntity,
  toggleComponent,
  toggleRawMode,
  clearComponentEdits,
  setActiveAction,
  cycleNodeDisplay,
  selectionClick,
  rowElementId,
  entityLabel,
  componentKey,
  getDraft,
  setDraft,
  revertDraft,
  valueJson,
  buildForest,
  type ComponentKey,
  type Forest
} from './state'
import { overlayUi } from './overlay'
import { isWorldScaleNonUniform } from './world-pos'
import { cycleCamMode, orientToAxis } from './free-cam'
import { relationsCameraEntity } from './relations'
import {
  refresh,
  setComponentValue,
  applyStructuredEdits,
  pauseScene,
  stepScene,
  playScene,
  deleteEntity,
  deleteEntityRecursive,
  deleteEntityReparent,
  reparentSelectionToActive,
  clearParentOfSelection,
  selectionHasParented,
  childIdsOf,
  addComponent,
  addEntity,
  deleteComponent,
  saveComposite,
  isLocalScene,
  confirmSaveDialog,
  cancelSaveDialog
} from './inspector'
import { optionForSource, type DiffRow, type DiffSource } from './save-diff'
import { fetchCatalog, importAsset } from './import'
import {
  isColor,
  isVector,
  isRecord,
  joinPath,
  fieldKey,
  currentNumber,
  currentNumberText,
  currentBool,
  currentString,
  setField,
  fieldRev
} from './fields'
import {
  ensureSchema,
  getSchema,
  restrictionUnmet,
  buildFromSchema,
  effectiveDefault,
  transformDefaultKind,
  copyFromTransform,
  valueAt,
  activeCase,
  setCase,
  type ComponentSchema,
  type SchemaNode
} from './schema'
import { entityName, isCustomComponent, customComponentNames } from './custom-components'

const PANEL_BG = Color4.create(0.08, 0.08, 0.1, 0.94)
const HEADER_BG = Color4.create(0.14, 0.14, 0.18, 1)
const ENTITY_BG = Color4.create(1, 1, 1, 0.05)
const VALUE_BG = Color4.create(0, 0, 0, 0.35)
const TEXT = Color4.create(0.9, 0.9, 0.95, 1)
const MUTED = Color4.create(0.6, 0.6, 0.68, 1)
const ACCENT = Color4.create(0.55, 0.78, 1, 1)
const BUTTON_BG = Color4.create(0.25, 0.4, 0.6, 1)
const WARN = Color4.create(1, 0.7, 0.2, 1)

const FS = 14
const ROW_H = FS + 8
const INDENT = 14

function chevron(expanded: boolean): string {
  return expanded ? '▼' : '▶'
}

function statusText(): string {
  switch (state.status) {
    case 'logging-in':
      return 'Logging in...'
    case 'loading-snapshot':
      return 'Loading scene state...'
    case 'no-scene':
      return 'Not standing in an inspectable (non-portable) scene.'
    case 'error':
      return `Error: ${state.error}`
    case 'ready':
      return state.scene !== undefined
        ? `${state.scene.title}  ·  ${state.scene.hash.slice(0, 10)}…${
            state.frozen ? '  ·  PAUSED' : ''
          }`
        : 'ready'
  }
}

// A transport-control button that greys out when disabled.
function pbButton(
  label: string,
  enabled: boolean,
  onClick: () => void
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={`pb-${label}`}
      uiTransform={{
        width: 54,
        height: 22,
        margin: { left: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{
        color: enabled ? BUTTON_BG : Color4.create(0.2, 0.2, 0.24, 1)
      }}
      uiText={{ value: label, fontSize: FS - 2, color: enabled ? TEXT : MUTED }}
      onMouseDown={() => {
        if (enabled) onClick()
      }}
    />
  )
}

function smallButton(
  label: string,
  color: Color4,
  onClick: () => void
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: 64,
        height: 22,
        margin: { right: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color }}
      uiText={{ value: label, fontSize: FS - 2, color: TEXT }}
      onMouseDown={onClick}
    />
  )
}

const REVERT_BG = Color4.create(0.3, 0.3, 0.35, 1)
const TOGGLE_ON = Color4.create(0.28, 0.55, 0.34, 1)
const TOGGLE_OFF = Color4.create(0.45, 0.3, 0.3, 1)
const DANGER = Color4.create(0.55, 0.2, 0.22, 1)
const DANGER_HOVER = Color4.create(0.75, 0.25, 0.27, 1)

const DELETE_HINT =
  'Del: confirm    Shift+Del: reparent children    Ctrl+Del: recursive'

// Dispatch a delete from a row button, honouring held modifiers:
// Ctrl (IA_WALK) = recursive, Shift (IA_MODIFIER) = reparent, else confirm.
function onDeleteClick(entityId: string): void {
  if (inputSystem.isPressed(InputAction.IA_WALK)) {
    deleteEntityRecursive(entityId).catch(console.error)
  } else if (inputSystem.isPressed(InputAction.IA_MODIFIER)) {
    deleteEntityReparent(entityId).catch(console.error)
  } else {
    state.deleteConfirm = entityId
  }
}

function deleteButton(entityId: string): ReactEcs.JSX.Element {
  const hovered = state.hoveredDelete === entityId
  return (
    <UiEntity
      uiTransform={{
        width: 36,
        height: 20,
        margin: { right: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: hovered ? DANGER_HOVER : DANGER }}
      uiText={{ value: 'Del', fontSize: FS - 3, color: TEXT }}
      onMouseEnter={() => {
        state.hoveredDelete = entityId
      }}
      onMouseLeave={() => {
        if (state.hoveredDelete === entityId) state.hoveredDelete = null
      }}
      onMouseDown={() => {
        onDeleteClick(entityId)
      }}
    />
  )
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function elementIdFor(key: string, path: string): string {
  return `inp-${key}-${path}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function fieldLabel(text: string, width: number): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{ width, height: 22, alignItems: 'center' }}
      uiText={{
        value: text,
        fontSize: FS - 1,
        color: MUTED,
        textAlign: 'middle-left'
      }}
    />
  )
}

// Set while rendering a read-only (engine-managed) component's structured editor: widgets bake
// this in at build time — Inputs get `disabled`, click handlers are dropped — so the same editor
// renders, just non-interactive. Safe because a render pass is fully synchronous (set → build →
// reset, no await in between).
let fieldsDisabled = false

// A bare numeric Input bound to a leaf path (free-text; parsed at Apply).
function numberInput(
  key: ComponentKey,
  path: string,
  value: number,
  width: number
): ReactEcs.JSX.Element {
  return (
    // Key on the snapshot value: DCL inputs keep their own text once mounted (and
    // capture it back on the next change), so persisting across an external/tool
    // edit would freeze + dirty the field. Re-mounting on a value change shows the
    // fresh value; the key is stable while typing (snapshot unchanged). The fieldRev
    // suffix lets a programmatic edit (copy/capture) force a re-mount too.
    <Input
      key={`${path}:${value}:${fieldRev(key, path)}`}
      uiTransform={{
        elementId: elementIdFor(key, path),
        width,
        height: 22,
        padding: { left: 4, right: 4 }
      }}
      uiBackground={{ color: VALUE_BG }}
      value={currentNumberText(key, path, value)}
      fontSize={FS - 1}
      color={fieldsDisabled ? MUTED : TEXT}
      textAlign="middle-left"
      font="monospace"
      disabled={fieldsDisabled}
      onChange={(v) => {
        setField(key, path, v)
      }}
    />
  )
}

// A small "<letter> [input]" cell used inside colour/vector rows.
function letteredNumber(
  key: ComponentKey,
  path: string,
  value: number,
  letter: string
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={path}
      uiTransform={{
        width: 86,
        height: 22,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { right: 4 }
      }}
    >
      <UiEntity
        uiTransform={{ width: 12, height: 22, margin: { right: 6 }, alignItems: 'center' }}
        uiText={{
          value: letter,
          fontSize: FS - 1,
          color: MUTED,
          textAlign: 'middle-left'
        }}
      />
      {numberInput(key, path, value, 64)}
    </UiEntity>
  )
}

function numberField(
  key: ComponentKey,
  path: string,
  label: string,
  value: number
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={path}
      uiTransform={{
        width: '100%',
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 2 }
      }}
    >
      {fieldLabel(label, 150)}
      {numberInput(key, path, value, 140)}
    </UiEntity>
  )
}

function stringField(
  key: ComponentKey,
  path: string,
  label: string,
  value: string
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={path}
      uiTransform={{
        width: '100%',
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 2 }
      }}
    >
      {fieldLabel(label, 150)}
      <Input
        key={`${path}:${value}`}
        uiTransform={{
          elementId: elementIdFor(key, path),
          width: 200,
          height: 22,
          padding: { left: 4, right: 4 }
        }}
        uiBackground={{ color: VALUE_BG }}
        value={currentString(key, path, value)}
        fontSize={FS - 1}
        color={fieldsDisabled ? MUTED : TEXT}
        textAlign="middle-left"
        disabled={fieldsDisabled}
        onChange={(v) => {
          setField(key, path, v)
        }}
      />
    </UiEntity>
  )
}

function boolField(
  key: ComponentKey,
  path: string,
  label: string,
  value: boolean
): ReactEcs.JSX.Element {
  const v = currentBool(key, path, value)
  return (
    <UiEntity
      key={path}
      uiTransform={{
        width: '100%',
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 2 }
      }}
    >
      {fieldLabel(label, 150)}
      <UiEntity
        uiTransform={{
          width: 70,
          height: 22,
          alignItems: 'center',
          justifyContent: 'center'
        }}
        uiBackground={{ color: v ? TOGGLE_ON : TOGGLE_OFF }}
        uiText={{ value: v ? 'true' : 'false', fontSize: FS - 2, color: TEXT }}
        onMouseDown={
          fieldsDisabled
            ? undefined
            : () => {
                setField(key, path, !v)
              }
        }
      />
    </UiEntity>
  )
}

function colorField(
  key: ComponentKey,
  path: string,
  label: string,
  value: { r: number; g: number; b: number; a?: number }
): ReactEcs.JSX.Element {
  const r = currentNumber(key, joinPath(path, 'r'), value.r)
  const g = currentNumber(key, joinPath(path, 'g'), value.g)
  const b = currentNumber(key, joinPath(path, 'b'), value.b)
  const hasAlpha = value.a !== undefined
  const a = hasAlpha ? currentNumber(key, joinPath(path, 'a'), value.a as number) : 1

  return (
    <UiEntity
      key={path}
      uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: 4 } }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 22, flexDirection: 'row', alignItems: 'center' }}
      >
        {fieldLabel(label, 150)}
        <UiEntity
          uiTransform={{ width: 40, height: 18 }}
          uiBackground={{
            color: Color4.create(clamp01(r), clamp01(g), clamp01(b), clamp01(a))
          }}
        />
      </UiEntity>
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 24,
          flexDirection: 'row',
          alignItems: 'center',
          margin: { top: 2 }
        }}
      >
        {letteredNumber(key, joinPath(path, 'r'), value.r, 'R')}
        {letteredNumber(key, joinPath(path, 'g'), value.g, 'G')}
        {letteredNumber(key, joinPath(path, 'b'), value.b, 'B')}
        {hasAlpha
          ? letteredNumber(key, joinPath(path, 'a'), value.a as number, 'A')
          : []}
      </UiEntity>
    </UiEntity>
  )
}

function vectorField(
  key: ComponentKey,
  path: string,
  label: string,
  value: Record<string, number>
): ReactEcs.JSX.Element {
  const axes = ['x', 'y', 'z', 'w'].filter((ax) => ax in value)
  return (
    <UiEntity
      key={path}
      uiTransform={{
        width: '100%',
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 2 }
      }}
    >
      {fieldLabel(label, 80)}
      {axes.map((ax) =>
        letteredNumber(key, joinPath(path, ax), value[ax], ax.toUpperCase())
      )}
    </UiEntity>
  )
}

function readonlyField(
  path: string,
  label: string,
  value: unknown
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={path}
      uiTransform={{
        width: '100%',
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 2 }
      }}
    >
      {fieldLabel(label, 150)}
      {/* JSON.stringify(undefined) is undefined, not a string — guard it so a stray
          undefined leaf can't make a UI text value undefined and crash serialization. */}
      {fieldLabel(JSON.stringify(value) ?? 'undefined', 200)}
    </UiEntity>
  )
}

// A labelled, indented group for nested objects/arrays.
function group(
  path: string,
  label: string,
  children: ReactEcs.JSX.Element[]
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={path === '' ? 'root' : path}
      uiTransform={{ width: '100%', flexDirection: 'column' }}
    >
      {label !== '' ? (
        <UiEntity
          uiTransform={{ width: '100%', height: 22, alignItems: 'center' }}
          uiText={{
            value: label,
            fontSize: FS - 1,
            color: ACCENT,
            textAlign: 'middle-left'
          }}
        />
      ) : (
        []
      )}
      <UiEntity
        uiTransform={{
          width: '100%',
          flexDirection: 'column',
          padding: { left: label !== '' ? 10 : 0 }
        }}
      >
        {children}
      </UiEntity>
    </UiEntity>
  )
}

// Recursively render a typed widget for `value`. Colour/vector objects get
// dedicated widgets; other objects/arrays nest; primitives get field editors.
function renderField(
  key: ComponentKey,
  path: string,
  label: string,
  value: unknown
): ReactEcs.JSX.Element {
  if (isColor(value)) return colorField(key, path, label, value)
  if (isVector(value)) {
    return vectorField(key, path, label, value as Record<string, number>)
  }
  if (Array.isArray(value)) {
    return group(
      path,
      `${label} [${value.length}]`,
      value.map((v, i) => renderField(key, joinPath(path, i), String(i), v))
    )
  }
  if (isRecord(value)) {
    return group(
      path,
      label,
      Object.keys(value).map((k) =>
        renderField(key, joinPath(path, k), k, value[k])
      )
    )
  }
  if (typeof value === 'number') return numberField(key, path, label, value)
  if (typeof value === 'boolean') return boolField(key, path, label, value)
  if (typeof value === 'string') return stringField(key, path, label, value)
  return readonlyField(path, label, value)
}

// Raw single-line JSON editor (escape hatch for structural edits).
function rawEditor(
  key: ComponentKey,
  entityId: string,
  name: string,
  value: unknown
): ReactEcs.JSX.Element {
  // Pretty-print the default so the multi-line editor is readable; the draft (if edited) is
  // whatever the user typed. Apply re-parses either way.
  const pretty = JSON.stringify(value, null, 2)
  const draft = state.drafts.get(key) ?? pretty
  const dirty = state.drafts.has(key) && draft !== pretty
  const lines = Math.min(Math.max(draft.split('\n').length, 1), 24)
  return (
    <Input
      key={`raw:${key}:${valueJson(value)}`}
      uiTransform={{
        elementId: `raw-${elementIdFor(key, '')}`,
        width: '100%',
        height: lines * (FS + 6) + 10,
        padding: { left: 4, right: 4 }
      }}
      uiBackground={{ color: VALUE_BG }}
      value={draft}
      fontSize={FS - 1}
      color={dirty ? Color4.create(1, 0.95, 0.6, 1) : TEXT}
      textAlign="top-left"
      font="monospace"
      multiLine
      onChange={(v) => {
        setDraft(key, v)
      }}
      onSubmit={(v) => {
        setComponentValue(key, entityId, name, v).catch(console.error)
      }}
    />
  )
}

// --- schema-driven editor (typed widgets from /component_schema) ---

function numFallback(base: unknown, node: Extract<SchemaNode, { kind: 'leaf' }>): number {
  if (typeof base === 'number') return base
  if (typeof node.default === 'number') return node.default
  return 0
}
function strFallback(base: unknown, node: Extract<SchemaNode, { kind: 'leaf' }>): string {
  if (typeof base === 'string') return base
  if (typeof node.default === 'string') return node.default
  return ''
}
function objFallback(base: unknown, node: Extract<SchemaNode, { kind: 'leaf' }>, axes: string[]): Record<string, number> {
  const src =
    base !== null && typeof base === 'object'
      ? (base as Record<string, unknown>)
      : node.default !== null && typeof node.default === 'object'
        ? (node.default as Record<string, unknown>)
        : {}
  const out: Record<string, number> = {}
  for (const a of axes) out[a] = typeof src[a] === 'number' ? (src[a] as number) : a === 'w' ? 1 : 0
  return out
}

// A short "(unit · min..max · unset)" hint appended to a leaf's label.
function leafHint(node: Extract<SchemaNode, { kind: 'leaf' }>, unset: boolean): string {
  const parts: string[] = []
  const unit = node.semantic.split(':')[1]
  if (unit !== undefined && node.semantic.split(':')[0] === 'number') parts.push(unit)
  if (node.range !== undefined) {
    const { min, max } = node.range
    parts.push(`${min ?? ''}..${max ?? ''}`)
  }
  if (unset) parts.push('unset')
  return parts.length > 0 ? `  (${parts.join(' · ')})` : ''
}

function enumRow(
  schema: ComponentSchema,
  key: ComponentKey,
  path: string,
  label: string,
  enumName: string | undefined,
  fallback: number
): ReactEcs.JSX.Element {
  const vals = (enumName !== undefined ? schema.enums[enumName] : undefined) ?? []
  const cur = currentNumber(key, path, fallback)
  const idx = vals.findIndex(([, n]) => n === cur)
  const display = idx >= 0 ? vals[idx][0] : String(cur)
  // Bake disabled-ness in at build time: the click handlers fire long after the render pass that
  // sets/resets `fieldsDisabled`, so guarding inside `step` (which reads it at call time) wouldn't.
  const disabled = fieldsDisabled
  const step = (dir: number): void => {
    if (vals.length === 0) return
    const next = vals[(idx + dir + vals.length) % vals.length]
    setField(key, path, String(next[1]))
  }
  return (
    <UiEntity
      key={path}
      uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center', margin: { bottom: 2 } }}
    >
      {fieldLabel(label, 150)}
      <UiEntity
        uiTransform={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
        uiBackground={{ color: REVERT_BG }}
        uiText={{ value: '◀', fontSize: FS - 2, color: disabled ? MUTED : TEXT }}
        onMouseDown={disabled ? undefined : () => step(-1)}
      />
      <UiEntity
        uiTransform={{ width: 200, height: 22, alignItems: 'center', justifyContent: 'center', margin: { left: 2, right: 2 } }}
        uiBackground={{ color: VALUE_BG }}
        uiText={{ value: display, fontSize: FS - 2, color: disabled ? MUTED : TEXT }}
        onMouseDown={disabled ? undefined : () => step(1)}
      />
      <UiEntity
        uiTransform={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}
        uiBackground={{ color: REVERT_BG }}
        uiText={{ value: '▶', fontSize: FS - 2, color: disabled ? MUTED : TEXT }}
        onMouseDown={disabled ? undefined : () => step(1)}
      />
    </UiEntity>
  )
}

function bitmaskRow(
  schema: ComponentSchema,
  key: ComponentKey,
  path: string,
  label: string,
  enumName: string | undefined,
  fallback: number
): ReactEcs.JSX.Element {
  const vals = (enumName !== undefined ? schema.enums[enumName] : undefined) ?? []
  const cur = currentNumber(key, path, fallback)
  const flags = vals.filter(([, n]) => n > 0 && (n & (n - 1)) === 0) // power-of-two only
  return (
    <UiEntity
      key={path}
      uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: 2 } }}
    >
      <UiEntity uiTransform={{ width: '100%', height: 22, alignItems: 'center' }}>
        {fieldLabel(label, 300)}
      </UiEntity>
      <UiEntity
        uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', padding: { left: 8 } }}
      >
        {flags.map(([nm, bit]) => {
          const on = (cur & bit) !== 0
          return (
            <UiEntity
              key={nm}
              uiTransform={{ width: 120, height: 22, margin: { right: 4, bottom: 2 }, alignItems: 'center', justifyContent: 'center' }}
              uiBackground={{ color: on ? TOGGLE_ON : TOGGLE_OFF }}
              uiText={{ value: nm, fontSize: FS - 3, color: TEXT }}
              onMouseDown={
                fieldsDisabled
                  ? undefined
                  : () => {
                      setField(key, path, String(cur ^ bit))
                    }
              }
            />
          )
        })}
      </UiEntity>
    </UiEntity>
  )
}

// Raw single-line JSON editor for a composite leaf (textureUnion/borderRect) — PoC.
function rawFieldRow(
  key: ComponentKey,
  path: string,
  label: string,
  base: unknown
): ReactEcs.JSX.Element {
  const fallback = base === undefined ? 'null' : JSON.stringify(base)
  const cur = currentString(key, path, fallback)
  return (
    <UiEntity
      key={path}
      uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center', margin: { bottom: 2 } }}
    >
      {fieldLabel(label, 150)}
      <Input
        key={`${path}:${fallback}`}
        uiTransform={{ elementId: elementIdFor(key, path), width: 200, height: 22, padding: { left: 4, right: 4 } }}
        uiBackground={{ color: VALUE_BG }}
        value={cur}
        fontSize={FS - 1}
        color={fieldsDisabled ? MUTED : TEXT}
        textAlign="middle-left"
        font="monospace"
        disabled={fieldsDisabled}
        onChange={(v) => {
          setField(key, path, v)
        }}
      />
    </UiEntity>
  )
}

// Append a "copy from Transform.<kind>" button under a field seeded from the entity's
// Transform, so its value can capture the entity's current placement on demand.
function withTransformCopy(
  key: ComponentKey,
  path: string,
  rawNode: Extract<SchemaNode, { kind: 'leaf' }>,
  widget: ReactEcs.JSX.Element
): ReactEcs.JSX.Element {
  const kind = transformDefaultKind(rawNode)
  if (kind === null || fieldsDisabled) return widget
  return (
    <UiEntity key={`${path}/wrap`} uiTransform={{ width: '100%', flexDirection: 'column' }}>
      {widget}
      <UiEntity
        uiTransform={{ width: '100%', height: 22, flexDirection: 'row', alignItems: 'center', margin: { bottom: 2 } }}
      >
        {fieldLabel('', 150)}
        <UiEntity
          uiTransform={{ width: 200, height: 20, alignItems: 'center', justifyContent: 'center' }}
          uiBackground={{ color: REVERT_BG }}
          uiText={{ value: `⟵ copy Transform.${kind}`, fontSize: FS - 3, color: TEXT }}
          onMouseDown={() => {
            copyFromTransform(key, path, rawNode)
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}

function schemaLeaf(
  schema: ComponentSchema,
  key: ComponentKey,
  rawNode: Extract<SchemaNode, { kind: 'leaf' }>,
  path: string,
  value: unknown
): ReactEcs.JSX.Element {
  const base = valueAt(value, path)
  // resolve dynamic (@transform.*) defaults so render matches what Apply will write
  const node = { ...rawNode, default: effectiveDefault(key, rawNode) }
  // "unset" = optional, absent/null, and no curated default → Apply writes null (the engine
  // applies its own runtime default). Fields with a curated default show that value instead.
  const unset =
    (base === undefined || base === null) &&
    node.optional === true &&
    node.default === undefined
  const label = (node.name ?? '') + leafHint(node, unset)
  const sem0 = node.semantic.split(':')[0]
  switch (sem0) {
    case 'bool':
      return boolField(key, path, label, typeof base === 'boolean' ? base : node.default === true)
    case 'enum':
      return enumRow(schema, key, path, label, node.enum, numFallback(base, node))
    case 'bitmask':
      return bitmaskRow(schema, key, path, label, node.semantic.split(':')[1], numFallback(base, node))
    case 'color3':
      return colorField(key, path, label, objFallback(base, node, ['r', 'g', 'b']) as { r: number; g: number; b: number })
    case 'color4':
      return colorField(key, path, label, objFallback(base, node, ['r', 'g', 'b', 'a']) as { r: number; g: number; b: number; a: number })
    case 'vector2':
      return vectorField(key, path, label, objFallback(base, node, ['x', 'y']))
    case 'vector3':
      return withTransformCopy(
        key,
        path,
        rawNode,
        vectorField(key, path, label, objFallback(base, node, ['x', 'y', 'z']))
      )
    case 'quaternion':
      return withTransformCopy(
        key,
        path,
        rawNode,
        vectorField(key, path, label, objFallback(base, node, ['x', 'y', 'z', 'w']))
      )
    case 'textureUnion':
    case 'borderRect':
      return rawFieldRow(key, path, label, base ?? node.default)
    case 'string':
    case 'url':
    case 'urlOrContent':
    case 'contentFile':
    case 'urn':
    case 'userRef':
    case 'gltfNodePath':
    case 'gltfAnimationName':
      return stringField(key, path, label, strFallback(base, node))
    default:
      // number / int / uint / entityRef / cameraLayerId
      return numberField(key, path, label, numFallback(base, node))
  }
}

function renderSchemaNode(
  schema: ComponentSchema,
  key: ComponentKey,
  node: SchemaNode,
  path: string,
  value: unknown
): ReactEcs.JSX.Element {
  switch (node.kind) {
    case 'message': {
      const children = node.fields.map((f) =>
        renderSchemaNode(schema, key, f, joinPath(path, f.name ?? ''), value)
      )
      return group(path === '' ? '' : path, path === '' ? '' : (node.name ?? ''), children)
    }
    case 'oneof': {
      const active = activeCase(key, path, node, value)
      const selector = (
        <UiEntity
          key={`${path}/cases`}
          uiTransform={{ width: '100%', flexDirection: 'row', flexWrap: 'wrap', margin: { bottom: 2 } }}
        >
          {fieldLabel(`${node.name ?? ''} (oneof)`, 120)}
          {node.cases.map((c) => (
            <UiEntity
              key={c.name}
              uiTransform={{ width: 96, height: 22, margin: { right: 4, bottom: 2 }, alignItems: 'center', justifyContent: 'center' }}
              uiBackground={{ color: c.name === active ? BUTTON_BG : REVERT_BG }}
              uiText={{ value: c.name, fontSize: FS - 3, color: TEXT }}
              onMouseDown={
                fieldsDisabled
                  ? undefined
                  : () => {
                      setCase(key, path, c.name)
                    }
              }
            />
          ))}
        </UiEntity>
      )
      const activeCaseNode = node.cases.find((c) => c.name === active)
      const body =
        activeCaseNode !== undefined
          ? renderSchemaNode(schema, key, activeCaseNode.field, joinPath(path, active as string), value)
          : []
      return (
        <UiEntity key={path} uiTransform={{ width: '100%', flexDirection: 'column' }}>
          {selector}
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', padding: { left: 10 } }}>
            {body}
          </UiEntity>
        </UiEntity>
      )
    }
    case 'repeated': {
      const arr = valueAt(value, path)
      const items = Array.isArray(arr) ? arr : []
      const children = items.map((_, i) =>
        renderSchemaNode(schema, key, node.element, joinPath(path, String(i)), value)
      )
      const body =
        children.length > 0
          ? children
          : [
              <UiEntity
                key="empty"
                uiTransform={{ width: '100%', height: 20, alignItems: 'center' }}
                uiText={{ value: '(empty — add/remove via Raw for now)', fontSize: FS - 3, color: MUTED, textAlign: 'middle-left' }}
              />
            ]
      return group(path, `${node.name ?? ''} [${items.length}]`, body)
    }
    case 'leaf':
      return schemaLeaf(schema, key, node, path, value)
  }
}

// Editor body for one component: toolbar (Apply / Revert / Raw-Fields / status)
// plus either the structured editor or the raw-JSON input. Read-only (engine-managed) components
// get no toolbar and a disabled pretty-JSON view instead.
function valueRow(
  entityId: string,
  name: string,
  value: unknown,
  readOnly: boolean
): ReactEcs.JSX.Element {
  const key = componentKey(entityId, name)

  if (readOnly) {
    // Same structured editor as a writable component, but no toolbar and every widget disabled
    // (see `fieldsDisabled`). Falls back to the generic field renderer when no schema is available.
    ensureSchema(name)
    const schema = getSchema(name)
    fieldsDisabled = true
    const body =
      schema !== undefined
        ? renderSchemaNode(schema, key, schema.root, '', value)
        : renderField(key, '', '', value)
    fieldsDisabled = false
    return (
      <UiEntity
        key={`${key}/editor`}
        uiTransform={{ width: '100%', margin: { bottom: 6 }, padding: { left: 10 } }}
      >
        {body}
      </UiEntity>
    )
  }

  const raw = state.rawMode.has(key)
  const status = state.editStatus.get(key) ?? ''
  // Pull the typed schema (lazily fetched); when present it drives the field editor.
  ensureSchema(name)
  const schema = state.rawMode.has(key) ? undefined : getSchema(name)

  return (
    <UiEntity
      key={`${key}/editor`}
      uiTransform={{
        width: '100%',
        margin: { bottom: 6 },
        padding: { left: 10 },
        flexDirection: 'column'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 26,
          flexDirection: 'row',
          alignItems: 'center',
          margin: { bottom: 4 }
        }}
      >
        {smallButton('Apply', BUTTON_BG, () => {
          if (raw) {
            setComponentValue(key, entityId, name, getDraft(key, value)).catch(
              console.error
            )
          } else if (schema !== undefined) {
            const built = buildFromSchema(key, schema, value)
            if (built.ok) {
              setComponentValue(key, entityId, name, built.json).catch(console.error)
            } else {
              state.editStatus.set(key, built.error)
            }
          } else {
            applyStructuredEdits(key, entityId, name, value).catch(console.error)
          }
        })}
        {smallButton('Revert', REVERT_BG, () => {
          revertDraft(key)
          clearComponentEdits(key)
        })}
        {smallButton(raw ? 'Fields' : 'Raw', REVERT_BG, () => {
          toggleRawMode(key)
        })}
        <UiEntity
          uiTransform={{ width: 180, height: 22, alignItems: 'center' }}
          uiText={{
            value: status,
            fontSize: FS - 2,
            color: status.startsWith('✓')
              ? Color4.create(0.5, 0.9, 0.5, 1)
              : MUTED,
            textAlign: 'middle-left'
          }}
        />
      </UiEntity>
      {raw
        ? rawEditor(key, entityId, name, value)
        : schema !== undefined
          ? renderSchemaNode(schema, key, schema.root, '', value)
          : renderField(key, '', '', value)}
    </UiEntity>
  )
}

const COMPONENT_BORDER = Color4.create(0.32, 0.36, 0.46, 0.9)
const COMPONENT_BG = Color4.create(0.11, 0.11, 0.15, 1)

// Component grouping/colouring for the component window:
//   core     — core-schema:: (name/tags/network/sync): user-managed scene metadata, top group
//   asset    — asset-packs:: (smart-item behaviour): editable content
//   normal   — writable protocol components
//   readonly — engine-managed protocol components (no scene-write interface): view-only
// inspector:: tooling state (and undecoded numeric ids) is hidden entirely — it's still kept in
// the snapshot and round-tripped on save, just never surfaced here.
type CompCategory = 'core' | 'asset' | 'normal' | 'readonly'

const CORE_COLOR = Color4.create(0.5, 0.85, 0.62, 1) // green
const ASSET_COLOR = Color4.create(0.95, 0.72, 0.42, 1) // amber
const READONLY_COLOR = Color4.create(0.52, 0.54, 0.6, 1) // muted

const CATEGORY_ORDER: Record<CompCategory, number> = {
  core: 0,
  asset: 1,
  normal: 2,
  readonly: 3
}
const CATEGORY_COLOR: Record<CompCategory, Color4> = {
  core: CORE_COLOR,
  asset: ASSET_COLOR,
  normal: ACCENT,
  readonly: READONLY_COLOR
}

function isHiddenComponent(name: string): boolean {
  return name.startsWith('inspector::') || /^\d+$/.test(name)
}

function componentCategory(name: string): CompCategory {
  if (name.startsWith('core-schema::')) return 'core'
  if (name.startsWith('asset-packs::')) return 'asset'
  // protocol: read-only unless the engine reports a scene-write interface for it.
  if (!state.componentNames.includes(name)) return 'readonly'
  return 'normal'
}

// Strip the "namespace::" prefix from custom components for display (core-schema::Name -> Name).
function displayComponentName(name: string): string {
  const i = name.indexOf('::')
  return i >= 0 ? name.slice(i + 2) : name
}

function componentNodes(
  entityId: string,
  components: Record<string, unknown>
): ReactEcs.JSX.Element[] {
  const names = Object.keys(components)
    .filter((n) => !isHiddenComponent(n))
    .sort((a, b) => {
      const order = CATEGORY_ORDER[componentCategory(a)] - CATEGORY_ORDER[componentCategory(b)]
      return order !== 0 ? order : displayComponentName(a).localeCompare(displayComponentName(b))
    })

  const boxes: ReactEcs.JSX.Element[] = []
  for (const name of names) {
    const key = componentKey(entityId, name)
    const expanded = state.expandedComponents.has(key)
    const category = componentCategory(name)
    const readOnly = category === 'readonly'

    const header = (
      <UiEntity
        uiTransform={{ width: '100%', height: ROW_H, flexDirection: 'row', alignItems: 'center' }}
      >
        {/* flexGrow wrapper + an inner definite-width text element, so textAlign actually
            left-aligns (a bare flexGrow uiText centers in DCL). */}
        <UiEntity uiTransform={{ flexGrow: 1, height: ROW_H, padding: { left: 4 } }}>
          <UiEntity
            uiTransform={{ width: '100%', height: ROW_H }}
            uiText={{
              value: `${chevron(expanded)} ${displayComponentName(name)}`,
              fontSize: FS,
              color: CATEGORY_COLOR[category],
              textAlign: 'middle-left'
            }}
            onMouseDown={() => {
              toggleComponent(key)
            }}
          />
        </UiEntity>
        {/* engine-managed components can't be removed, so no Del button */}
        {readOnly ? (
          []
        ) : (
          <UiEntity
            uiTransform={{
              width: 30,
              height: 20,
              margin: { right: 4 },
              alignItems: 'center',
              justifyContent: 'center'
            }}
            uiBackground={{ color: DANGER }}
            uiText={{ value: 'Del', fontSize: FS - 3, color: TEXT }}
            onMouseDown={() => {
              deleteComponent(entityId, name)
            }}
          />
        )}
      </UiEntity>
    )

    // Each component is a bordered card (outer = border colour, inner 1px margin = border width)
    // so it's clear where one component starts and the next begins.
    boxes.push(
      <UiEntity
        key={`box-${key}`}
        uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: 4 } }}
        uiBackground={{ color: COMPONENT_BORDER }}
      >
        <UiEntity
          uiTransform={{
            width: '100%',
            flexDirection: 'column',
            margin: 1,
            padding: { top: 2, bottom: 2 }
          }}
          uiBackground={{ color: COMPONENT_BG }}
        >
          {header}
          {expanded ? valueRow(entityId, name, components[name], readOnly) : []}
        </UiEntity>
      </UiEntity>
    )
  }
  return boxes
}

const ROW_ACTIVE = Color4.create(0.5, 0.4, 0.2, 0.85)
const ROW_SELECTED = Color4.create(0.28, 0.4, 0.55, 0.7)
const ROW_HOVER = Color4.create(0.3, 0.4, 0.5, 0.6)

function rowColor(entityId: string): Color4 {
  if (state.activeEntity === entityId) return ROW_ACTIVE
  if (state.selected.has(entityId)) return ROW_SELECTED
  if (state.hoveredOverlay === entityId) return ROW_HOVER
  return ENTITY_BG
}

// One entity and (when expanded) its components followed by its child entities,
// nested under an indented container. `path` guards against malformed parent
// cycles so rendering can't recurse forever.
function entityNode(
  forest: Forest,
  entityId: string,
  path: Set<string>
): ReactEcs.JSX.Element {
  const components = state.snapshot[entityId] ?? {}
  const childIds = (forest.children.get(entityId) ?? []).filter(
    (c) => !path.has(c)
  )
  const compCount = Object.keys(components).length
  const childCount = childIds.length
  // The chevron now governs only child expansion — components live in the popup
  // window, opened from the component badge.
  const expanded = childCount > 0 && state.expandedEntities.has(entityId)

  const childPath = new Set(path)
  childPath.add(entityId)

  // Prefer the entity's authored name (core-schema::Name) when set, falling back to the id label.
  const named = entityName(state.snapshot, entityId)
  const baseLabel = named !== undefined ? `${named} (${entityId})` : entityLabel(entityId)
  const label = `${baseLabel}${childCount > 0 ? `   ${childCount}▼` : ''}`

  return (
    <UiEntity
      key={`entity-${entityId}`}
      uiTransform={{ width: '100%', flexDirection: 'column' }}
    >
      <UiEntity
        uiTransform={{
          elementId: rowElementId(entityId),
          width: '100%',
          height: ROW_H + 2,
          margin: { bottom: 2 },
          flexDirection: 'row',
          alignItems: 'center'
        }}
        uiBackground={{ color: rowColor(entityId) }}
      >
        <UiEntity
          uiTransform={{ width: 18, height: ROW_H, justifyContent: 'center', alignItems: 'center' }}
          uiText={{ value: childCount > 0 ? chevron(expanded) : '·', fontSize: FS, color: MUTED }}
          onMouseDown={() => {
            if (childCount > 0) toggleEntity(entityId)
          }}
        />
        <UiEntity uiTransform={{ flexGrow: 1, height: ROW_H }}>
          {/* inner definite-width text so textAlign left-aligns (bare flexGrow uiText centers). */}
          <UiEntity
            uiTransform={{ width: '100%', height: ROW_H }}
            uiText={{ value: label, fontSize: FS, color: TEXT, textAlign: 'middle-left' }}
            onMouseDown={() => {
              selectionClick(
                entityId,
                inputSystem.isPressed(InputAction.IA_MODIFIER),
                inputSystem.isPressed(InputAction.IA_WALK)
              )
            }}
          />
        </UiEntity>
        {componentsBadge(entityId, compCount)}
        {Number(entityId) >= 512 ? deleteButton(entityId) : []}
      </UiEntity>
      {expanded && (
        <UiEntity
          uiTransform={{
            width: '100%',
            flexDirection: 'column',
            padding: { left: INDENT }
          }}
        >
          {childIds.map((c) => entityNode(forest, c, childPath))}
        </UiEntity>
      )}
    </UiEntity>
  )
}

// Inline tree badge showing an entity's component count; opens its component
// window. Highlighted while that entity's window is the open one.
function componentsBadge(entityId: string, count: number): ReactEcs.JSX.Element {
  const open = state.componentWindow === entityId
  return (
    <UiEntity
      uiTransform={{
        width: 48,
        height: 20,
        margin: { right: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: open ? BUTTON_BG : VALUE_BG }}
      uiText={{ value: `▦ ${count}`, fontSize: FS - 3, color: open ? TEXT : MUTED }}
      onMouseDown={() => {
        openComponentWindow(entityId)
      }}
    />
  )
}

// Open (or switch) the component window onto an entity, resetting the add picker.
function openComponentWindow(entityId: string): void {
  state.componentWindow = entityId
  state.addComponentOpen = false
  state.addComponentFilter = ''
}

// Reachable-from-roots set, computed independently of expansion so that the
// children of a collapsed entity aren't mistaken for orphans.
function reachable(forest: Forest): Set<string> {
  const seen = new Set<string>()
  const stack = [...forest.roots]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    for (const c of forest.children.get(id) ?? []) stack.push(c)
  }
  return seen
}

function treeBody(): ReactEcs.JSX.Element[] {
  const forest = buildForest(state.snapshot)
  const seen = reachable(forest)
  const orphans = Object.keys(state.snapshot)
    .filter((id) => !seen.has(id))
    .sort((a, b) => Number(a) - Number(b))
  return [...forest.roots, ...orphans].map((id) =>
    entityNode(forest, id, new Set())
  )
}

// Overlay actions. Extend this list to add more world-space tools.
const ACTIONS: Array<{ id: string; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'translate', label: 'Translate' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'scale', label: 'Scale' }
]

// Fullscreen panel showing the gizmo camera's render (composited on top of the
// world). Pointer-transparent for now; the drag handler comes with interaction.
// Fullscreen pass-through panel showing the relations camera (parent/child
// links for the current selection), composited under the gizmo and markers.
function relationsPanel(): ReactEcs.JSX.Element | null {
  if (state.selected.size === 0) return null
  const cam = relationsCameraEntity()
  if (cam === null) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
      uiBackground={{ textureMode: 'stretch', videoTexture: { videoPlayerEntity: cam } }}
    />
  )
}

// Gizmo renders as world-space entities (gizmo.ts); no overlay panel.
function gizmoPanel(): ReactEcs.JSX.Element | null {
  return null
}

function toggleChip(
  key: string,
  label: string,
  onClick: () => void
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={key}
      uiTransform={{
        width: 110,
        height: 22,
        margin: { left: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: REVERT_BG }}
      uiText={{ value: label, fontSize: FS - 2, color: TEXT }}
      onMouseDown={onClick}
    />
  )
}

// Mode-dependent option toggle shown next to the action buttons:
// - Translate: axis orientation (the active entity's local axes vs world axes).
// - Rotate/Scale (with >1 selected): pivot (active entity vs each item's origin).
function modeToggle(): ReactEcs.JSX.Element | [] {
  if (state.activeAction === 'translate' && state.activeEntity !== null) {
    return toggleChip(
      'orient-toggle',
      state.orientGlobal ? 'Orient: Global' : 'Orient: Local',
      () => {
        state.orientGlobal = !state.orientGlobal
      }
    )
  }
  if (
    (state.activeAction === 'rotate' || state.activeAction === 'scale') &&
    state.selected.size > 1
  ) {
    return toggleChip(
      'pivot-toggle',
      state.pivotEach ? 'Pivot: Each' : 'Pivot: Active',
      () => {
        state.pivotEach = !state.pivotEach
      }
    )
  }
  return []
}

// Reparent the whole selection under the active entity. Enabled only when more
// than one entity is selected (there must be an active target plus others).
function parentButton(): ReactEcs.JSX.Element {
  const enabled = state.selected.size > 1
  return (
    <UiEntity
      key="parent-button"
      uiTransform={{
        width: 120,
        height: 22,
        margin: { left: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: enabled ? BUTTON_BG : REVERT_BG }}
      uiText={{
        value: 'Parent → Active',
        fontSize: FS - 2,
        color: enabled ? TEXT : MUTED
      }}
      onMouseDown={() => {
        if (!enabled) return
        // Reparenting under a non-uniformly-scaled target can't preserve world
        // placement (shear) — confirm first; otherwise just do it.
        if (
          state.activeEntity !== null &&
          isWorldScaleNonUniform(state.snapshot, state.activeEntity)
        ) {
          state.parentConfirm = true
        } else {
          reparentSelectionToActive().catch(console.error)
        }
      }}
    />
  )
}

// Detach the selection to root. Enabled when something selected is parented.
function clearParentButton(): ReactEcs.JSX.Element {
  const enabled = state.selected.size >= 1 && selectionHasParented()
  return (
    <UiEntity
      key="clear-parent-button"
      uiTransform={{
        width: 96,
        height: 22,
        margin: { left: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: enabled ? BUTTON_BG : REVERT_BG }}
      uiText={{ value: 'Clear Parent', fontSize: FS - 2, color: enabled ? TEXT : MUTED }}
      onMouseDown={() => {
        if (enabled) clearParentOfSelection().catch(console.error)
      }}
    />
  )
}

const NODE_LABEL: Record<string, string> = {
  always: 'Nodes: All',
  selected: 'Nodes: Selected',
  selecting: 'Nodes: On select'
}

// Cycles the node-display mode (all / selected / only while selecting).
function nodeDisplayButton(): ReactEcs.JSX.Element {
  return toggleChip('node-display', NODE_LABEL[state.nodeDisplay], () => {
    cycleNodeDisplay()
  })
}

// Toggles the parent/child relationship links.
function linksButton(): ReactEcs.JSX.Element {
  return toggleChip('links-toggle', state.showLinks ? 'Links: On' : 'Links: Off', () => {
    state.showLinks = !state.showLinks
  })
}

const GHOST = Color4.create(0, 0, 0, 0)

// Small fixed-width button (the camera axis-orient controls). `ghost` keeps it
// laid out (reserving width) but invisible + inert.
function miniButton(
  key: string,
  label: string,
  enabled: boolean,
  ghost: boolean,
  onClick: () => void
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={key}
      uiTransform={{
        width: 34,
        height: 22,
        margin: { left: 4 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: ghost ? GHOST : REVERT_BG }}
      uiText={{ value: ghost ? '' : label, fontSize: FS - 2, color: enabled ? TEXT : MUTED }}
      onMouseDown={() => {
        if (enabled && !ghost) onClick()
      }}
    />
  )
}

// Free-cam toggle + (when active) buttons to snap the camera onto each world
// axis, framing the active selection.
const AXES: Array<{ label: string; axis: 'x' | 'y' | 'z'; sign: number }> = [
  { label: '+X', axis: 'x', sign: 1 },
  { label: '-X', axis: 'x', sign: -1 },
  { label: '+Y', axis: 'y', sign: 1 },
  { label: '-Y', axis: 'y', sign: -1 },
  { label: '+Z', axis: 'z', sign: 1 },
  { label: '-Z', axis: 'z', sign: -1 }
]
const CAM_LABEL: Record<string, string> = {
  none: 'Camera: Off',
  free: 'Camera: Free',
  target: 'Camera: Target'
}
function cameraModeButton(): ReactEcs.JSX.Element {
  return toggleChip('cam-mode', CAM_LABEL[state.camMode], () => {
    cycleCamMode()
  })
}

// Axis-orient buttons — context for the camera section. Always present (so the
// layout never reflows); ghosted to invisible when no camera mode is active.
function axisButtons(): ReactEcs.JSX.Element[] {
  const ghost = state.camMode === 'none'
  const enabled = !ghost && state.activeEntity !== null
  return AXES.map((a) =>
    miniButton(`axis-${a.label}`, a.label, enabled, ghost, () => {
      orientToAxis(a.axis, a.sign)
    })
  )
}

// Tool section context: the orient/pivot toggle when it applies, else an empty
// placeholder of the same width so the section keeps a constant size.
function toolContext(): ReactEcs.JSX.Element {
  const toggle = modeToggle()
  if (!Array.isArray(toggle)) return toggle
  return (
    <UiEntity key="tool-ctx-ghost" uiTransform={{ width: 110, height: 22, margin: { left: 6 } }} />
  )
}

// A full-height divider separating toolbar sections.
function toolbarDivider(key: string): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={key}
      uiTransform={{ width: 1, height: 46, margin: { left: 8, right: 4 } }}
      uiBackground={{ color: Color4.create(1, 1, 1, 0.18) }}
    />
  )
}

// One toolbar section: a column of a primary row and a context row (the context
// row is always present so all sections — and the panel height — stay constant).
function toolbarSection(
  key: string,
  primary: ReactEcs.JSX.Element[],
  context: ReactEcs.JSX.Element | ReactEcs.JSX.Element[]
): ReactEcs.JSX.Element {
  return (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center' }}>
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: 22 }}>
        {primary}
      </UiEntity>
      <UiEntity
        uiTransform={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          height: 22,
          margin: { top: 4 }
        }}
      >
        {context}
      </UiEntity>
    </UiEntity>
  )
}

// Floating top-centre toolbar: tools, parenting, view, and camera sections, each
// with its context controls aligned beneath it. Kept out of the tree panel so
// its header is free for tree-specific actions.
function controlPanel(): ReactEcs.JSX.Element {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        positionType: 'absolute',
        position: { top: 10, left: 0 },
        flexDirection: 'row',
        justifyContent: 'center',
        pointerFilter: 'none'
      }}
    >
      <UiEntity
        uiTransform={{ flexDirection: 'row', alignItems: 'center', padding: 6 }}
        uiBackground={{ color: PANEL_BG }}
      >
        {toolbarSection('s-tools', ACTIONS.map(actionButton), toolContext())}
        {toolbarDivider('div-1')}
        {toolbarSection('s-parent', [parentButton(), clearParentButton()], [])}
        {toolbarDivider('div-2')}
        {toolbarSection('s-view', [nodeDisplayButton(), linksButton()], [])}
        {toolbarDivider('div-3')}
        {toolbarSection('s-cam', [cameraModeButton()], axisButtons())}
      </UiEntity>
    </UiEntity>
  )
}

// Confirm dialog shown when the parenting target has a non-uniform world scale,
// since the reparented children's world placement can't be preserved.
function parentDialog(): ReactEcs.JSX.Element | null {
  if (!state.parentConfirm) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          position: { top: 0, left: 0 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        onMouseDown={() => {
          state.parentConfirm = false
        }}
      />
      <UiEntity
        uiTransform={{ width: 440, flexDirection: 'column', padding: 16 }}
        uiBackground={{ color: HEADER_BG }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: 26, alignItems: 'center' }}
          uiText={{
            value: '⚠ Non-uniform parent scale',
            fontSize: FS + 2,
            color: WARN,
            textAlign: 'middle-left'
          }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 56, margin: { top: 4, bottom: 8 } }}
          uiText={{
            value:
              "The target's world scale is non-uniform, so the selection's world " +
              'placement (rotation/scale) cannot be preserved on reparent. Proceed anyway?',
            fontSize: FS - 2,
            color: MUTED,
            textAlign: 'top-left'
          }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 30, flexDirection: 'row', alignItems: 'center' }}
        >
          {dialogButton('Reparent anyway', 150, BUTTON_BG, () => {
            state.parentConfirm = false
            reparentSelectionToActive().catch(console.error)
          })}
          {dialogButton('Cancel', 80, REVERT_BG, () => {
            state.parentConfirm = false
          })}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function actionButton(action: {
  id: string
  label: string
}): ReactEcs.JSX.Element {
  const active = state.activeAction === action.id
  return (
    <UiEntity
      key={`action-${action.id}`}
      uiTransform={{
        width: 86,
        height: 22,
        margin: { right: 6 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: active ? BUTTON_BG : REVERT_BG }}
      uiText={{
        value: action.label,
        fontSize: FS - 1,
        color: active ? Color4.create(1, 0.97, 0.7, 1) : TEXT
      }}
      onMouseDown={() => {
        setActiveAction(action.id)
      }}
    />
  )
}

function dialogButton(
  label: string,
  width: number,
  color: Color4,
  onClick: () => void
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={`dlg-${label}`}
      uiTransform={{
        width,
        height: 28,
        margin: { right: 8 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color }}
      uiText={{ value: label, fontSize: FS - 1, color: TEXT }}
      onMouseDown={onClick}
    />
  )
}

// Modal: create a new entity. Prompts for a name; "Add" parents under the scene root, "Add as
// child" (shown only with an active selection) parents under the active entity.
function newEntityDialog(): ReactEcs.JSX.Element | null {
  if (!state.newEntityOpen) return null
  const active = state.activeEntity
  const close = (): void => {
    state.newEntityOpen = false
    state.newEntityName = ''
  }
  const submit = (parent: number): void => {
    addEntity(state.newEntityName.trim(), parent).catch(console.error)
    close()
  }
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          position: { top: 0, left: 0 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        onMouseDown={close}
      />
      <UiEntity
        uiTransform={{ width: 420, height: 150, flexDirection: 'column', padding: 16 }}
        uiBackground={{ color: HEADER_BG }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: 24, alignItems: 'center', margin: { bottom: 8 } }}
          uiText={{ value: 'New Entity', fontSize: FS + 2, color: TEXT, textAlign: 'middle-left' }}
        />
        <Input
          key="new-entity-name"
          uiTransform={{
            elementId: 'new-entity-name',
            width: '100%',
            height: 28,
            margin: { bottom: 12 },
            padding: { left: 4, right: 4 }
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
          value={state.newEntityName}
          placeholder="entity name"
          fontSize={FS - 1}
          color={TEXT}
          textAlign="middle-left"
          onChange={(v) => {
            state.newEntityName = v
          }}
          onSubmit={() => {
            submit(0)
          }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 28, flexDirection: 'row', alignItems: 'center' }}
        >
          {dialogButton('Add', 80, BUTTON_BG, () => {
            submit(0)
          })}
          {active !== null
            ? dialogButton('Add as child', 120, BUTTON_BG, () => {
                submit(Number(active))
              })
            : []}
          {dialogButton('Cancel', 80, REVERT_BG, close)}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// Modal asset-import picker: backdrop + a search box and a scrollable list of catalog assets.
// Clicking an asset imports it (engine fetches+registers its files, the editor instances the
// returned composite) under the scene root. The catalog is fetched lazily when the dialog opens.
function assetPickerDialog(): ReactEcs.JSX.Element | null {
  if (!state.assetPickerOpen) return null
  const close = (): void => {
    state.assetPickerOpen = false
  }
  const filter = state.assetFilter.trim().toLowerCase()
  const matches = state.assetCatalog.filter((a) => {
    if (filter === '') return true
    return (
      a.name.toLowerCase().includes(filter) ||
      a.category.toLowerCase().includes(filter) ||
      a.pack.toLowerCase().includes(filter) ||
      a.tags.some((t) => t.toLowerCase().includes(filter))
    )
  })
  const shown = matches.slice(0, 200)
  const status = state.assetBusy
    ? 'working…'
    : `${matches.length} asset${matches.length === 1 ? '' : 's'}${
        matches.length > shown.length ? ` (showing ${shown.length})` : ''
      }`
  const pick = (id: string, name: string): void => {
    if (state.assetBusy) return
    state.assetBusy = true
    close()
    importAsset(id, 0, name)
      .catch(console.error)
      .then(() => {
        state.assetBusy = false
      })
  }
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          position: { top: 0, left: 0 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        onMouseDown={close}
      />
      <UiEntity
        uiTransform={{ width: 480, height: 460, flexDirection: 'column', padding: 16 }}
        uiBackground={{ color: HEADER_BG }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: 24, alignItems: 'center', margin: { bottom: 8 } }}
          uiText={{ value: 'Import Asset', fontSize: FS + 2, color: TEXT, textAlign: 'middle-left' }}
        />
        <Input
          key="asset-filter"
          uiTransform={{
            elementId: 'asset-filter',
            width: '100%',
            height: 28,
            margin: { bottom: 8 },
            padding: { left: 4, right: 4 }
          }}
          uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
          value={state.assetFilter}
          placeholder="search name / category / pack / tag"
          fontSize={FS - 1}
          color={TEXT}
          textAlign="middle-left"
          onChange={(v) => {
            state.assetFilter = v
          }}
        />
        <UiEntity
          uiTransform={{ width: '100%', height: 18, margin: { bottom: 4 } }}
          uiText={{ value: status, fontSize: FS - 3, color: MUTED, textAlign: 'middle-left' }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 340,
            flexDirection: 'column',
            overflow: 'scroll',
            scrollVisible: 'vertical'
          }}
        >
          {shown.map((a) => (
            <UiEntity
              key={a.id}
              uiTransform={{
                width: '100%',
                height: 32,
                flexDirection: 'row',
                alignItems: 'center',
                padding: { left: 4, right: 6 },
                margin: { bottom: 2 }
              }}
              uiBackground={{ color: BUTTON_BG }}
              onMouseDown={() => {
                pick(a.id, a.name)
              }}
            >
              <UiEntity
                uiTransform={{ width: 26, height: 26, margin: { right: 6 } }}
                uiBackground={
                  a.thumbnail
                    ? { textureMode: 'stretch', texture: { src: a.thumbnail } }
                    : { color: HEADER_BG }
                }
              />
              <UiEntity
                uiTransform={{ width: '100%', height: '100%', alignItems: 'center' }}
                uiText={{
                  value: `${a.name}   ${a.pack} · ${a.category}`,
                  fontSize: FS - 2,
                  color: TEXT,
                  textAlign: 'middle-left'
                }}
              />
            </UiEntity>
          ))}
        </UiEntity>
        <UiEntity
          uiTransform={{ width: '100%', height: 28, flexDirection: 'row', margin: { top: 8 } }}
        >
          {dialogButton('Close', 80, REVERT_BG, close)}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// Modal delete-confirm: backdrop (click to cancel) + a centred box showing the
// entity, its direct children, and the available delete modes.
function deleteDialog(): ReactEcs.JSX.Element | null {
  const id = state.deleteConfirm
  if (id === null) return null
  const children = childIdsOf(id)
  const hasChildren = children.length > 0
  const childList =
    children.slice(0, 12).join(', ') + (children.length > 12 ? ', …' : '')

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          position: { top: 0, left: 0 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        onMouseDown={() => {
          state.deleteConfirm = null
        }}
      />
      <UiEntity
        uiTransform={{ width: 420, flexDirection: 'column', padding: 16 }}
        uiBackground={{ color: HEADER_BG }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: 26, alignItems: 'center' }}
          uiText={{
            value: `Delete ${entityLabel(id)}?`,
            fontSize: FS + 2,
            color: TEXT,
            textAlign: 'middle-left'
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: hasChildren ? 40 : 4,
            margin: { top: 4, bottom: 8 }
          }}
          uiText={
            hasChildren
              ? {
                  value: `${children.length} direct child${
                    children.length === 1 ? '' : 'ren'
                  }: ${childList}`,
                  fontSize: FS - 2,
                  color: MUTED,
                  textAlign: 'top-left'
                }
              : undefined
          }
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 30,
            flexDirection: 'row',
            alignItems: 'center'
          }}
        >
          {hasChildren
            ? [
                dialogButton('Reparent & delete', 150, BUTTON_BG, () => {
                  deleteEntityReparent(id).catch(console.error)
                }),
                dialogButton('Delete recursive', 130, DANGER, () => {
                  deleteEntityRecursive(id).catch(console.error)
                })
              ]
            : dialogButton('Delete', 90, DANGER, () => {
                deleteEntity(id).catch(console.error)
              })}
          {dialogButton('Cancel', 80, REVERT_BG, () => {
            state.deleteConfirm = null
          })}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// --- save diff dialog ---

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// One source option as a toggle button; highlighted when selected.
function sourceButton(
  label: string,
  selected: boolean,
  onClick: () => void
): ReactEcs.JSX.Element {
  return (
    <UiEntity
      key={`src-${label}`}
      uiTransform={{
        width: 50,
        height: 20,
        margin: { right: 4 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
      uiBackground={{ color: selected ? BUTTON_BG : REVERT_BG }}
      uiText={{ value: label, fontSize: FS - 3, color: selected ? TEXT : MUTED }}
      onMouseDown={onClick}
    />
  )
}

function saveDiffRow(
  row: DiffRow,
  selection: Map<string, DiffSource>
): ReactEcs.JSX.Element {
  const key = `${row.entityId}/${row.component}`
  const sel = selection.get(key) ?? row.options[0]
  const chosen = row.cells[sel]
  const valueText = chosen.present ? truncate(JSON.stringify(chosen.value), 64) : '(removed)'
  return (
    <UiEntity
      key={`sdr-${key}`}
      uiTransform={{
        width: '100%',
        height: 24,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { top: 2 },
        padding: { left: 10 }
      }}
    >
      <UiEntity
        uiTransform={{ width: 190, height: 24, alignItems: 'center' }}
        uiText={{ value: row.component, fontSize: FS - 2, color: TEXT, textAlign: 'middle-left' }}
      />
      <UiEntity uiTransform={{ width: 170, height: 24, flexDirection: 'row', alignItems: 'center' }}>
        {row.options.map((opt) =>
          sourceButton(opt, sel === opt, () => {
            selection.set(key, opt)
          })
        )}
      </UiEntity>
      <UiEntity
        uiTransform={{ width: 300, height: 24, alignItems: 'center' }}
        uiText={{ value: valueText, fontSize: FS - 3, color: MUTED, textAlign: 'middle-left' }}
      />
    </UiEntity>
  )
}

function saveDiffEntity(
  entityId: string,
  rows: DiffRow[],
  selection: Map<string, DiffSource>
): ReactEcs.JSX.Element {
  const named = entityName(state.snapshot, entityId)
  const label = named !== undefined ? `${named} (${entityId})` : entityLabel(entityId)
  const massSet = (src: DiffSource): void => {
    for (const row of rows) selection.set(`${row.entityId}/${row.component}`, optionForSource(row, src))
  }
  return (
    <UiEntity
      key={`sde-${entityId}`}
      uiTransform={{ width: '100%', flexDirection: 'column', margin: { bottom: 6 } }}
    >
      <UiEntity
        uiTransform={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center' }}
        uiBackground={{ color: VALUE_BG }}
      >
        <UiEntity
          uiTransform={{ width: 300, height: 24, alignItems: 'center', padding: { left: 4 } }}
          uiText={{ value: label, fontSize: FS - 1, color: ACCENT, textAlign: 'middle-left' }}
        />
        <UiEntity
          uiTransform={{ width: 44, height: 24, alignItems: 'center' }}
          uiText={{ value: 'all:', fontSize: FS - 3, color: MUTED, textAlign: 'middle-right' }}
        />
        {(['initial', 'editor', 'live'] as DiffSource[]).map((src) =>
          sourceButton(src, false, () => {
            massSet(src)
          })
        )}
      </UiEntity>
      {rows.map((row) => saveDiffRow(row, selection))}
    </UiEntity>
  )
}

// Modal: the save diff — every differing (entity, component) grouped by entity, each with an
// initial/editor/live source selector (collapsed on equality), plus per-entity mass-set. Confirm
// writes the composite from the selections.
function saveDialogUi(): ReactEcs.JSX.Element | null {
  const dialog = state.saveDialog
  if (dialog === null) return null
  const { rows, selection } = dialog

  const byEntity = new Map<string, DiffRow[]>()
  for (const row of rows) {
    const list = byEntity.get(row.entityId) ?? []
    list.push(row)
    byEntity.set(row.entityId, list)
  }

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          positionType: 'absolute',
          position: { top: 0, left: 0 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        onMouseDown={() => {
          cancelSaveDialog()
        }}
      />
      <UiEntity
        uiTransform={{ width: 720, height: 520, flexDirection: 'column', padding: 16 }}
        uiBackground={{ color: HEADER_BG }}
      >
        <UiEntity
          uiTransform={{ width: '100%', height: 28, alignItems: 'center', margin: { bottom: 8 } }}
          uiText={{
            value: `Save changes — ${rows.length} component${rows.length === 1 ? '' : 's'} changed`,
            fontSize: FS + 2,
            color: TEXT,
            textAlign: 'middle-left'
          }}
        />
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 420,
            flexDirection: 'column',
            overflow: 'scroll',
            scrollVisible: 'vertical'
          }}
        >
          {[...byEntity.entries()].map(([eid, eRows]) => saveDiffEntity(eid, eRows, selection))}
        </UiEntity>
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 36,
            flexDirection: 'row',
            alignItems: 'center',
            margin: { top: 8 }
          }}
        >
          {dialogButton('Save', 90, BUTTON_BG, () => {
            confirmSaveDialog().catch(console.error)
          })}
          {dialogButton('Cancel', 80, REVERT_BG, () => {
            cancelSaveDialog()
          })}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

// Scrollable, filterable list of addable components (those not already on the
// entity). Falls back to a free-text name input when the catalog is unavailable
// (e.g. an older engine without /component_names).
function addComponentPicker(entityId: string): ReactEcs.JSX.Element {
  const existing = new Set(Object.keys(state.snapshot[entityId] ?? {}))
  const filter = state.addComponentFilter.toLowerCase()
  // Writable protocol components plus the addable custom ones (core-schema/asset-packs); the
  // filter matches either the full or namespace-stripped name. Grouped like the component window:
  // core-schema first, then asset-packs, then protocol.
  const matchesFilter = (n: string): boolean =>
    n.toLowerCase().includes(filter) || displayComponentName(n).toLowerCase().includes(filter)
  const matches = [...state.componentNames, ...customComponentNames()]
    .filter((n) => !existing.has(n) && matchesFilter(n))
    .sort((a, b) => {
      const order = CATEGORY_ORDER[componentCategory(a)] - CATEGORY_ORDER[componentCategory(b)]
      return order !== 0 ? order : displayComponentName(a).localeCompare(displayComponentName(b))
    })
    .slice(0, 100)
  const haveCatalog = state.componentNames.length > 0

  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        flexDirection: 'column',
        padding: 6,
        margin: { bottom: 6 }
      }}
      uiBackground={{ color: VALUE_BG }}
    >
      <Input
        key={`add-filter:${entityId}`}
        uiTransform={{
          elementId: 'add-component-filter',
          width: '100%',
          height: 24,
          margin: { bottom: 4 },
          padding: { left: 4, right: 4 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.5) }}
        value={state.addComponentFilter}
        placeholder={haveCatalog ? 'filter components…' : 'ComponentName (e.g. MeshRenderer)'}
        fontSize={FS - 1}
        color={TEXT}
        textAlign="middle-left"
        onChange={(v) => {
          state.addComponentFilter = v
        }}
        onSubmit={
          haveCatalog
            ? undefined
            : (v) => {
                const name = v.trim()
                if (name !== '') {
                  addComponent(entityId, name).catch(console.error)
                  state.addComponentOpen = false
                  state.addComponentFilter = ''
                }
              }
        }
      />
      {haveCatalog ? (
        <UiEntity
          uiTransform={{
            width: '100%',
            height: 200,
            flexDirection: 'column',
            overflow: 'scroll',
            scrollVisible: 'vertical'
          }}
        >
          {matches.length > 0
            ? matches.map((name) => {
                // Protocol candidates: load the schema (idempotent) so placement/requires are known,
                // then grey out / disable any whose hard restrictions aren't met on this entity.
                // Custom components have no engine schema (and no restrictions) — always selectable.
                if (!isCustomComponent(name)) ensureSchema(name)
                const blocked = restrictionUnmet(name, entityId)
                const display = displayComponentName(name)
                return (
                  <UiEntity
                    key={`add-${name}`}
                    uiTransform={{
                      width: '100%',
                      height: ROW_H,
                      margin: { bottom: 1 },
                      padding: { left: 6 },
                      alignItems: 'center'
                    }}
                    uiBackground={{ color: ENTITY_BG }}
                    uiText={{
                      value: blocked === null ? display : `${display}  ·  ${blocked}`,
                      fontSize: FS - 1,
                      color: blocked === null ? CATEGORY_COLOR[componentCategory(name)] : MUTED,
                      textAlign: 'middle-left'
                    }}
                    onMouseDown={
                      blocked === null
                        ? () => {
                            addComponent(entityId, name).catch(console.error)
                            state.addComponentOpen = false
                            state.addComponentFilter = ''
                          }
                        : undefined
                    }
                  />
                )
              })
            : [
                <UiEntity
                  key="add-none"
                  uiTransform={{ width: '100%', height: ROW_H, padding: { left: 6 }, alignItems: 'center' }}
                  uiText={{ value: 'no matching components', fontSize: FS - 2, color: MUTED, textAlign: 'middle-left' }}
                />
              ]}
        </UiEntity>
      ) : (
        <UiEntity
          uiTransform={{ width: '100%', height: 18, alignItems: 'center' }}
          uiText={{
            value: 'type a component name and press Enter',
            fontSize: FS - 3,
            color: MUTED,
            textAlign: 'middle-left'
          }}
        />
      )}
    </UiEntity>
  )
}

// Floating popup that hosts an entity's components (moved out of the tree). Lets
// you expand/edit each component, delete components, and add new ones.
function componentWindowPanel(): ReactEcs.JSX.Element | null {
  const id = state.componentWindow
  if (id === null) return null
  const components = state.snapshot[id] ?? {}
  const count = Object.keys(components).length

  return (
    <UiEntity
      uiTransform={{
        width: 500,
        height: '92%',
        positionType: 'absolute',
        position: { top: '4%', left: 12 },
        flexDirection: 'column',
        pointerFilter: 'block'
      }}
      uiBackground={{ color: PANEL_BG }}
    >
      {/* Header */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 36,
          flexDirection: 'row',
          alignItems: 'center',
          padding: { left: 10, right: 6 }
        }}
        uiBackground={{ color: HEADER_BG }}
      >
        <UiEntity
          uiTransform={{ flexGrow: 1, height: 22, alignItems: 'center' }}
          uiText={{
            value: `Components · ${entityLabel(id)}`,
            fontSize: FS + 1,
            color: TEXT,
            textAlign: 'middle-left'
          }}
        />
        <UiEntity
          uiTransform={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center' }}
          uiBackground={{ color: REVERT_BG }}
          uiText={{ value: '✕', fontSize: FS, color: TEXT }}
          onMouseDown={() => {
            state.componentWindow = null
          }}
        />
      </UiEntity>

      {/* Add-component control + (when open) the picker */}
      <UiEntity
        uiTransform={{
          width: '100%',
          flexDirection: 'column',
          padding: { left: 6, right: 6, top: 6 }
        }}
      >
        <UiEntity
          uiTransform={{ width: 140, height: 24, alignItems: 'center', justifyContent: 'center' }}
          uiBackground={{ color: state.addComponentOpen ? BUTTON_BG : TOGGLE_ON }}
          uiText={{
            value: state.addComponentOpen ? 'Cancel add' : '+ Add Component',
            fontSize: FS - 2,
            color: TEXT
          }}
          onMouseDown={() => {
            state.addComponentOpen = !state.addComponentOpen
            state.addComponentFilter = ''
          }}
        />
        {state.addComponentOpen ? (
          <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', margin: { top: 6 } }}>
            {addComponentPicker(id)}
          </UiEntity>
        ) : (
          []
        )}
      </UiEntity>

      {/* Component list */}
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          padding: 6,
          overflow: 'scroll',
          scrollVisible: 'both'
        }}
      >
        {count > 0
          ? componentNodes(id, components)
          : [
              <UiEntity
                key="no-components"
                uiTransform={{ width: '100%', height: ROW_H, padding: { left: 4 }, alignItems: 'center' }}
                uiText={{
                  value: 'no components — add one above',
                  fontSize: FS - 1,
                  color: MUTED,
                  textAlign: 'middle-left'
                }}
              />
            ]}
      </UiEntity>
    </UiEntity>
  )
}

export function inspectorUi(): ReactEcs.JSX.Element {
  // Pending jump-to-row target (held briefly by selectEntityInTree, then
  // released so the user can scroll freely).
  const jump = state.jumpTarget ?? undefined

  // Full-screen, pointer-transparent container: the overlay markers sit under
  // the panel (panel is the later sibling, so it draws on top).
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        pointerFilter: 'none'
      }}
    >
      {relationsPanel() ?? []}
      {overlayUi() ?? []}
      {gizmoPanel() ?? []}
      {/* The host-page React app is the one and only editor UI; the scene
          renders just the viewport layers above (badges, links, gizmo). */}
    </UiEntity>
  )
}
