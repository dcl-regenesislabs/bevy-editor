// Typed property editors. Two modes share the scene's edit model (state.fieldEdits):
//  - schema mode: walks the /component_schema tree (enums, oneofs, channels, ranges)
//  - shape mode:  walks the snapshot value when no schema exists
// Every commit (enter / blur / toggle / select / scrub-release) auto-applies the
// whole component, so there is no Apply button to forget.
import { useRef, useState } from 'react'
import { state, componentKey, deleteFieldEdit, deleteFieldEditsWhere } from '../../../scene/src/state'
import {
  fieldKey,
  joinPath,
  isRecord,
  isColor,
  isVector,
  currentNumberText,
  currentString,
  currentBool,
  setField,
  fieldRev
} from '../../../scene/src/fields'
import {
  type ComponentSchema,
  type SchemaNode,
  type EnumValues,
  activeCase,
  setCase,
  valueAt,
  effectiveDefault
} from '../../../scene/src/schema'
import { useStore } from '../store'

// ---------- shared bits ----------

export type Commit = () => void

function leafText(key: string, path: string, fallback: unknown): string {
  const edit = state.fieldEdits.get(fieldKey(key, path))
  if (typeof edit === 'string') return edit
  if (typeof fallback === 'number') return trimNum(fallback)
  if (typeof fallback === 'string') return fallback
  return ''
}

export function trimNum(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const r = Math.round(n * 1000) / 1000
  return String(Math.abs(r) < 1e-9 ? 0 : r)
}

