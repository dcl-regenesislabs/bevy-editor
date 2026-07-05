// Config-driven curated component views. One renderer walks the engine schema
// like SchemaEditor does, but lays fields out into named groups and overlays
// labels / sliders / collision-layer masks / friendly enum names per dot-path.
// Anything the config doesn't mention still renders after the groups, so schema
// drift never hides data; commits go through the same fieldEdits machinery.
import { Fragment, useRef, useState, type ReactNode } from 'react'
import { state } from '../../../../scene/src/state'
import {
  fieldKey,
  joinPath,
  setField,
  setFieldProgrammatic,
  currentNumberText
} from '../../../../scene/src/fields'
import {
  type SchemaNode,
  type EnumValues,
  activeCase,
  setCase,
  valueAt,
  effectiveDefault
} from '../../../../scene/src/schema'
import { useStore } from '../../store'
import {
  NumberField,
  EnumField,
  SchemaLeaf,
  prettyLabel,
  prettyEnumName,
  type Commit
} from '../properties'
import { useOutsideClose } from '../../ds'
import type { ComponentView, ComponentViewProps } from './types'

type LeafNode = Extract<SchemaNode, { kind: 'leaf' }>
type MessageNode = Extract<SchemaNode, { kind: 'message' }>
type OneofNode = Extract<SchemaNode, { kind: 'oneof' }>

export type SliderSpec = { min: number; max: number; step?: number }
export type MaskBit = { label: string; mask: number }
export type MaskSpec = { bits: MaskBit[]; default?: number }

// Paths are dot-paths from the component root, through message field names and
// oneof case names; numeric (repeated-index) segments normalize to '*' for
// override lookups, so 'states.*.weight' targets every element.
export type ViewConfig = {
  groups?: Array<{ title?: string; fields: string[] }>
  hide?: string[]
  labels?: Record<string, string>
  sliders?: Record<string, SliderSpec>
  enumLabels?: Record<string, Record<number, string>>
  masks?: Record<string, MaskSpec>
  // dot-path → one-line description, shown as a ⓘ tooltip next to the field label
  docs?: Record<string, string>
}

// ColliderLayer bit values (SDK numbering). CL_RESERVED* deliberately omitted.
export const COLLIDER_BITS: MaskBit[] = [
  { label: 'pointer', mask: 1 },
  { label: 'physics', mask: 2 },
  { label: 'player', mask: 4 },
  { label: 'custom 1', mask: 256 },
  { label: 'custom 2', mask: 512 },
  { label: 'custom 3', mask: 1024 },
  { label: 'custom 4', mask: 2048 },
  { label: 'custom 5', mask: 4096 },
  { label: 'custom 6', mask: 8192 },
  { label: 'custom 7', mask: 16384 },
  { label: 'custom 8', mask: 32768 }
]

export function curatedView(cfg: ViewConfig): ComponentView {
  return function Curated(props: ComponentViewProps): JSX.Element {
    return <CuratedBody {...props} cfg={cfg} />
  }
}

export { prettyEnumName }

function normPath(path: string): string {
  return path
    .split('.')
    .map((s) => (/^\d+$/.test(s) ? '*' : s))
    .join('.')
}

type Ctx = {
  cKey: string
  value: unknown
  enums: Record<string, EnumValues>
  commit: Commit
  cfg: ViewConfig
  // configured (grouped or hidden) paths — skipped when met during subtree walks
  skip: Set<string>
}

