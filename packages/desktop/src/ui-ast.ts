// TS-AST round-trip reader for the UI builder. Parses ONE component's JSX out of a
// .tsx file into the builder's node tree, capturing literal values AND non-literal
// attribute values as expression strings (node.exprs[field]) so props/dynamic
// values survive. Dynamic children ({cond && <X/>}, {items.map(...)}) and custom
// components become 'raw' nodes kept verbatim. Save splices regenerated JSX back
// over the captured span, leaving imports/props/surrounding code untouched.
//
// For PREVIEW (only), a custom component (<HealthBar/>) is resolved via `resolve`,
// parsed recursively, its props baked from the call site, and attached as
// node.preview — the canvas renders that in place of the raw chip. `raw` is still
// what Save emits, so the reference on disk is untouched. Pure (no fs) → testable.
import ts from 'typescript'

export interface AstNode {
  id: string
  kind: string
  name: string
  exprs: Record<string, string>
  children: AstNode[]
  [field: string]: unknown
}

// Returns the source text of the file exporting `componentName` (or null). The
// caller (main) implements this over fs; injected so this module stays pure.
export type Resolver = (componentName: string, importLines: string[]) => string | null

export interface ParseOpts {
  pick?: string | null
  resolve?: Resolver
  depth?: number
}

export interface ParsedUi {
  ok: true
  componentName: string
  propsType: string | null
  importLines: string[]
  sourceText: string
  jsxStart: number
  jsxEnd: number
  tree: AstNode
}
export interface ParseError {
  ok: false
  error: string
}

const MAX_DEPTH = 4
let idc = 1
const nid = (): string => 'a' + idc++

const KNOWN_COLORS: Record<string, [number, number, number, number]> = {
  White: [1, 1, 1, 1], Black: [0, 0, 0, 1], Red: [1, 0, 0, 1], Green: [0, 1, 0, 1],
  Blue: [0, 0, 1, 1], Gray: [0.5, 0.5, 0.5, 1], Clear: [0, 0, 0, 0], Magenta: [1, 0, 1, 1],
  Yellow: [1, 1, 0, 1], Teal: [0, 1, 1, 1], Purple: [0.5, 0, 0.5, 1]
}

type Rgba = { r: number; g: number; b: number; a: number }
type Val =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'color'; v: Rgba }
  | { t: 'arr'; v: number[] }
  | { t: 'strarr'; v: string[] }
  | { t: 'obj'; v: Record<string, Val> }
  | { t: 'expr'; v: string }

interface Ctx { src: ts.SourceFile; resolve?: Resolver; depth: number; importLines: string[] }

function colorFromCall(call: ts.CallExpression): Rgba | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null
  const obj = call.expression.expression
  if (!ts.isIdentifier(obj) || obj.text !== 'Color4') return null
  const method = call.expression.name.text
  const nums = call.arguments.filter(ts.isNumericLiteral).map((a) => Number(a.text))
  if ((method === 'create' || method === 'fromInts') && nums.length >= 3) {
    const d = method === 'fromInts' ? 255 : 1
    return { r: nums[0] / d, g: nums[1] / d, b: nums[2] / d, a: (nums[3] ?? (method === 'fromInts' ? 255 : 1)) / d }
  }
  if (KNOWN_COLORS[method]) {
    const [r, g, b, a] = KNOWN_COLORS[method]
    return { r, g, b, a }
  }
  return null
}