// uncontrolled input; remounts when the underlying snapshot value changes
// (gizmo drags, applies) but never while the user is typing.
export function NumberField(props: {
  cKey: string
  path: string
  fallback: number
  commit: Commit
  axis?: string
}): JSX.Element {
  const { cKey, path, fallback, commit } = props
  const fieldEdits = useStore(() => state.fieldEdits)
  const text = leafText(cKey, path, fallback)
  const dirty = fieldEdits.has(fieldKey(cKey, path))
  const ref = useRef<HTMLInputElement>(null)

  const onScrub = (e: React.PointerEvent): void => {
    e.preventDefault()
    const start = e.clientX
    const startVal = parseFloat(leafText(cKey, path, fallback)) || 0
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    let moved = false
    const onMove = (ev: PointerEvent): void => {
      moved = true
      const step = ev.shiftKey ? 0.01 : 0.1
      const v = startVal + (ev.clientX - start) * step
      setField(cKey, path, trimNum(v))
      if (ref.current !== null) ref.current.value = trimNum(v)
    }
    const onUp = (): void => {
      target.releasePointerCapture(e.pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      if (moved) commit()
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }

  return (
    <span className="eui-axis">
      {props.axis !== undefined && (
        <span
          className="ax"
          data-tip="drag to scrub · shift for fine"
          onPointerDown={onScrub}
        >
          {props.axis.toUpperCase()}
        </span>
      )}
      <input
        ref={ref}
        key={`${fieldRev(cKey, path)}:${trimNum(fallback)}`}
        className={`eui-num ${dirty ? 'dirty' : ''}`}
        defaultValue={text}
        spellCheck={false}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          setField(cKey, path, e.target.value)
        }}
        onBlur={() => {
          if (state.fieldEdits.has(fieldKey(cKey, path))) commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            deleteFieldEdit(fieldKey(cKey, path))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </span>
  )
}

export function StringField(props: {
  cKey: string
  path: string
  fallback: string
  commit: Commit
}): JSX.Element {
  const { cKey, path, fallback, commit } = props
  return (
    <input
      key={`${fieldRev(cKey, path)}:${fallback}`}
      className="eui-num"
      style={{ fontVariantNumeric: 'normal' }}
      defaultValue={currentString(cKey, path, fallback)}
      spellCheck={false}
      onChange={(e) => setField(cKey, path, e.target.value)}
      onBlur={() => {
        if (state.fieldEdits.has(fieldKey(cKey, path))) commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

export function BoolField(props: {
  cKey: string
  path: string
  fallback: boolean
  commit: Commit
}): JSX.Element {
  const { cKey, path, fallback, commit } = props
  const on = currentBool(cKey, path, fallback)
  return (
    <div
      className={`eui-toggle ${on ? 'on' : ''}`}
      onClick={() => {
        setField(cKey, path, !on)
        commit()
      }}
    />
  )
}

export function ChannelsField(props: {
  cKey: string
  path: string
  channels: string[]
  base: Record<string, unknown> | undefined
  commit: Commit
}): JSX.Element {
  const { cKey, path, channels, base, commit } = props
  return (
    <>
      {channels.map((ch) => (
        <NumberField
          key={ch}
          cKey={cKey}
          path={joinPath(path, ch)}
          fallback={typeof base?.[ch] === 'number' ? (base[ch] as number) : 0}
          commit={commit}
          axis={ch}
        />
      ))}
    </>
  )
}

// color: native picker + alpha when present
export function ColorField(props: {
  cKey: string
  path: string
  base: { r?: number; g?: number; b?: number; a?: number } | undefined
  hasAlpha: boolean
  commit: Commit
}): JSX.Element {
  const { cKey, path, base, hasAlpha, commit } = props
  const cur = (ch: string, fb: number): number => {
    const t = currentNumberText(cKey, joinPath(path, ch), fb)
    const n = parseFloat(t)
    return Number.isNaN(n) ? fb : n
  }
  const r = cur('r', base?.r ?? 1)
  const g = cur('g', base?.g ?? 1)
  const b = cur('b', base?.b ?? 1)
  const hex = `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
  return (
    <>
      <input
        type="color"
        className="eui-color-swatch"
        value={hex}
        onChange={(e) => {
          const v = e.target.value
          setField(cKey, joinPath(path, 'r'), trimNum(parseInt(v.slice(1, 3), 16) / 255))
          setField(cKey, joinPath(path, 'g'), trimNum(parseInt(v.slice(3, 5), 16) / 255))
          setField(cKey, joinPath(path, 'b'), trimNum(parseInt(v.slice(5, 7), 16) / 255))
        }}
        onBlur={commit}
      />
      {hasAlpha && (
        <NumberField cKey={cKey} path={joinPath(path, 'a')} fallback={base?.a ?? 1} commit={commit} axis="a" />
      )}
    </>
  )
}

export function EnumField(props: {
  cKey: string
  path: string
  values: EnumValues
  fallback: number
  commit: Commit
}): JSX.Element {
  const { cKey, path, values, fallback, commit } = props
  const t = currentNumberText(cKey, path, fallback)
  return (
    <select
      className="eui-select"
      value={t}
      onChange={(e) => {
        setField(cKey, path, e.target.value)
        commit()
      }}
    >
      {values.map(([name, num]) => (
        <option key={num} value={String(num)}>
          {name}
        </option>
      ))}
    </select>
  )
}

export function BitmaskField(props: {
  cKey: string
  path: string
  values: EnumValues
  fallback: number
  commit: Commit
}): JSX.Element {
  const { cKey, path, values, fallback, commit } = props
  const cur = parseFloat(currentNumberText(cKey, path, fallback)) || 0
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
      {values
        .filter(([, bit]) => bit !== 0)
        .map(([name, bit]) => {
          const mask = 1 << bit
          const on = (cur & mask) !== 0
          return (
            <label
              key={bit}
              style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11 }}
              onClick={() => {
                setField(cKey, path, String(on ? cur & ~mask : cur | mask))
                commit()
              }}
            >
              <div className={`eui-toggle ${on ? 'on' : ''}`} style={{ transform: 'scale(0.8)' }} />
              {name}
            </label>
          )
        })}
    </div>
  )
}

function Prop(props: { label: string; children: React.ReactNode; title?: string }): JSX.Element {
  return (
    <div className="eui-prop" data-tip={props.title}>
      <span className="plabel">{prettyLabel(props.label)}</span>
      <span className="pvalue">{props.children}</span>
    </div>
  )
}

export function prettyLabel(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
}

// Friendly name for an engine enum entry: strip the short ALL-CAPS prefix
// (MTM_/TAM_/NFT_/…), split glued EASEIN/EASEOUT/EASE easing names, title-case.
// Enum wire values stay numeric — this is display only.
export function prettyEnumName(name: string): string {
  let s = name
  const pre = /^[A-Z0-9]{1,4}_(.+)$/.exec(s)
  if (pre !== null) s = pre[1]
  const ease = /^EASE(IN|OUT)?([A-Z]+)$/.exec(s)
  if (ease !== null) {
    s = ['EASE', ease[1], ease[2]].filter((x): x is string => x !== undefined).join('_')
  }
  return s
    .split('_')
    .map((w) => (w === '' ? w : w[0] + w.slice(1).toLowerCase()))
    .join(' ')
}

// Map an enum's [name, value] pairs to friendly display names (value unchanged).
export function prettyEnumValues(values: EnumValues): EnumValues {
  return values.map(([name, num]): [string, number] => [prettyEnumName(name), num])
}

// ---------- schema-driven editor ----------

const CHANNELS: Record<string, string[]> = {
  color3: ['r', 'g', 'b'],
  color4: ['r', 'g', 'b', 'a'],
  vector2: ['x', 'y'],
  vector3: ['x', 'y', 'z'],
  quaternion: ['x', 'y', 'z', 'w']
}

export function SchemaEditor(props: {
  cKey: string
  schema: ComponentSchema
  value: unknown
  commit: Commit
}): JSX.Element {
  const { cKey, schema, value, commit } = props
  return <SchemaNodeView cKey={cKey} node={schema.root} path="" value={value} enums={schema.enums} commit={commit} label={null} />
}

function SchemaNodeView(props: {
  cKey: string
  node: SchemaNode
  path: string
  value: unknown
  enums: Record<string, EnumValues>
  commit: Commit
  label: string | null
}): JSX.Element | null {
  const { cKey, node, path, value, enums, commit, label } = props

  switch (node.kind) {
    case 'message': {
      const inner = node.fields.map((f) => (
        <SchemaNodeView
          key={f.name}
          cKey={cKey}
          node={f}
          path={joinPath(path, f.name ?? '')}
          value={value}
          enums={enums}
          commit={commit}
          label={f.name ?? ''}
        />
      ))
      if (label === null) return <>{inner}</>
      return (
        <>
          <div className="eui-group-label">{prettyLabel(label)}</div>
          <div className="eui-group">{inner}</div>
        </>
      )
    }
    case 'oneof': {
      const active = activeCase(cKey, path, node, value)
      const c = node.cases.find((x) => x.name === active)
      return (
        <>
          <Prop label={label ?? 'mode'}>
            <select
              className="eui-select"
              value={active ?? ''}
              onChange={(e) => {
                setCase(cKey, path, e.target.value)
                commit()
              }}
            >
              {node.cases.map((x) => (
                <option key={x.name} value={x.name}>
                  {prettyLabel(x.name)}
                </option>
              ))}
            </select>
          </Prop>
          {c !== undefined && (
            <div className="eui-group">
              <SchemaNodeView
                cKey={cKey}
                node={c.field}
                path={joinPath(path, c.name)}
                value={value}
                enums={enums}
                commit={commit}
                label={null}
              />
            </div>
          )}
        </>
      )
    }
    case 'repeated': {
      const cur = valueAt(value, path)
      const arr = Array.isArray(cur) ? cur : []
      return (
        <>
          <div className="eui-group-label">
            {prettyLabel(label ?? 'items')} ({arr.length})
          </div>
          <div className="eui-group">
            {arr.map((_, i) => (
              <SchemaNodeView
                key={i}
                cKey={cKey}
                node={node.element}
                path={joinPath(path, String(i))}
                value={value}
                enums={enums}
                commit={commit}
                label={`#${i}`}
              />
            ))}
            {arr.length === 0 && <div style={{ color: 'hsl(var(--text-3))', fontSize: 11 }}>empty</div>}
          </div>
        </>
      )
    }
    case 'leaf':
      return <SchemaLeaf cKey={cKey} node={node} path={path} value={value} enums={enums} commit={commit} label={label ?? ''} />
  }
}

