// The UI builder's tree model + reactive store. Authoring is pure data here; the
// canvas (render.tsx) projects a node to DOM, codegen.ts emits React-ECS .tsx, and
// the TS-AST round-trip (desktop) reads/writes it back. Field names + value shapes
// mirror @dcl/react-ecs's UiTransform/uiBackground/Label/Input/Dropdown props so
// codegen is a near-direct serialization. Tree edits are IMMUTABLE (build a new
// root, reassign ui.root) so the shallow reactive() proxy notifies.
import { reactive } from '../store'

export type UiKind = 'box' | 'text' | 'button' | 'image' | 'input' | 'dropdown' | 'raw'
export type Unit = 'px' | '%'
export type FlexDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse'
export type Justify = 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'
export type Align = 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline' | 'space-between' | 'space-around'
export type Wrap = 'nowrap' | 'wrap' | 'wrap-reverse'
export type Display = 'flex' | 'none'
export type Overflow = 'visible' | 'hidden' | 'scroll'
export type PositionType = 'relative' | 'absolute'
export type PointerFilter = 'none' | 'block'
export type TextAlign =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
export type Font = 'sans-serif' | 'serif' | 'monospace'
export type TextureMode = 'nine-slices' | 'center' | 'stretch'

export type Rgba = { r: number; g: number; b: number; a: number }
export type Dim = { value?: number; unit: Unit }
export type Sides = { top?: number; right?: number; bottom?: number; left?: number }
export type Radius = { topLeft?: number; topRight?: number; bottomLeft?: number; bottomRight?: number }
export type SideColors = { top?: Rgba; right?: Rgba; bottom?: Rgba; left?: Rgba }

// field name → raw expression source (e.g. `props.score`, `count + 1`). When a
// field has an expression, codegen emits it verbatim instead of the literal — this
// is how props/imports/dynamic values survive the AST round-trip.
export type Exprs = Record<string, string>

export interface UiNode {
  id: string
  kind: UiKind
  name: string

  // layout
  flexDirection?: FlexDirection
  justifyContent?: Justify
  alignItems?: Align
  alignContent?: Align
  alignSelf?: Align
  flexWrap?: Wrap
  display?: Display
  overflow?: Overflow
  pointerFilter?: PointerFilter

  // flex
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number

  // size
  width?: Dim
  height?: Dim
  minWidth?: Dim
  maxWidth?: Dim
  minHeight?: Dim
  maxHeight?: Dim

  // spacing / position
  padding?: Sides
  margin?: Sides
  positionType?: PositionType
  position?: Sides

  // border
  borderWidth?: Sides
  borderColor?: SideColors
  borderRadius?: Radius

  // misc transform
  opacity?: number
  zIndex?: number
  elementId?: string

  // background (box / button / image / input / dropdown)
  background?: Rgba
  src?: string
  previewUrl?: string // canvas-only resolved URL; never emitted
  textureMode?: TextureMode
  textureSlices?: Sides // 0..1 fractions
  uvs?: number[]

  // text (text / button)
  text?: string
  color?: Rgba
  fontSize?: number
  font?: Font
  textAlign?: TextAlign
  textWrap?: boolean // true = wrap
  outlineWidth?: number
  outlineColor?: Rgba

  // input
  placeholder?: string
  value?: string
  placeholderColor?: Rgba
  disabled?: boolean
  multiLine?: boolean

  // dropdown
  options?: string[]
  acceptEmpty?: boolean
  emptyLabel?: string
  selectedIndex?: number

  // raw passthrough (kind 'raw'): verbatim JSX kept from import, emitted as-is
  raw?: string
  // preview-only: a resolved child-component tree (props baked in) the canvas
  // renders in place of a raw node. NEVER emitted — Save keeps `raw` verbatim.
  preview?: UiNode

  exprs: Exprs
  children: UiNode[]
}

let counter = 1
const nextId = (): string => `n${counter++}`

export const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 }
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
export const ACCENT: Rgba = { r: 0.55, g: 0.36, b: 0.96, a: 1 }
export const PANEL_BG: Rgba = { r: 0.09, g: 0.09, b: 0.13, a: 0.95 }
const BOX_BG: Rgba = { r: 0.16, g: 0.16, b: 0.24, a: 1 }
const INPUT_BG: Rgba = { r: 0.08, g: 0.08, b: 0.11, a: 1 }