function classify(expr: ts.Expression, src: ts.SourceFile): Val {
  if (ts.isNumericLiteral(expr)) return { t: 'num', v: Number(expr.text) }
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expr.operand)) {
    return { t: 'num', v: -Number(expr.operand.text) }
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { t: 'str', v: expr.text }
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return { t: 'bool', v: true }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return { t: 'bool', v: false }
  if (ts.isCallExpression(expr)) {
    const c = colorFromCall(expr)
    if (c) return { t: 'color', v: c }
  }
  if (ts.isArrayLiteralExpression(expr) && expr.elements.length > 0 && expr.elements.every((e) => ts.isNumericLiteral(e) || (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)))) {
    return { t: 'arr', v: expr.elements.map((e) => Number(e.getText(src))) }
  }
  if (ts.isArrayLiteralExpression(expr) && expr.elements.every((e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) {
    return { t: 'strarr', v: expr.elements.map((e) => (e as ts.StringLiteral).text) }
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const o: Record<string, Val> = {}
    for (const p of expr.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
        o[p.name.text] = classify(p.initializer, src)
      }
    }
    return { t: 'obj', v: o }
  }
  return { t: 'expr', v: expr.getText(src) }
}

const asNum = (v: Val | undefined): number | undefined => (v?.t === 'num' ? v.v : undefined)
const asStr = (v: Val | undefined): string | undefined => (v?.t === 'str' ? v.v : undefined)

function toDim(v: Val): { value?: number; unit: 'px' | '%' } | undefined {
  if (v.t === 'num') return { value: v.v, unit: 'px' }
  if (v.t === 'str') {
    if (v.v === 'auto') return undefined
    if (v.v.endsWith('%')) return { value: Number(v.v.slice(0, -1)), unit: '%' }
    if (v.v.endsWith('px')) return { value: Number(v.v.slice(0, -2)), unit: 'px' }
    const n = Number(v.v)
    if (!Number.isNaN(n)) return { value: n, unit: 'px' }
  }
  return undefined
}

function toSides(v: Val): Record<string, number> | undefined {
  if (v.t === 'num') return { top: v.v, right: v.v, bottom: v.v, left: v.v }
  if (v.t === 'obj') {
    const s: Record<string, number> = {}
    for (const k of ['top', 'right', 'bottom', 'left']) { const n = asNum(v.v[k]); if (n !== undefined) s[k] = n }
    return Object.keys(s).length ? s : undefined
  }
  return undefined
}

function toRadius(v: Val): Record<string, number> | undefined {
  if (v.t === 'num') return { topLeft: v.v, topRight: v.v, bottomLeft: v.v, bottomRight: v.v }
  if (v.t === 'obj') {
    const s: Record<string, number> = {}
    for (const k of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) { const n = asNum(v.v[k]); if (n !== undefined) s[k] = n }
    return Object.keys(s).length ? s : undefined
  }
  return undefined
}

const ENUM_FIELDS = new Set(['flexDirection', 'justifyContent', 'alignItems', 'alignSelf', 'alignContent', 'flexWrap', 'display', 'overflow', 'positionType', 'pointerFilter'])
const NUM_FIELDS = new Set(['flexGrow', 'flexShrink', 'flexBasis', 'opacity', 'zIndex'])
const DIM_FIELDS = new Set(['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'])
const SIDE_FIELDS = new Set(['padding', 'margin', 'position', 'borderWidth'])
const TRANSFORM_FIELDS = new Set([...ENUM_FIELDS, ...NUM_FIELDS, ...DIM_FIELDS, ...SIDE_FIELDS, 'borderRadius', 'borderColor', 'elementId'])

function applyTransform(node: AstNode, obj: Record<string, Val>): void {
  for (const [key, v] of Object.entries(obj)) {
    if (v.t === 'expr') { node.exprs[key] = v.v; continue }
    if (ENUM_FIELDS.has(key)) { const s = asStr(v); if (s) node[key] = s }
    else if (NUM_FIELDS.has(key)) { const n = asNum(v); if (n !== undefined) node[key] = n }
    else if (DIM_FIELDS.has(key)) { const d = toDim(v); if (d) node[key] = d }
    else if (SIDE_FIELDS.has(key)) { const s = toSides(v); if (s) node[key] = s }
    else if (key === 'borderRadius') { const r = toRadius(v); if (r) node.borderRadius = r }
    else if (key === 'borderColor') {
      if (v.t === 'color') node.borderColor = { top: v.v, right: v.v, bottom: v.v, left: v.v }
      else if (v.t === 'obj') {
        const c: Record<string, Rgba> = {}
        for (const k of ['top', 'right', 'bottom', 'left']) { const cv = v.v[k]; if (cv?.t === 'color') c[k] = cv.v }
        if (Object.keys(c).length) node.borderColor = c
      }
    } else if (key === 'elementId') { const s = asStr(v); if (s) node.elementId = s }
  }
}

