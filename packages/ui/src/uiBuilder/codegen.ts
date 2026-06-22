// Tree → React-ECS JSX. `emitJsx` produces just the element tree (used by the
// AST round-trip save, spliced into the original source); `generateTsx` wraps it
// in a full component (used by "Generate .tsx" for a new file). Field names/value
// shapes mirror @dcl/react-ecs props, so this is near-direct serialization. Any
// field with an expression (node.exprs[field]) is emitted verbatim — that's how
// props and dynamic values round-trip.
import type { UiNode, Rgba, Dim, Sides, Radius, SideColors } from './model'

const r3 = (n: number): string => String(Math.round(n * 1000) / 1000)
const color = (c: Rgba): string => `Color4.create(${r3(c.r)}, ${r3(c.g)}, ${r3(c.b)}, ${r3(c.a)})`
const quote = (v?: string): string | null => (v === undefined ? null : `'${v}'`)
const numlit = (v?: number): string | null => (v === undefined ? null : String(v))
const boollit = (v?: boolean): string | null => (v === undefined ? null : String(v))

function dimVal(d?: Dim): string | null {
  if (!d || d.value === undefined) return null
  return d.unit === '%' ? `'${d.value}%'` : String(d.value)
}

// padding/margin/position/borderWidth → a single number when all four sides match,
// else an object of the present sides.
function sidesVal(s?: Sides): string | null {
  if (!s) return null
  const keys = (['top', 'right', 'bottom', 'left'] as const).filter((k) => s[k] !== undefined)
  if (keys.length === 0) return null
  const vals = keys.map((k) => s[k] as number)
  if (keys.length === 4 && vals.every((v) => v === vals[0])) return String(vals[0])
  return `{ ${keys.map((k) => `${k}: ${s[k]}`).join(', ')} }`
}

function radiusVal(r?: Radius): string | null {
  if (!r) return null
  const keys = (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).filter((k) => r[k] !== undefined)
  if (keys.length === 0) return null
  const vals = keys.map((k) => r[k] as number)
  if (keys.length === 4 && vals.every((v) => v === vals[0])) return String(vals[0])
  return `{ ${keys.map((k) => `${k}: ${r[k]}`).join(', ')} }`
}

function sideColorsVal(c?: SideColors): string | null {
  if (!c) return null
  const keys = (['top', 'right', 'bottom', 'left'] as const).filter((k) => c[k] !== undefined)
  if (keys.length === 0) return null
  return `{ ${keys.map((k) => `${k}: ${color(c[k] as Rgba)}`).join(', ')} }`
}

function textureSlicesVal(s?: Sides): string | null {
  if (!s) return null
  const keys = (['top', 'right', 'bottom', 'left'] as const).filter((k) => s[k] !== undefined)
  if (keys.length === 0) return null
  return `{ ${keys.map((k) => `${k}: ${r3(s[k] as number)}`).join(', ')} }`
}

// emit `key: <expr or literal>` into `out` when a value is present
function field(out: string[], n: UiNode, key: string, literal: string | null): void {
  const v = n.exprs[key] ?? literal
  if (v !== null && v !== undefined) out.push(`${key}: ${v}`)
}

function transformObj(n: UiNode): string | null {
  const o: string[] = []
  field(o, n, 'display', quote(n.display))
  field(o, n, 'flexDirection', quote(n.flexDirection))
  field(o, n, 'justifyContent', quote(n.justifyContent))
  field(o, n, 'alignItems', quote(n.alignItems))
  field(o, n, 'alignContent', quote(n.alignContent))
  field(o, n, 'alignSelf', quote(n.alignSelf))
  field(o, n, 'flexWrap', quote(n.flexWrap))
  field(o, n, 'overflow', quote(n.overflow))
  field(o, n, 'pointerFilter', quote(n.pointerFilter))
  field(o, n, 'flexGrow', numlit(n.flexGrow))
  field(o, n, 'flexShrink', numlit(n.flexShrink))
  field(o, n, 'flexBasis', numlit(n.flexBasis))
  field(o, n, 'width', dimVal(n.width))
  field(o, n, 'height', dimVal(n.height))
  field(o, n, 'minWidth', dimVal(n.minWidth))
  field(o, n, 'maxWidth', dimVal(n.maxWidth))
  field(o, n, 'minHeight', dimVal(n.minHeight))
  field(o, n, 'maxHeight', dimVal(n.maxHeight))
  field(o, n, 'padding', sidesVal(n.padding))
  field(o, n, 'margin', sidesVal(n.margin))
  field(o, n, 'positionType', quote(n.positionType))
  field(o, n, 'position', sidesVal(n.position))
  field(o, n, 'borderWidth', sidesVal(n.borderWidth))
  field(o, n, 'borderColor', sideColorsVal(n.borderColor))
  field(o, n, 'borderRadius', radiusVal(n.borderRadius))
  field(o, n, 'opacity', numlit(n.opacity))
  field(o, n, 'zIndex', numlit(n.zIndex))
  field(o, n, 'elementId', quote(n.elementId))
  return o.length ? `{ ${o.join(', ')} }` : null
}