export const px = (value: number): Dim => ({ value, unit: 'px' })
export const allSides = (n: number): Sides => ({ top: n, right: n, bottom: n, left: n })

export function makeNode(kind: UiKind): UiNode {
  const base: UiNode = { id: nextId(), kind, name: kind[0].toUpperCase() + kind.slice(1), exprs: {}, children: [] }
  switch (kind) {
    case 'box':
      return { ...base, width: px(160), height: px(100), padding: allSides(8), background: BOX_BG }
    case 'text':
      return { ...base, text: 'Text', color: WHITE, fontSize: 14 }
    case 'button':
      return {
        ...base, width: px(120), height: px(40), padding: allSides(8),
        alignItems: 'center', justifyContent: 'center', background: ACCENT, text: 'Button', color: WHITE, fontSize: 14
      }
    case 'image':
      return { ...base, width: px(120), height: px(120), textureMode: 'stretch', background: { r: 0.3, g: 0.3, b: 0.36, a: 1 } }
    case 'input':
      return {
        ...base, width: px(220), height: px(36), padding: allSides(6),
        background: INPUT_BG, color: WHITE, fontSize: 14, placeholder: 'Type here…', placeholderColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 }
      }
    case 'dropdown':
      return {
        ...base, width: px(220), height: px(36), padding: allSides(6),
        background: INPUT_BG, color: WHITE, fontSize: 14, options: ['Option 1', 'Option 2'], acceptEmpty: false, selectedIndex: 0
      }
    case 'raw':
      return { ...base, raw: '' }
  }
}

function rootNode(): UiNode {
  return { ...makeNode('box'), name: 'Root', width: px(360), height: px(240), padding: allSides(16), background: PANEL_BG }
}

// ---- reactive store (shared across palette / canvas / inspector / layers) ----
export const ui = reactive({
  root: rootNode(),
  selectedId: null as string | null,
  componentName: 'MyUi',
  // round-trip context (set when a file was opened via the AST reader): the
  // original source + the [start,end] span of the component's JSX, so Save can
  // splice regenerated JSX back in without touching imports/props/logic.
  sourcePath: null as string | null,
  importLines: [] as string[],
  propsType: null as string | null,
  sourceText: null as string | null,
  jsxStart: 0,
  jsxEnd: 0,
  // sample values for props (name → source text), used only to make prop-driven
  // pure components visible on the canvas — never written to the file
  sampleProps: {} as Record<string, string>,
  // bumped on undo/redo so React views re-read history availability
  historyTick: 0,
  // bumped when a tree is loaded, so the canvas re-fits to the component
  loadTick: 0,
  // canvas view state (driven from the toolbar, rendered by UiCanvas)
  canvasPreset: 'desktop' as 'desktop' | 'mobile',
  canvasZoom: 1,
  canvasBg: 'grid' as 'grid' | 'dark' | 'light',
  canvasFitReq: 0 // bump to ask the canvas to fit-and-center the component
})

export function setSampleProp(name: string, value: string | null): void {
  const next = { ...ui.sampleProps }
  if (value === null || value === '') delete next[name]
  else next[name] = value
  ui.sampleProps = next
}

// ---- undo / redo (snapshots of ui.root) ----
const past: UiNode[] = []
const future: UiNode[] = []
const HISTORY_CAP = 100
const COALESCE_MS = 350
let lastCoalesce = 0
const snap = (): UiNode => structuredClone(ui.root)

// discrete edits (add/delete/move/bind) — always a distinct undo step
function record(): void {
  past.push(snap())
  if (past.length > HISTORY_CAP) past.shift()
  future.length = 0
}
// continuous edits (drag/resize/typing) — coalesce a rapid burst into one step
function recordCoalesced(): void {
  const t = Date.now()
  if (t - lastCoalesce > COALESCE_MS) record()
  lastCoalesce = t
}

export const canUndo = (): boolean => past.length > 0
export const canRedo = (): boolean => future.length > 0