// Exported for the curated views (views/curated.tsx), which reuse the exact
// leaf semantics (defaults, optionals, channel widgets) and only override
// enums/sliders/masks on top.
export function SchemaLeaf(props: {
  cKey: string
  node: Extract<SchemaNode, { kind: 'leaf' }>
  path: string
  value: unknown
  enums: Record<string, EnumValues>
  commit: Commit
  label: string
  title?: string
}): JSX.Element {
  const { cKey, node, path, value, enums, commit, label } = props
  const sem0 = node.semantic.split(':')[0]
  const cur = valueAt(value, path)
  const def = effectiveDefault(cKey, node)
  const base = cur !== undefined && cur !== null ? cur : def
  const title = props.title ?? node.notes

  const channels = CHANNELS[sem0]
  if (channels !== undefined) {
    const baseObj = isRecord(base) ? base : undefined
    if (sem0 === 'color3' || sem0 === 'color4') {
      return (
        <Prop label={label} title={title}>
          <ColorField cKey={cKey} path={path} base={baseObj as never} hasAlpha={sem0 === 'color4'} commit={commit} />
        </Prop>
      )
    }
    return (
      <Prop label={label} title={title}>
        <ChannelsField cKey={cKey} path={path} channels={channels} base={baseObj} commit={commit} />
      </Prop>
    )
  }

  if (node.enum !== undefined && enums[node.enum] !== undefined) {
    const fb = typeof base === 'number' ? base : 0
    const Field = sem0 === 'bitmask' ? BitmaskField : EnumField
    // enums read as friendly names in every path (wire value stays numeric)
    return (
      <Prop label={label} title={title}>
        <Field cKey={cKey} path={path} values={prettyEnumValues(enums[node.enum])} fallback={fb} commit={commit} />
      </Prop>
    )
  }

  switch (sem0) {
    case 'bool':
      return (
        <Prop label={label} title={title}>
          <BoolField cKey={cKey} path={path} fallback={base === true} commit={commit} />
        </Prop>
      )
    case 'string':
    case 'url':
    case 'urlOrContent':
    case 'contentFile':
    case 'urn':
    case 'userRef':
    case 'gltfNodePath':
    case 'gltfAnimationName':
      return (
        <Prop label={label} title={title}>
          <StringField cKey={cKey} path={path} fallback={typeof base === 'string' ? base : ''} commit={commit} />
        </Prop>
      )
    case 'textureUnion':
    case 'borderRect': {
      // no dedicated widget — edit this leaf as JSON text
      return (
        <Prop label={label} title={title}>
          <StringField
            cKey={cKey}
            path={path}
            fallback={base === undefined ? '' : JSON.stringify(base)}
            commit={commit}
          />
        </Prop>
      )
    }
    default:
      return (
        <Prop label={label} title={title ?? node.semantic}>
          <NumberField cKey={cKey} path={path} fallback={typeof base === 'number' ? base : 0} commit={commit} />
        </Prop>
      )
  }
}