function CuratedBody(props: ComponentViewProps & { cfg: ViewConfig }): JSX.Element {
  const { cfg, cKey, value, commit, schema } = props
  // oneof switches, slider drags and mask toggles all live in fieldEdits
  useStore(() => state.fieldEdits)

  if (schema === undefined) {
    return (
      <div className="eui-view-loading" style={{ color: 'var(--text-3)', fontSize: 11, padding: '6px 2px' }}>
        loading schema…
      </div>
    )
  }

  const listed = (cfg.groups ?? []).flatMap((g) => g.fields)
  const ctx: Ctx = {
    cKey,
    value,
    enums: schema.enums,
    commit,
    cfg,
    skip: new Set([...listed, ...(cfg.hide ?? [])])
  }

  const groups = (cfg.groups ?? []).map((g, i) => {
    const items = g.fields
      .map((path) => renderPath(ctx, schema.root, path))
      .filter((el): el is JSX.Element => el !== null)
    if (items.length === 0) return null
    if (g.title === undefined) return <Fragment key={i}>{items}</Fragment>
    return (
      <Fragment key={i}>
        <div className="eui-group-label">{g.title}</div>
        <div className="eui-group">{items}</div>
      </Fragment>
    )
  })

  // unconfigured fields render after the groups, in schema order
  const rest =
    schema.root.kind === 'message' ? (
      schema.root.fields.map((f) => {
        const p = f.name ?? ''
        if (ctx.skip.has(p)) return null
        return <CuratedNode key={p} ctx={ctx} node={f} path={p} label={p} entry />
      })
    ) : (
      <CuratedNode ctx={ctx} node={schema.root} path="" label={null} entry />
    )

  return (
    <>
      {groups}
      {rest}
    </>
  )
}

// A configured path resolved against the schema tree. Paths through a oneof use
// the case name as a segment and only render while that case is active.
function resolvePath(
  ctx: Ctx,
  root: SchemaNode,
  path: string
): { node: SchemaNode; inactive: boolean } | null {
  let node = root
  let inactive = false
  let cur = ''
  for (const seg of path.split('.')) {
    if (node.kind === 'message') {
      const f = node.fields.find((x) => x.name === seg)
      if (f === undefined) return null
      node = f
    } else if (node.kind === 'oneof') {
      const c = node.cases.find((x) => x.name === seg)
      if (c === undefined) return null
      if (activeCase(ctx.cKey, cur, node, ctx.value) !== seg) inactive = true
      node = c.field
    } else if (node.kind === 'repeated') {
      node = node.element
    } else {
      return null
    }
    cur = cur === '' ? seg : `${cur}.${seg}`
  }
  return { node, inactive }
}

function renderPath(ctx: Ctx, root: SchemaNode, path: string): JSX.Element | null {
  const r = resolvePath(ctx, root, path)
  if (r === null || r.inactive) return null
  const label = ctx.cfg.labels?.[normPath(path)] ?? path.split('.').pop() ?? path
  return <CuratedNode key={path} ctx={ctx} node={r.node} path={path} label={label} entry />
}

function CuratedNode(props: {
  ctx: Ctx
  node: SchemaNode
  path: string
  label: string | null
  // group entries render even though their own path is in the skip set
  entry?: boolean
}): JSX.Element | null {
  const { ctx, node, path, label } = props
  if (props.entry !== true && ctx.skip.has(normPath(path))) return null
  const effLabel = label === null ? null : ctx.cfg.labels?.[normPath(path)] ?? label

  switch (node.kind) {
    case 'message': {
      const tex = textureOneof(node)
      if (tex !== null) {
        return <TextureUnionField ctx={ctx} oneof={tex} path={path} label={effLabel ?? 'texture'} />
      }
      const inner = node.fields.map((f) => (
        <CuratedNode
          key={f.name}
          ctx={ctx}
          node={f}
          path={joinPath(path, f.name ?? '')}
          label={f.name ?? ''}
        />
      ))
      if (effLabel === null) return <>{inner}</>
      return (
        <>
          <div className="eui-group-label">{prettyLabel(effLabel)}</div>
          <div className="eui-group">{inner}</div>
        </>
      )
    }
    case 'oneof':
      return <OneofView ctx={ctx} node={node} path={path} label={effLabel ?? 'mode'} />
    case 'repeated': {
      const cur = valueAt(ctx.value, path)
      const arr = Array.isArray(cur) ? cur : []
      return (
        <>
          <div className="eui-group-label">
            {prettyLabel(effLabel ?? 'items')} ({arr.length})
          </div>
          <div className="eui-group">
            {arr.map((_, i) => (
              <CuratedNode
                key={i}
                ctx={ctx}
                node={node.element}
                path={joinPath(path, String(i))}
                label={`#${i}`}
              />
            ))}
            {arr.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 11 }}>empty</div>
            )}
          </div>
        </>
      )
    }
    case 'leaf':
      return <CuratedLeaf ctx={ctx} node={node} path={path} label={effLabel ?? ''} />
  }
}