function applyBackground(node: AstNode, obj: Record<string, Val>): void {
  const colorV = obj.color
  if (colorV?.t === 'color') node.background = colorV.v
  else if (colorV?.t === 'expr') node.exprs.background = colorV.v
  const tex = obj.texture
  if (tex?.t === 'obj') {
    const srcV = tex.v.src
    if (srcV?.t === 'str') node.src = srcV.v
    else if (srcV?.t === 'expr') node.exprs.src = srcV.v
    node.kind = 'image'
  }
  if (obj.textureMode?.t === 'str') node.textureMode = obj.textureMode.v
  if (obj.textureSlices) { const s = toSides(obj.textureSlices); if (s) node.textureSlices = s }
  if (obj.uvs?.t === 'arr') node.uvs = obj.uvs.v
  else if (obj.uvs?.t === 'expr') node.exprs.uvs = obj.uvs.v
}

const LABEL_STR = new Set(['placeholder', 'emptyLabel'])
const LABEL_NUM = new Set(['fontSize', 'outlineWidth', 'selectedIndex'])
const LABEL_COLOR = new Set(['color', 'outlineColor', 'placeholderColor'])
const LABEL_ENUM = new Set(['font', 'textAlign'])
const HANDLERS = new Set(['onMouseDown', 'onMouseUp', 'onChange', 'onSubmit'])

function applyDirect(node: AstNode, name: string, v: Val): void {
  if (HANDLERS.has(name)) { node.exprs[name === 'onMouseDown' ? 'onClick' : name] = v.t === 'expr' ? v.v : srcOf(v); return }
  if (v.t === 'expr') { node.exprs[name === 'value' && node.kind !== 'input' ? 'text' : name] = v.v; return }
  if (name === 'value') { if (node.kind === 'input') node.value = asStr(v); else node.text = asStr(v) }
  else if (name === 'text') node.text = asStr(v)
  else if (LABEL_STR.has(name)) node[name] = asStr(v)
  else if (LABEL_NUM.has(name)) node[name] = asNum(v)
  else if (LABEL_COLOR.has(name)) { if (v.t === 'color') node[name] = v.v }
  else if (LABEL_ENUM.has(name)) node[name] = asStr(v)
  else if (name === 'textWrap') node.textWrap = asStr(v) === 'wrap'
  else if (name === 'disabled' || name === 'acceptEmpty' || name === 'multiLine') { if (v.t === 'bool') node[name] = v.v }
  else if (name === 'options') { if (v.t === 'strarr') node.options = v.v }
}

// the source text of a value, for substituting into an expression on inline
function srcOf(v: Val): string {
  switch (v.t) {
    case 'num': return String(v.v)
    case 'str': return `'${v.v}'`
    case 'bool': return String(v.v)
    case 'expr': return v.v
    case 'arr': return `[${v.v.join(', ')}]`
    case 'strarr': return `[${v.v.map((s) => `'${s}'`).join(', ')}]`
    case 'color': return `Color4.create(${v.v.r}, ${v.v.g}, ${v.v.b}, ${v.v.a})`
    case 'obj': return '{}'
  }
}

// set a single field from a value (used when baking a literal prop on inline)
function setField(node: AstNode, field: string, v: Val): void {
  if (TRANSFORM_FIELDS.has(field)) { applyTransform(node, { [field]: v }); return }
  if (field === 'background') { if (v.t === 'color') node.background = v.v; return }
  if (field === 'src') { if (v.t === 'str') node.src = v.v; return }
  if (field === 'textureMode') { if (v.t === 'str') node.textureMode = v.v; return }
  if (field === 'uvs') { if (v.t === 'arr') node.uvs = v.v; return }
  if (field === 'textureSlices') { const s = toSides(v); if (s) node.textureSlices = s; return }
  applyDirect(node, field, v)
}