// ---------- shape-driven editor (no schema) ----------

export function ShapeEditor(props: {
  cKey: string
  value: unknown
  commit: Commit
}): JSX.Element {
  return <ShapeNode cKey={props.cKey} path="" value={props.value} commit={props.commit} label={null} />
}

function ShapeNode(props: {
  cKey: string
  path: string
  value: unknown
  commit: Commit
  label: string | null
}): JSX.Element {
  const { cKey, path, value, commit, label } = props

  if (isColor(value)) {
    return (
      <Prop label={label ?? 'color'}>
        <ColorField cKey={cKey} path={path} base={value} hasAlpha={'a' in value} commit={commit} />
      </Prop>
    )
  }
  if (isVector(value)) {
    const v = value as Record<string, unknown>
    const channels = ['x', 'y', 'z', 'w'].filter((c) => c in v)
    return (
      <Prop label={label ?? 'value'}>
        <ChannelsField cKey={cKey} path={path} channels={channels} base={v} commit={commit} />
      </Prop>
    )
  }
  if (Array.isArray(value)) {
    return (
      <>
        <div className="eui-group-label">
          {prettyLabel(label ?? 'items')} ({value.length})
        </div>
        <div className="eui-group">
          {value.map((el, i) => (
            <ShapeNode key={i} cKey={cKey} path={joinPath(path, i)} value={el} commit={commit} label={`#${i}`} />
          ))}
          {value.length === 0 && <div style={{ color: 'hsl(var(--text-3))', fontSize: 11 }}>empty</div>}
        </div>
      </>
    )
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    const inner = entries.map(([k, v]) => (
      <ShapeNode key={k} cKey={cKey} path={joinPath(path, k)} value={v} commit={commit} label={k} />
    ))
    if (label === null) return <>{inner}</>
    return (
      <>
        <div className="eui-group-label">{prettyLabel(label)}</div>
        <div className="eui-group">{inner}</div>
      </>
    )
  }
  if (typeof value === 'number') {
    return (
      <Prop label={label ?? 'value'}>
        <NumberField cKey={cKey} path={path} fallback={value} commit={commit} />
      </Prop>
    )
  }
  if (typeof value === 'boolean') {
    return (
      <Prop label={label ?? 'value'}>
        <BoolField cKey={cKey} path={path} fallback={value} commit={commit} />
      </Prop>
    )
  }
  if (typeof value === 'string') {
    return (
      <Prop label={label ?? 'value'}>
        <StringField cKey={cKey} path={path} fallback={value} commit={commit} />
      </Prop>
    )
  }
  return (
    <Prop label={label ?? 'value'}>
      <span style={{ color: 'hsl(var(--text-3))' }}>{String(value)}</span>
    </Prop>
  )
}