function backgroundObj(n: UiNode): string | null {
  if (n.kind === 'image' && (n.src !== undefined || n.exprs.src)) {
    const o: string[] = []
    o.push(`texture: { src: ${n.exprs.src ?? quote(n.src ?? '')} }`)
    field(o, n, 'textureMode', quote(n.textureMode ?? 'stretch'))
    const slices = textureSlicesVal(n.textureSlices)
    if (n.exprs.textureSlices ?? slices) o.push(`textureSlices: ${n.exprs.textureSlices ?? slices}`)
    if (n.exprs.uvs ?? (n.uvs && n.uvs.length === 8)) o.push(`uvs: ${n.exprs.uvs ?? `[${n.uvs!.map(r3).join(', ')}]`}`)
    return `{ ${o.join(', ')} }`
  }
  const c = n.exprs.background ?? (n.background ? color(n.background) : null)
  return c ? `{ color: ${c} }` : null
}

function attrLines(n: UiNode, extra: Array<[string, string | null]>): string[] {
  const attrs: string[] = []
  const tf = transformObj(n)
  if (tf) attrs.push(`uiTransform={${tf}}`)
  const bg = backgroundObj(n)
  if (bg) attrs.push(`uiBackground={${bg}}`)
  for (const [k, v] of extra) if (v !== null && v !== undefined) attrs.push(`${k}={${v}}`)
  return attrs
}

function labelChild(n: UiNode, indent: string): string {
  const a: string[] = []
  a.push(`value={${n.exprs.text ?? quote(n.text ?? '') ?? "''"}}`)
  const add = (k: string, v: string | null): void => {
    if (v !== null && v !== undefined) a.push(`${k}={${v}}`)
  }
  add('fontSize', n.exprs.fontSize ?? numlit(n.fontSize))
  add('color', n.exprs.color ?? (n.color ? color(n.color) : null))
  add('font', n.exprs.font ?? quote(n.font))
  add('textAlign', n.exprs.textAlign ?? quote(n.textAlign))
  add('textWrap', n.exprs.textWrap ?? quote(n.textWrap === undefined ? undefined : n.textWrap ? 'wrap' : 'nowrap'))
  add('outlineWidth', n.exprs.outlineWidth ?? numlit(n.outlineWidth))
  add('outlineColor', n.exprs.outlineColor ?? (n.outlineColor ? color(n.outlineColor) : null))
  return `${indent}<Label ${a.join(' ')} />`
}

function inputAttrs(n: UiNode): Array<[string, string | null]> {
  return [
    ['placeholder', n.exprs.placeholder ?? quote(n.placeholder)],
    ['value', n.exprs.value ?? quote(n.value)],
    ['color', n.exprs.color ?? (n.color ? color(n.color) : null)],
    ['placeholderColor', n.exprs.placeholderColor ?? (n.placeholderColor ? color(n.placeholderColor) : null)],
    ['disabled', n.exprs.disabled ?? boollit(n.disabled)],
    ['fontSize', n.exprs.fontSize ?? numlit(n.fontSize)],
    ['font', n.exprs.font ?? quote(n.font)],
    ['textAlign', n.exprs.textAlign ?? quote(n.textAlign)],
    ['onChange', n.exprs.onChange ?? null],
    ['onSubmit', n.exprs.onSubmit ?? null]
  ]
}

function dropdownAttrs(n: UiNode): Array<[string, string | null]> {
  const opts = n.exprs.options ?? (n.options ? `[${n.options.map((o) => `'${o}'`).join(', ')}]` : null)
  return [
    ['options', opts],
    ['acceptEmpty', n.exprs.acceptEmpty ?? boollit(n.acceptEmpty)],
    ['emptyLabel', n.exprs.emptyLabel ?? quote(n.emptyLabel)],
    ['selectedIndex', n.exprs.selectedIndex ?? numlit(n.selectedIndex)],
    ['disabled', n.exprs.disabled ?? boollit(n.disabled)],
    ['color', n.exprs.color ?? (n.color ? color(n.color) : null)],
    ['fontSize', n.exprs.fontSize ?? numlit(n.fontSize)],
    ['font', n.exprs.font ?? quote(n.font)],
    ['textAlign', n.exprs.textAlign ?? quote(n.textAlign)],
    ['onChange', n.exprs.onChange ?? null]
  ]
}