// bake call-site props into a resolved child tree (preview only): a field bound to
// exactly `props.X` becomes the literal X (or the caller's expression); partial
// expressions get `props.X` textually substituted.
function bakeProps(node: AstNode, caller: Record<string, Val>): void {
  for (const [field, expr] of Object.entries(node.exprs)) {
    const whole = /^props\.([A-Za-z_$][\w$]*)$/.exec(expr)
    if (whole && caller[whole[1]] !== undefined) {
      const cv = caller[whole[1]]
      if (cv.t === 'expr') node.exprs[field] = cv.v
      else { delete node.exprs[field]; setField(node, field, cv) }
      continue
    }
    let replaced = expr
    for (const [p, cv] of Object.entries(caller)) replaced = replaced.replace(new RegExp(`\\bprops\\.${p}\\b`, 'g'), srcOf(cv))
    if (replaced !== expr) node.exprs[field] = replaced
  }
  node.children.forEach((c) => bakeProps(c, caller))
}

function attrValue(attr: ts.JsxAttribute, src: ts.SourceFile): Val | undefined {
  const init = attr.initializer
  if (!init) return { t: 'bool', v: true }
  if (ts.isStringLiteral(init)) return { t: 'str', v: init.text }
  if (ts.isJsxExpression(init) && init.expression) return classify(init.expression, src)
  return undefined
}

function tagName(el: ts.JsxElement | ts.JsxSelfClosingElement): string {
  return (ts.isJsxElement(el) ? el.openingElement.tagName : el.tagName).getText()
}
function attributes(el: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes {
  return ts.isJsxElement(el) ? el.openingElement.attributes : el.attributes
}
function collectAttrs(el: ts.JsxElement | ts.JsxSelfClosingElement, src: ts.SourceFile): Record<string, Val> {
  const out: Record<string, Val> = {}
  for (const attr of attributes(el).properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue
    const v = attrValue(attr, src)
    if (v) out[attr.name.text] = v
  }
  return out
}

const KNOWN_TAGS: Record<string, string> = { UiEntity: 'box', Label: 'text', Input: 'input', Dropdown: 'dropdown' }

function mapElement(el: ts.JsxElement | ts.JsxSelfClosingElement, ctx: Ctx): AstNode {
  const tag = tagName(el)
  if (!(tag in KNOWN_TAGS)) {
    // a custom component → raw (kept for Save). Resolve+inline its tree for preview.
    const node: AstNode = { id: nid(), kind: 'raw', name: tag, exprs: {}, children: [], raw: el.getText(ctx.src) }
    if (ctx.resolve && ctx.depth < MAX_DEPTH) {
      const childSrc = ctx.resolve(tag, ctx.importLines)
      if (childSrc) {
        const sub = parseUiComponent(childSrc, { pick: tag, resolve: ctx.resolve, depth: ctx.depth + 1 })
        if (sub.ok) {
          bakeProps(sub.tree, collectAttrs(el, ctx.src))
          node.preview = sub.tree
        }
      }
    }
    return node
  }

  const node: AstNode = { id: nid(), kind: KNOWN_TAGS[tag], name: tag, exprs: {}, children: [] }
  for (const attr of attributes(el).properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue
    const an = attr.name.text
    const v = attrValue(attr, ctx.src)
    if (!v) continue
    if (an === 'uiTransform' && v.t === 'obj') applyTransform(node, v.v)
    else if (an === 'uiBackground' && v.t === 'obj') applyBackground(node, v.v)
    else applyDirect(node, an, v)
  }
  if (node.kind === 'box' && node.exprs.onClick) node.kind = 'button'

  if (ts.isJsxElement(el)) {
    for (const child of el.children) {
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) node.children.push(mapElement(child, ctx))
      else if (ts.isJsxExpression(child) && child.expression) node.children.push({ id: nid(), kind: 'raw', name: 'Raw', exprs: {}, children: [], raw: child.getText(ctx.src) })
    }
  }

  // collapse `<UiEntity ...><Label .../></UiEntity>` into a single text/button node
  if ((node.kind === 'box' || node.kind === 'button') && node.children.length === 1 && node.children[0].kind === 'text') {
    const label = node.children[0]
    for (const [k, val] of Object.entries(label)) {
      if (k === 'id' || k === 'kind' || k === 'name' || k === 'children') continue
      if (k === 'exprs') { Object.assign(node.exprs, label.exprs); continue }
      if (node[k] === undefined) node[k] = val
    }
    node.kind = node.exprs.onClick ? 'button' : 'text'
    node.children = []
  }
  return node
}