export function undo(): void {
  const prev = past.pop()
  if (prev === undefined) return
  future.push(snap())
  ui.root = prev
  if (ui.selectedId !== null && findNode(ui.root, ui.selectedId) === null) ui.selectedId = null
  ui.historyTick++
}
export function redo(): void {
  const next = future.pop()
  if (next === undefined) return
  past.push(snap())
  ui.root = next
  if (ui.selectedId !== null && findNode(ui.root, ui.selectedId) === null) ui.selectedId = null
  ui.historyTick++
}
function resetHistory(): void {
  past.length = 0
  future.length = 0
  ui.historyTick++
}

// load a freshly-parsed/created tree, resetting round-trip context
export function loadTree(
  root: UiNode,
  ctx?: { sourcePath?: string; componentName?: string; importLines?: string[]; propsType?: string | null; sourceText?: string; jsxStart?: number; jsxEnd?: number }
): void {
  ui.root = root
  ui.selectedId = root.id
  ui.sourcePath = ctx?.sourcePath ?? null
  ui.componentName = ctx?.componentName ?? ui.componentName
  ui.importLines = ctx?.importLines ?? []
  ui.propsType = ctx?.propsType ?? null
  ui.sourceText = ctx?.sourceText ?? null
  ui.jsxStart = ctx?.jsxStart ?? 0
  ui.jsxEnd = ctx?.jsxEnd ?? 0
  ui.sampleProps = {}
  ui.loadTick++
  resetHistory()
}

// ---- immutable tree helpers ----
function mapTree(node: UiNode, fn: (n: UiNode) => UiNode): UiNode {
  const next = fn(node)
  if (next.children.length === 0) return next
  return { ...next, children: next.children.map((c) => mapTree(c, fn)) }
}

export function findNode(node: UiNode, id: string): UiNode | null {
  if (node.id === id) return node
  for (const c of node.children) {
    const found = findNode(c, id)
    if (found) return found
  }
  return null
}

function removeNode(node: UiNode, id: string): UiNode {
  return { ...node, children: node.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)) }
}

export function parentOf(node: UiNode, id: string): UiNode | null {
  for (const c of node.children) {
    if (c.id === id) return node
    const p = parentOf(c, id)
    if (p) return p
  }
  return null
}

// ---- public ops (each reassigns ui.root / ui.selectedId so the proxy notifies) ----
export function select(id: string | null): void {
  ui.selectedId = id
}

export function addChild(parentId: string, kind: UiKind): void {
  record()
  const node = makeNode(kind)
  ui.root = mapTree(ui.root, (n) => (n.id === parentId ? { ...n, children: [...n.children, node] } : n))
  ui.selectedId = node.id
}

export function updateNode(id: string, patch: Partial<UiNode>): void {
  recordCoalesced()
  ui.root = mapTree(ui.root, (n) => (n.id === id ? { ...n, ...patch } : n))
}

// set/clear an expression binding for a field (field → expression source)
export function setExpr(id: string, field: string, expr: string | null): void {
  record()
  ui.root = mapTree(ui.root, (n) => {
    if (n.id !== id) return n
    const exprs = { ...n.exprs }
    if (expr === null || expr === '') delete exprs[field]
    else exprs[field] = expr
    return { ...n, exprs }
  })
}

export function deleteNode(id: string): void {
  if (id === ui.root.id) return // never delete the root
  record()
  ui.root = removeNode(ui.root, id)
  if (ui.selectedId === id) ui.selectedId = null
}

// Move `id` into `newParentId` at `index` (Layers panel drag-to-reorder/reparent).
export function moveNode(id: string, newParentId: string, index: number): void {
  if (id === ui.root.id) return
  const moving = findNode(ui.root, id)
  if (moving === null) return
  if (findNode(moving, newParentId) !== null) return // can't drop into own descendant
  record()
  let root = removeNode(ui.root, id)
  root = mapTree(root, (n) => {
    if (n.id !== newParentId) return n
    const children = [...n.children]
    children.splice(Math.max(0, Math.min(index, children.length)), 0, moving)
    return { ...n, children }
  })
  ui.root = root
}