function OneofView(props: {
  ctx: Ctx
  node: OneofNode
  path: string
  label: string
}): JSX.Element {
  const { ctx, node, path, label } = props
  const active = activeCase(ctx.cKey, path, node, ctx.value)
  const c = node.cases.find((x) => x.name === active)
  return (
    <>
      <PropRow label={label} doc={ctx.cfg.docs?.[normPath(path)]}>
        <select
          className="eui-select"
          value={active ?? ''}
          onChange={(e) => {
            setCase(ctx.cKey, path, e.target.value)
            ctx.commit()
          }}
        >
          {node.cases.map((x) => (
            <option key={x.name} value={x.name}>
              {prettyLabel(x.name)}
            </option>
          ))}
        </select>
      </PropRow>
      {c !== undefined && !caseBodyEmpty(ctx, c.field, joinPath(path, c.name)) && (
        <div className="eui-group">
          <CuratedNode ctx={ctx} node={c.field} path={joinPath(path, c.name)} label={null} />
        </div>
      )}
    </>
  )
}

// No box under the selector when the case has nothing to show (empty message, or
// every direct field is laid out in a curated group elsewhere).
function caseBodyEmpty(ctx: Ctx, node: SchemaNode, path: string): boolean {
  if (node.kind !== 'message') return false
  return node.fields.every((f) => ctx.skip.has(normPath(joinPath(path, f.name ?? ''))))
}

function CuratedLeaf(props: {
  ctx: Ctx
  node: LeafNode
  path: string
  label: string
}): JSX.Element {
  const { ctx, node, path, label } = props
  const np = normPath(path)
  const doc = ctx.cfg.docs?.[np]

  const mask = ctx.cfg.masks?.[np]
  if (mask !== undefined) {
    return (
      <PropRow label={label} doc={doc}>
        <MaskField
          cKey={ctx.cKey}
          path={path}
          spec={mask}
          base={leafNumber(ctx, node, path, mask.default ?? 0)}
          commit={ctx.commit}
        />
      </PropRow>
    )
  }

  if (node.enum !== undefined && ctx.enums[node.enum] !== undefined) {
    const overrides = ctx.cfg.enumLabels?.[np]
    const values: EnumValues = ctx.enums[node.enum].map(
      ([name, num]): [string, number] => [overrides?.[num] ?? prettyEnumName(name), num]
    )
    return (
      <PropRow label={label} doc={doc}>
        <EnumField
          cKey={ctx.cKey}
          path={path}
          values={values}
          fallback={leafNumber(ctx, node, path, 0)}
          commit={ctx.commit}
        />
      </PropRow>
    )
  }

  const slider = ctx.cfg.sliders?.[np]
  if (slider !== undefined) {
    return (
      <PropRow label={label} doc={doc}>
        <SliderField
          cKey={ctx.cKey}
          path={path}
          spec={slider}
          fallback={leafNumber(ctx, node, path, slider.min)}
          commit={ctx.commit}
        />
      </PropRow>
    )
  }

  return (
    <SchemaLeaf
      cKey={ctx.cKey}
      node={node}
      path={path}
      value={ctx.value}
      enums={ctx.enums}
      commit={ctx.commit}
      label={label}
      title={doc}
    />
  )
}

function leafNumber(ctx: Ctx, node: LeafNode, path: string, fb: number): number {
  const cur = valueAt(ctx.value, path)
  if (typeof cur === 'number') return cur
  const def = effectiveDefault(ctx.cKey, node)
  return typeof def === 'number' ? def : fb
}

function PropRow(props: { label: string; doc?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="eui-prop">
      <span className="plabel">
        {prettyLabel(props.label)}
        {props.doc !== undefined && (
          <span className="eui-info" data-tip={props.doc}>
            ⓘ
          </span>
        )}
      </span>
      <span className="pvalue">{props.children}</span>
    </div>
  )
}