function unwrapReturn(expr: ts.Expression): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null {
  let e: ts.Expression = expr
  while (ts.isParenthesizedExpression(e)) e = e.expression
  if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return e
  return null
}

function findReturnedJsx(body: ts.Node): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null {
  if (ts.isParenthesizedExpression(body) || ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body) || ts.isJsxFragment(body)) {
    return unwrapReturn(body as ts.Expression)
  }
  let found: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null = null
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isReturnStatement(n) && n.expression) { const j = unwrapReturn(n.expression); if (j) found = j }
    else ts.forEachChild(n, visit)
  }
  ts.forEachChild(body, visit)
  return found
}

interface Candidate { name: string; params: ts.NodeArray<ts.ParameterDeclaration>; body: ts.Node }

function collectComponents(src: ts.SourceFile): Candidate[] {
  const out: Candidate[] = []
  for (const st of src.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) out.push({ name: st.name.text, params: st.parameters, body: st.body })
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          out.push({ name: d.name.text, params: d.initializer.parameters, body: d.initializer.body })
        }
      }
    }
  }
  return out
}

export function parseUiComponent(source: string, opts?: ParseOpts): ParsedUi | ParseError {
  const depth = opts?.depth ?? 0
  if (depth === 0) idc = 1
  let src: ts.SourceFile
  try {
    src = ts.createSourceFile('ui.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  } catch (e) {
    return { ok: false, error: `parse failed: ${String(e)}` }
  }

  const importLines = src.statements.filter(ts.isImportDeclaration).map((s) => s.getText(src))
  const candidates = collectComponents(src)

  let chosen: Candidate | null = null
  let jsx: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null = null
  for (const c of candidates) {
    if (opts?.pick && c.name !== opts.pick) continue
    const j = findReturnedJsx(c.body)
    if (j) { chosen = c; jsx = j; break }
  }
  if (!chosen || !jsx) return { ok: false, error: opts?.pick ? `export '${opts.pick}' not found or returns no JSX` : 'no JSX-returning component found' }

  const param = chosen.params[0]
  const propsType = param ? param.getText(src) : null
  const ctx: Ctx = { src, resolve: opts?.resolve, depth, importLines }

  let tree: AstNode
  if (ts.isJsxFragment(jsx)) {
    tree = { id: nid(), kind: 'box', name: 'Root', exprs: {}, children: [] }
    for (const ch of jsx.children) {
      if (ts.isJsxElement(ch) || ts.isJsxSelfClosingElement(ch)) tree.children.push(mapElement(ch, ctx))
      else if (ts.isJsxExpression(ch) && ch.expression) tree.children.push({ id: nid(), kind: 'raw', name: 'Raw', exprs: {}, children: [], raw: ch.getText(src) })
    }
  } else {
    tree = mapElement(jsx, ctx)
  }
  tree.name = 'Root'

  return { ok: true, componentName: chosen.name, propsType, importLines, sourceText: source, jsxStart: jsx.getStart(src), jsxEnd: jsx.getEnd(), tree }
}