// ---------- dedicated Transform editor (euler degrees, scrubbing) ----------

type V3 = { x: number; y: number; z: number }
type Q = { x: number; y: number; z: number; w: number }

function quatToEuler(q: Q): V3 {
  // ZXY (same convention the SDK's Quaternion.fromEulerDegrees uses)
  const { x, y, z, w } = q
  const sinp = 2 * (w * x - y * z)
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp)
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y))
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z))
  const d = 180 / Math.PI
  return { x: pitch * d, y: yaw * d, z: roll * d }
}

function eulerToQuat(e: V3): Q {
  const r = Math.PI / 360 // half, degrees→radians
  const cx = Math.cos(e.x * r), sx = Math.sin(e.x * r)
  const cy = Math.cos(e.y * r), sy = Math.sin(e.y * r)
  const cz = Math.cos(e.z * r), sz = Math.sin(e.z * r)
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
    w: cx * cy * cz + sx * sy * sz
  }
}

export function TransformEditor(props: {
  entityId: string
  value: Record<string, unknown>
  apply: (json: string) => void
}): JSX.Element {
  const { entityId, value, apply } = props
  const pos = (value.position ?? { x: 0, y: 0, z: 0 }) as V3
  const rotQ = (value.rotation ?? { x: 0, y: 0, z: 0, w: 1 }) as Q
  const scale = (value.scale ?? { x: 1, y: 1, z: 1 }) as V3
  const parent = typeof value.parent === 'number' ? value.parent : 0
  const euler = quatToEuler(rotQ)

  // local edits keyed off the snapshot value; commit builds the full Transform
  const cKey = `${componentKey(entityId, 'Transform')}#t`
  const read = (path: string, fb: number): number => {
    const t = currentNumberText(cKey, path, fb)
    const n = parseFloat(t)
    return Number.isNaN(n) ? fb : n
  }
  const commit = (): void => {
    const e = { x: read('rot.x', euler.x), y: read('rot.y', euler.y), z: read('rot.z', euler.z) }
    const next = {
      position: { x: read('pos.x', pos.x), y: read('pos.y', pos.y), z: read('pos.z', pos.z) },
      rotation: eulerToQuat(e),
      scale: { x: read('scl.x', scale.x), y: read('scl.y', scale.y), z: read('scl.z', scale.z) },
      parent
    }
    // clear local edits; the apply round-trip re-renders from the snapshot
    deleteFieldEditsWhere((k) => k.startsWith(`${cKey}::`))
    apply(JSON.stringify(next))
  }

  const row = (label: string, prefix: string, v: V3): JSX.Element => (
    <Prop label={label}>
      {(['x', 'y', 'z'] as const).map((ax) => (
        <NumberField
          key={ax}
          cKey={cKey}
          path={`${prefix}.${ax}`}
          fallback={v[ax]}
          commit={commit}
          axis={ax}
        />
      ))}
    </Prop>
  )

  return (
    <>
      {row('position', 'pos', pos)}
      {row('rotation °', 'rot', euler)}
      {row('scale', 'scl', scale)}
    </>
  )
}