// slider + number pair over the same leaf edit
function SliderField(props: {
  cKey: string
  path: string
  spec: SliderSpec
  fallback: number
  commit: Commit
}): JSX.Element {
  const { cKey, path, spec, fallback, commit } = props
  const cur = parseFloat(currentNumberText(cKey, path, fallback))
  const v = Number.isNaN(cur) ? fallback : cur
  return (
    <>
      <input
        type="range"
        className="eui-range"
        style={{ flex: '1 1 60px', minWidth: 48, accentColor: 'var(--primary)' }}
        min={spec.min}
        max={spec.max}
        step={spec.step ?? (spec.max - spec.min) / 100}
        value={v}
        // programmatic set: bumps the leaf's rev so the paired NumberField remounts
        onChange={(e) => setFieldProgrammatic(cKey, path, e.target.value)}
        onPointerUp={() => {
          if (state.fieldEdits.has(fieldKey(cKey, path))) commit()
        }}
        onBlur={() => {
          if (state.fieldEdits.has(fieldKey(cKey, path))) commit()
        }}
      />
      <NumberField cKey={cKey} path={path} fallback={fallback} commit={commit} />
    </>
  )
}

// literal-bitmask leaf (schema types these as plain uint) as a compact
// multi-select: a summary button opening a checklist popup — a wall of N toggles
// was unreadable in a narrow panel.
function MaskField(props: {
  cKey: string
  path: string
  spec: MaskSpec
  base: number
  commit: Commit
}): JSX.Element {
  const { cKey, path, spec, base, commit } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useOutsideClose(open, ref, () => setOpen(false))
  const cur = parseFloat(currentNumberText(cKey, path, base))
  const val = Number.isNaN(cur) ? 0 : cur

  const on = spec.bits.filter((b) => (val & b.mask) !== 0)
  const summary =
    on.length === 0 ? 'none' : on.length <= 2 ? on.map((b) => b.label).join(', ') : `${on.length} layers`

  const toggle = (mask: number): void => {
    const isOn = (val & mask) !== 0
    setField(cKey, path, String(isOn ? val & ~mask : val | mask))
    commit()
  }

  return (
    <div className="eui-ms" ref={ref}>
      <button type="button" className="eui-select eui-ms-btn" onClick={() => setOpen((o) => !o)}>
        <span className="eui-ms-summary">{summary}</span>
        <span className="eui-ms-chev">▾</span>
      </button>
      {open && (
        <div className="eui-ms-pop">
          {spec.bits.map((b) => {
            const isOn = (val & b.mask) !== 0
            return (
              <label key={b.mask} className="eui-ms-row" onClick={() => toggle(b.mask)}>
                <div className={`eui-toggle ${isOn ? 'on' : ''}`} style={{ transform: 'scale(0.8)' }} />
                {b.label}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

// The engine emits TextureUnion structurally: a message whose single field is a
// oneof named 'tex' (texture / avatarTexture / videoTexture / uiTexture).
function textureOneof(node: MessageNode): OneofNode | null {
  const f = node.fields.length === 1 ? node.fields[0] : undefined
  return f !== undefined && f.kind === 'oneof' && f.name === 'tex' ? f : null
}

function TextureUnionField(props: {
  ctx: Ctx
  oneof: OneofNode
  path: string
  label: string
}): JSX.Element {
  const { ctx, oneof, path, label } = props
  const opath = joinPath(path, 'tex')
  const active = activeCase(ctx.cKey, opath, oneof, ctx.value)
  const c = oneof.cases.find((x) => x.name === active)
  return (
    <>
      <div className="eui-group-label">{prettyLabel(label)}</div>
      <div className="eui-group">
        <PropRow label="source">
          <select
            className="eui-select"
            value={active ?? ''}
            onChange={(e) => {
              setCase(ctx.cKey, opath, e.target.value)
              ctx.commit()
            }}
          >
            {oneof.cases.map((x) => (
              <option key={x.name} value={x.name}>
                {prettyLabel(x.name)}
              </option>
            ))}
          </select>
        </PropRow>
        {c !== undefined && (
          <CuratedNode ctx={ctx} node={c.field} path={joinPath(opath, c.name)} label={null} />
        )}
      </div>
    </>
  )
}