function emit(n: UiNode, depth: number): string {
  const pad = '  '.repeat(depth)
  if (n.kind === 'raw') return (n.raw ?? '').split('\n').map((l) => pad + l).join('\n')

  const tag = n.kind === 'input' ? 'Input' : n.kind === 'dropdown' ? 'Dropdown' : 'UiEntity'
  const extra: Array<[string, string | null]> =
    n.kind === 'input' ? inputAttrs(n)
      : n.kind === 'dropdown' ? dropdownAttrs(n)
        : n.kind === 'button' && (n.exprs.onClick) ? [['onMouseDown', n.exprs.onClick]]
          : []
  const attrs = attrLines(n, extra)
  const attrStr = attrs.join(`\n${pad}  `)

  const kids: string[] = []
  if (n.kind === 'text' || n.kind === 'button') kids.push(labelChild(n, `${pad}  `))
  for (const c of n.children) kids.push(emit(c, depth + 1))

  // self-closing Input/Dropdown (and any childless element)
  if (kids.length === 0) {
    return attrs.length ? `${pad}<${tag}\n${pad}  ${attrStr}\n${pad}/>` : `${pad}<${tag} />`
  }
  const open = attrs.length ? `${pad}<${tag}\n${pad}  ${attrStr}\n${pad}>` : `${pad}<${tag}>`
  return `${open}\n${kids.join('\n')}\n${pad}</${tag}>`
}

// Just the JSX tree (no wrapper) — used by the AST round-trip save.
export function emitJsx(root: UiNode, depth = 0): string {
  return emit(root, depth)
}

const usesKind = (n: UiNode, kinds: Set<string>): boolean =>
  kinds.has(n.kind) || n.children.some((c) => usesKind(c, kinds))

// best-effort prop types when deriving a props interface for a NEW component
const FIELD_TYPE: Record<string, string> = {
  text: 'string', value: 'string', placeholder: 'string', emptyLabel: 'string', src: 'string', elementId: 'string',
  color: 'Color4', background: 'Color4', placeholderColor: 'Color4', outlineColor: 'Color4', borderColor: 'Color4',
  onClick: '() => void', onChange: '(v: string) => void', onSubmit: '(v: string) => void',
  options: 'string[]', disabled: 'boolean', acceptEmpty: 'boolean'
}
const typeForProp = (root: UiNode, prop: string): string => {
  let t = 'unknown'
  const visit = (n: UiNode): void => {
    for (const [k, e] of Object.entries(n.exprs)) {
      if (new RegExp(`\\bprops\\.${prop}\\b`).test(e) && FIELD_TYPE[k]) t = FIELD_TYPE[k]
    }
    n.children.forEach(visit)
  }
  visit(root)
  return t
}

function deriveProps(root: UiNode): string | null {
  const names = new Set<string>()
  const visit = (n: UiNode): void => {
    for (const e of Object.values(n.exprs)) {
      for (const m of e.matchAll(/\bprops\.([A-Za-z_$][\w$]*)/g)) names.add(m[1])
    }
    n.children.forEach(visit)
  }
  visit(root)
  if (names.size === 0) return null
  return `props: {\n${[...names].map((p) => `  ${p}: ${typeForProp(root, p)}`).join('\n')}\n}`
}

// Full component file — used by "Generate .tsx" (new file). `opts.propsType` /
// `opts.importLines` override the derived signature/imports for round-trip exports.
export function generateTsx(
  root: UiNode,
  componentName: string,
  opts?: { propsType?: string | null; importLines?: string[] }
): string {
  const named = ['UiEntity']
  if (usesKind(root, new Set(['text', 'button']))) named.push('Label')
  if (usesKind(root, new Set(['input']))) named.push('Input')
  if (usesKind(root, new Set(['dropdown']))) named.push('Dropdown')

  const imports =
    opts?.importLines && opts.importLines.length > 0
      ? opts.importLines.join('\n')
      : `import ReactEcs, { ${named.join(', ')} } from '@dcl/sdk/react-ecs'\nimport { Color4 } from '@dcl/sdk/math'`

  const propsType = opts?.propsType !== undefined ? opts.propsType : deriveProps(root)
  const body = emit(root, 1)
  return `${imports}\n\nexport function ${componentName}(${propsType ?? ''}) {\n  return (\n${body}\n  )\n}\n`
}
