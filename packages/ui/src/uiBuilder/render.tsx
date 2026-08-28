// The builder canvas: projects the UiNode tree to DOM (CSS flexbox), mirroring how
// the engine lays out UI. Direct manipulation is FLOW-FIRST: dragging a node in
// flow reorders it among its siblings (insertion line + parent-direction chip);
// only a node opted into "Free position" (positionType absolute, set in the
// inspector) drags by coordinates. Resize only ever writes width/height for flow
// nodes. Arrow keys reorder flow nodes / nudge free ones (Shift = 10px).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore, reactive } from '../core/store'
import { ui, select, updateNode, findNode, parentOf, moveNode, px, type UiNode, type Rgba, type Dim, type Sides } from './model'

const css = (c: Rgba): string => `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`
const isUrl = (s: string): boolean => /^(https?:|data:|blob:)/.test(s)
const clampSize = (v: number): number => Math.max(8, Math.round(v))

const dimCss = (d?: Dim): string | number | undefined =>
  d?.value === undefined ? undefined : d.unit === '%' ? `${d.value}%` : d.value
const sidesCss = (s?: Sides): string | undefined =>
  s ? `${s.top ?? 0}px ${s.right ?? 0}px ${s.bottom ?? 0}px ${s.left ?? 0}px` : undefined

// 9-grid TextAlign → flex justify/align + text-align (matches the engine/dom.ts)
function textAlignCss(ta?: string): { justify: string; align: string; text: string } {
  const [row, col] = (ta ?? 'middle-center').split('-')
  const vmap: Record<string, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }
  const hmap: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end' }
  return { justify: hmap[col] ?? 'center', align: vmap[row] ?? 'center', text: col ?? 'center' }
}

function nodeStyle(n: UiNode): CSSProperties {
  const s: CSSProperties = {
    display: n.display === 'none' ? 'none' : 'flex',
    flexDirection: n.flexDirection ?? 'row',
    justifyContent: n.justifyContent,
    alignItems: n.alignItems === 'auto' ? undefined : n.alignItems,
    boxSizing: 'border-box',
    position: n.positionType === 'absolute' ? 'absolute' : 'relative',
    overflow: n.overflow === 'scroll' ? 'auto' : n.overflow,
    minWidth: 4,
    minHeight: 4
  }
  s.width = dimCss(n.width) ?? sampleDim(n.exprs.width)
  s.height = dimCss(n.height) ?? sampleDim(n.exprs.height)
  s.minWidth = dimCss(n.minWidth) ?? 4
  s.maxWidth = dimCss(n.maxWidth)
  s.minHeight = dimCss(n.minHeight) ?? 4
  s.maxHeight = dimCss(n.maxHeight)
  if (n.flexGrow !== undefined) s.flexGrow = n.flexGrow
  if (n.flexShrink !== undefined) s.flexShrink = n.flexShrink
  s.padding = sidesCss(n.padding)
  s.margin = sidesCss(n.margin)
  if (n.position) {
    if (n.position.top !== undefined) s.top = n.position.top
    if (n.position.right !== undefined) s.right = n.position.right
    if (n.position.bottom !== undefined) s.bottom = n.position.bottom
    if (n.position.left !== undefined) s.left = n.position.left
  }
  if (n.borderWidth) {
    s.borderStyle = 'solid'
    s.borderWidth = sidesCss(n.borderWidth)
    s.borderColor = 'transparent'
  }
  if (n.borderColor?.top) s.borderColor = css(n.borderColor.top)
  if (n.borderRadius) {
    const r = n.borderRadius
    s.borderRadius = `${r.topLeft ?? 0}px ${r.topRight ?? 0}px ${r.bottomRight ?? 0}px ${r.bottomLeft ?? 0}px`
  }
  if (n.opacity !== undefined) s.opacity = n.opacity
  if (n.zIndex !== undefined) s.zIndex = n.zIndex

  const preview = n.kind === 'image' ? n.previewUrl ?? (n.src && isUrl(n.src) ? n.src : undefined) : undefined
  if (preview) {
    s.backgroundImage = `url("${preview}")`
    s.backgroundRepeat = 'no-repeat'
    s.backgroundSize = n.textureMode === 'center' ? 'auto' : '100% 100%'
    s.backgroundPosition = 'center'
  } else if (n.background) {
    s.background = css(n.background)
  }
  return s
}

// readable label for a raw/opaque node: a custom component shows as <Name/>,
// a dynamic expression shows a truncated snippet of its source.
function rawLabel(n: UiNode): string {
  if (n.name && n.name !== 'Raw') return `<${n.name} />`
  const s = (n.raw ?? '').replace(/\s+/g, ' ').trim()
  return s.length > 48 ? s.slice(0, 48) + '…' : s || '{…}'
}

// readable stand-in for a value bound to an expression: `props.score` → "score",
// so a prop-driven pure component still shows something at edit time.
function exprToken(expr: string): string {
  const m = /([A-Za-z_$][\w$]*)\s*$/.exec(expr)
  return m ? m[1] : expr
}

// a user-provided sample value for an expression that's exactly `props.X`
function sampleFor(expr?: string): string | undefined {
  if (!expr) return undefined
  const m = /^props\.([A-Za-z_$][\w$]*)$/.exec(expr)
  return m ? ui.sampleProps[m[1]] : undefined
}
function sampleDim(expr?: string): number | string | undefined {
  const s = sampleFor(expr)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : s.endsWith('%') ? s : undefined
}

function TextSpan(props: { node: UiNode }): JSX.Element {
  const n = props.node
  const ta = textAlignCss(n.textAlign)
  const outline = n.outlineWidth ? `0 0 ${n.outlineWidth}px ${css(n.outlineColor ?? { r: 0, g: 0, b: 0, a: 1 })}` : undefined
  const sample = sampleFor(n.exprs.text)
  const bound = n.text === undefined && n.exprs.text !== undefined && sample === undefined
  const text = n.text ?? sample ?? (n.exprs.text !== undefined ? exprToken(n.exprs.text) : '')
  return (
    <div style={{ display: 'flex', flex: 1, width: '100%', height: '100%', justifyContent: ta.justify, alignItems: ta.align, pointerEvents: 'none' }}>
      <span
        style={{
          fontSize: n.fontSize ?? 14,
          color: n.color ? css(n.color) : 'var(--text)',
          fontFamily: n.font === 'monospace' ? 'var(--font-mono)' : n.font === 'serif' ? 'Georgia, serif' : undefined,
          textAlign: ta.text as CSSProperties['textAlign'],
          whiteSpace: n.textWrap ? 'normal' : 'nowrap',
          textShadow: outline,
          fontStyle: bound ? 'italic' : undefined,
          opacity: bound ? 0.7 : undefined
        }}
      >
        {text}
      </span>
    </div>
  )
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Dir = (typeof HANDLES)[number]
const HANDLE_CURSOR: Record<Dir, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize'
}
const HANDLE_POS: Record<Dir, CSSProperties> = {
  nw: { top: -4, left: -4 }, n: { top: -4, left: '50%', marginLeft: -4 }, ne: { top: -4, right: -4 },
  e: { top: '50%', right: -4, marginTop: -4 }, se: { bottom: -4, right: -4 }, s: { bottom: -4, left: '50%', marginLeft: -4 },
  sw: { bottom: -4, left: -4 }, w: { top: '50%', left: -4, marginTop: -4 }
}

// the canvas's current fit scale (scene px → screen px); drag deltas divide by it
let canvasScale = 1
const DRAG_THRESHOLD = 4

// The live stage element, for code outside the canvas that needs layout truth.
// Ticking "Free position" seeds the node's offsets from here so it doesn't jump:
// flow nodes render position:relative, so offsetLeft/Top are parent-relative —
// exactly Yoga's absolute anchor.
let stageEl: HTMLElement | null = null
export function nodeLayoutOffsets(id: string): { left: number; top: number } | null {
  const el = stageEl?.querySelector<HTMLElement>(`[data-uib-id="${id}"]`)
  if (!el) return null
  // offsetLeft/Top include the node's own margin, but absolute left/top position
  // the MARGIN edge (CSS and Yoga both) — subtract it or the seed double-counts
  const cs = getComputedStyle(el)
  return {
    left: el.offsetLeft - (parseFloat(cs.marginLeft) || 0),
    top: el.offsetTop - (parseFloat(cs.marginTop) || 0)
  }
}

// Flow-drag overlay state (insertion line + target-parent highlight), rendered
// by UiCanvas in stage coordinates. Only alive while a flow drag is past the
// click threshold.
const flowDrag = reactive({
  active: false,
  parentRect: null as { x: number; y: number; w: number; h: number } | null,
  line: null as { x: number; y: number; w: number; h: number } | null,
  label: ''
})

const DIR_ARROW: Record<string, string> = { row: '→', column: '↓', 'row-reverse': '←', 'column-reverse': '↑' }

const toStage = (stage: HTMLElement, r: DOMRect): { x: number; y: number; w: number; h: number } => {
  const s = stage.getBoundingClientRect()
  return { x: (r.left - s.left) / canvasScale, y: (r.top - s.top) / canvasScale, w: r.width / canvasScale, h: r.height / canvasScale }
}

// The deepest container under the pointer that can take the dragged node: a box
// (or the root), outside the dragged SUBTREE — the dragged node's ancestors are
// valid targets (that's what sibling reorder is). Falls back to the root.
function dropTargetAt(shadow: ShadowRoot | Document, x: number, y: number, draggedId: string): UiNode {
  const dragged = findNode(ui.root, draggedId)
  let el = shadow.elementFromPoint(x, y) as HTMLElement | null
  while (el) {
    const host = el.closest<HTMLElement>('[data-uib-id]')
    if (!host) break
    const n = findNode(ui.root, host.dataset.uibId ?? '')
    if (n && n.id !== draggedId && (dragged === null || findNode(dragged, n.id) === null) && (n.kind === 'box' || n.id === ui.root.id)) return n
    el = host.parentElement
  }
  return ui.root
}

// Insertion index along the target's main axis: compare the pointer to each
// in-flow sibling's midpoint. Free (absolute) children hold no slot.
function insertionIndex(target: UiNode, stage: HTMLElement, x: number, y: number, draggedId: string): number {
  const dir = target.flexDirection ?? 'row'
  const horizontal = dir.startsWith('row')
  const reversed = dir.endsWith('reverse')
  let index = 0
  for (const child of target.children) {
    if (child.id === draggedId || child.positionType === 'absolute') continue
    const el = stage.querySelector<HTMLElement>(`[data-uib-id="${child.id}"]`)
    if (!el) continue
    const r = el.getBoundingClientRect()
    const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2
    const past = horizontal ? x > mid : y > mid
    if (reversed ? !past : past) index = target.children.indexOf(child) + 1
  }
  return index
}

// The insertion line's stage-space rect: at the slot's leading edge, spanning
// the target's cross axis (padding box).
function lineRect(target: UiNode, targetEl: HTMLElement, stage: HTMLElement, index: number, draggedId: string): { x: number; y: number; w: number; h: number } {
  const dir = target.flexDirection ?? 'row'
  const horizontal = dir.startsWith('row')
  const reversed = dir.endsWith('reverse')
  const inFlow = target.children.filter((c) => c.id !== draggedId && c.positionType !== 'absolute')
  const before = target.children.slice(0, index).filter((c) => c.id !== draggedId && c.positionType !== 'absolute')
  const anchor = before.length > 0 ? before[before.length - 1] : null
  const anchorEl = anchor ? stage.querySelector<HTMLElement>(`[data-uib-id="${anchor.id}"]`) : null
  const t = toStage(stage, targetEl.getBoundingClientRect())
  // the slot after the anchor sits at its trailing edge — which is the LEADING
  // (left/top) edge in a reversed direction; the before-first slot mirrors too
  if (anchorEl) {
    const a = toStage(stage, anchorEl.getBoundingClientRect())
    if (horizontal) return { x: reversed ? a.x - 3 : a.x + a.w + 1, y: a.y, w: 2, h: a.h }
    return { x: a.x, y: reversed ? a.y - 3 : a.y + a.h + 1, w: a.w, h: 2 }
  }
  const firstEl = inFlow.length > 0 ? stage.querySelector<HTMLElement>(`[data-uib-id="${inFlow[0].id}"]`) : null
  if (firstEl) {
    const f = toStage(stage, firstEl.getBoundingClientRect())
    if (horizontal) return { x: reversed ? f.x + f.w + 1 : f.x - 3, y: f.y, w: 2, h: f.h }
    return { x: f.x, y: reversed ? f.y + f.h + 1 : f.y - 3, w: f.w, h: 2 }
  }
  return horizontal ? { x: t.x + 4, y: t.y + 4, w: 2, h: Math.max(8, t.h - 8) } : { x: t.x + 4, y: t.y + 4, w: Math.max(8, t.w - 8), h: 2 }
}

function startMove(e: ReactPointerEvent<HTMLDivElement>, node: UiNode): void {
  if (node.id === ui.root.id) return
  const el = e.currentTarget
  const stage = el.closest<HTMLElement>('.eui-uib-stage')
  if (!stage) return
  const pid = e.pointerId
  el.setPointerCapture(pid)
  const startX = e.clientX
  const startY = e.clientY
  const free = node.positionType === 'absolute'
  const base = free && node.position ? { left: node.position.left ?? 0, top: node.position.top ?? 0 } : { left: el.offsetLeft, top: el.offsetTop }
  const shadow = el.getRootNode() as ShadowRoot | Document
  let drop: { parentId: string; index: number } | null = null
  let cancelled = false
  // only act once the pointer has actually dragged — a plain click must NOT
  // move or reorder anything (that was the "click moves it" bug)
  let active = false
  const move = (ev: PointerEvent): void => {
    if (cancelled) return
    if (!active) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
      active = true
      if (!free) {
        // ghost the dragged subtree so hit-testing sees the drop target under it
        el.style.opacity = '0.4'
        el.style.pointerEvents = 'none'
      }
    }
    if (free) {
      updateNode(node.id, {
        position: {
          left: Math.round(base.left + (ev.clientX - startX) / canvasScale),
          top: Math.round(base.top + (ev.clientY - startY) / canvasScale)
        }
      })
      return
    }
    // outside the stage there is no drop — releasing there must cancel, not
    // silently reparent to the root
    const sr = stage.getBoundingClientRect()
    if (ev.clientX < sr.left || ev.clientX > sr.right || ev.clientY < sr.top || ev.clientY > sr.bottom) {
      drop = null
      flowDrag.active = false
      flowDrag.parentRect = null
      flowDrag.line = null
      return
    }
    const target = dropTargetAt(shadow, ev.clientX, ev.clientY, node.id)
    const targetEl = stage.querySelector<HTMLElement>(`[data-uib-id="${target.id}"]`)
    if (!targetEl) return
    const index = insertionIndex(target, stage, ev.clientX, ev.clientY, node.id)
    drop = { parentId: target.id, index }
    flowDrag.active = true
    flowDrag.parentRect = toStage(stage, targetEl.getBoundingClientRect())
    flowDrag.line = lineRect(target, targetEl, stage, index, node.id)
    flowDrag.label = `${target.name} ${DIR_ARROW[target.flexDirection ?? 'row']}`
  }
  const finish = (): void => {
    el.style.opacity = ''
    el.style.pointerEvents = ''
    flowDrag.active = false
    flowDrag.parentRect = null
    flowDrag.line = null
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', onKey, true)
    // last, and guarded: after a pointercancel the capture is already gone and
    // releasing it throws — which would leak the listeners removed above
    if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid)
  }
  const up = (): void => {
    const commit = !free && !cancelled && active && drop !== null ? drop : null
    finish()
    if (commit) moveNode(node.id, commit.parentId, commit.index)
  }
  const cancel = (): void => {
    cancelled = true
    finish()
  }
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return
    cancel()
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', onKey, true)
}

function startResize(e: ReactPointerEvent<HTMLDivElement>, node: UiNode, dir: Dir): void {
  e.stopPropagation()
  const handle = e.currentTarget
  const el = handle.parentElement as HTMLElement
  const pid = e.pointerId
  handle.setPointerCapture(pid)
  const startX = e.clientX
  const startY = e.clientY
  const w0 = node.width?.value ?? el.offsetWidth
  const h0 = node.height?.value ?? el.offsetHeight
  const free = node.positionType === 'absolute'
  const left0 = free && node.position ? node.position.left ?? 0 : 0
  const top0 = free && node.position ? node.position.top ?? 0 : 0

  const move = (ev: PointerEvent): void => {
    const dx = (ev.clientX - startX) / canvasScale
    const dy = (ev.clientY - startY) / canvasScale
    let width = w0
    let height = h0
    let left = left0
    let top = top0
    if (dir.includes('e')) width = w0 + dx
    if (dir.includes('w')) { width = w0 - dx; left = left0 + dx }
    if (dir.includes('s')) height = h0 + dy
    if (dir.includes('n')) { height = h0 - dy; top = top0 + dy }
    const patch: Partial<UiNode> = { width: px(clampSize(width)), height: px(clampSize(height)) }
    // only a free-positioned node anchors its opposite edge; a flow node just
    // resizes and lets flex re-lay the row — never a silent absolute conversion
    if (free) patch.position = { ...node.position, left: Math.round(left), top: Math.round(top) }
    updateNode(node.id, patch)
  }
  const up = (): void => {
    handle.releasePointerCapture(pid)
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

function CanvasNode(props: { node: UiNode; selectedId: string | null; readonly?: boolean }): JSX.Element {
  const { node, selectedId, readonly } = props
  const selected = !readonly && node.id === selectedId
  const style: CSSProperties = {
    ...nodeStyle(node),
    outline: selected ? '2px solid var(--primary)' : undefined,
    outlineOffset: selected ? -1 : undefined,
    cursor: readonly ? 'inherit' : node.id === ui.root.id ? 'default' : 'move',
    pointerEvents: readonly ? 'none' : undefined
  }
  const isText = node.kind === 'text' || node.kind === 'button'
  const placeholder = node.kind === 'image' && !node.previewUrl && (!node.src || !isUrl(node.src))

  return (
    <div
      data-uib-id={readonly ? undefined : node.id}
      style={style}
      onPointerDown={
        readonly
          ? undefined
          : (e) => {
              e.stopPropagation()
              select(node.id)
              startMove(e, node)
            }
      }
    >
      {isText && <TextSpan node={node} />}
      {node.kind === 'input' && (
        <span style={{ fontSize: node.fontSize ?? 14, color: css(node.placeholderColor ?? { r: 0.5, g: 0.5, b: 0.5, a: 1 }), pointerEvents: 'none' }}>
          {node.value || node.placeholder || sampleFor(node.exprs.value) || sampleFor(node.exprs.placeholder) || (node.exprs.value && exprToken(node.exprs.value)) || (node.exprs.placeholder && exprToken(node.exprs.placeholder)) || ''}
        </span>
      )}
      {node.kind === 'dropdown' && (
        <span style={{ fontSize: node.fontSize ?? 14, color: node.color ? css(node.color) : 'var(--text)', pointerEvents: 'none' }}>
          {node.options?.[node.selectedIndex ?? 0] ?? node.emptyLabel ?? '—'} ▾
        </span>
      )}
      {node.kind === 'raw' &&
        (node.preview ? (
          <CanvasNode node={node.preview} selectedId={null} readonly />
        ) : (
          <span
            style={{
              fontSize: 10, color: 'var(--text-2)', pointerEvents: 'none', margin: 2, padding: '2px 6px',
              fontFamily: 'var(--font-mono)', border: '1px dashed var(--divider)', borderRadius: 4,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%'
            }}
            data-tip="dynamic / composed — kept verbatim on save"
          >
            {rawLabel(node)}
          </span>
        ))}
      {placeholder && (
        <span style={{ fontSize: 10, color: 'var(--text-3)', pointerEvents: 'none', padding: 4 }}>
          {node.src ? node.src.split('/').pop() : node.exprs.src ? exprToken(node.exprs.src) : 'image'}
        </span>
      )}
      {node.children.map((c) => (
        <CanvasNode key={c.id} node={c} selectedId={selectedId} readonly={readonly} />
      ))}
      {selected && node.positionType === 'absolute' && <span className="eui-uib-free-chip">free</span>}
      {selected &&
        HANDLES.map((d) => (
          <div key={d} className="eui-uib-handle" style={{ ...HANDLE_POS[d], cursor: HANDLE_CURSOR[d] }} onPointerDown={(e) => startResize(e, node, d)} />
        ))}
    </div>
  )
}

// Device presets (real resolutions). Only the MOBILE explorer (Godot) normalizes
// the UI canvas with content_scale = min(w/720, h/720) → its scene canvas is
// ~720px tall; the desktop explorer (bevy) lays UI out in raw window logical px
// (default window 1280×720, no scale). Mobile is LANDSCAPE (the explorer runs
// landscape) and drives the isMobile() layout.
const PRESETS = {
  desktop: { dw: 1280, dh: 720, label: 'Desktop', mobile: false, norm: 'none' },
  mobile: { dw: 2556, dh: 1179, label: 'Mobile', mobile: true, norm: 'godot' } // iPhone 14 Pro, landscape
} as const
type PresetKey = keyof typeof PRESETS
function canvasOf(d: { dw: number; dh: number; norm: 'none' | 'godot' }): { w: number; h: number } {
  if (d.norm === 'none') return { w: d.dw, h: d.dh }
  const cs = Math.min(d.dw / 720, d.dh / 720)
  return { w: Math.round(d.dw / cs), h: Math.round(d.dh / cs) }
}

export function UiCanvas(): JSX.Element {
  const root = useStore(() => ui.root)
  const selectedId = useStore(() => ui.selectedId)
  useStore(() => ui.sampleProps) // re-render when sample values change
  const loadTick = useStore(() => ui.loadTick)
  const presetKey = useStore(() => ui.canvasPreset)
  const zoom = useStore(() => ui.canvasZoom)
  const bg = useStore(() => ui.canvasBg)
  const fitReq = useStore(() => ui.canvasFitReq)
  const stageRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [centerReq, setCenterReq] = useState(0)
  const preset = PRESETS[presetKey]
  const { w: VW, h: VH } = canvasOf(preset)

  const scale = zoom
  canvasScale = scale
  const dragActive = useStore(() => flowDrag.active)
  const dragLine = useStore(() => flowDrag.line)
  const dragParent = useStore(() => flowDrag.parentRect)
  const dragLabel = useStore(() => flowDrag.label)

  // storybook framing: zoom so the component fits the view (with padding) but never
  // blown up past 100%, then request a recenter (done after layout commits below).
  const fitContent = (): void => {
    const area = areaRef.current
    const stage = stageRef.current
    if (!area || !stage) return
    const rootEl = stage.firstElementChild as HTMLElement | null
    const bezel = preset.mobile ? 48 : 0 // the device frame adds ~24px per side
    const rw = (rootEl?.offsetWidth || VW) + bezel
    const rh = (rootEl?.offsetHeight || VH) + bezel
    const z = Math.max(0.1, Math.min(1, (area.clientWidth - 96) / rw, (area.clientHeight - 96) / rh))
    ui.canvasZoom = Math.round(z * 100) / 100
    setCenterReq((n) => n + 1)
  }

  // re-fit when a component is opened, the device preset changes, or the toolbar
  // asks (Fit button bumps canvasFitReq)
  useEffect(() => {
    const id = requestAnimationFrame(fitContent)
    return () => cancelAnimationFrame(id)
  }, [presetKey, loadTick, fitReq])

  useLayoutEffect(() => {
    stageEl = stageRef.current
    return () => {
      stageEl = null
    }
  })

  // center the view AFTER the new zoom has been laid out (scrollWidth is reliable now)
  useLayoutEffect(() => {
    const a = areaRef.current
    if (!a || centerReq === 0) return
    a.scrollLeft = (a.scrollWidth - a.clientWidth) / 2
    a.scrollTop = (a.scrollHeight - a.clientHeight) / 2
  }, [centerReq, zoom])

  // drag empty canvas (scroll bg, screen, or stage) to pan; a plain click clears selection
  const onBgPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const t = e.target as HTMLElement
    if (!['eui-uib-scroll', 'eui-uib-screen-fit', 'eui-uib-stage', 'eui-uib-device'].some((c) => t.classList.contains(c))) return
    const sc = areaRef.current
    if (!sc) return
    const sx = sc.scrollLeft
    const sy = sc.scrollTop
    const cx = e.clientX
    const cy = e.clientY
    let panned = false
    const move = (ev: PointerEvent): void => {
      if (!panned && Math.abs(ev.clientX - cx) + Math.abs(ev.clientY - cy) < 4) return
      panned = true
      sc.scrollLeft = sx - (ev.clientX - cx)
      sc.scrollTop = sy - (ev.clientY - cy)
    }
    const up = (): void => {
      if (!panned) select(null)
      sc.style.cursor = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    sc.style.cursor = 'grabbing'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
      if (!delta) return
      const id = ui.selectedId
      if (!id || id === ui.root.id) return
      const rootNode = stageRef.current?.getRootNode() as ShadowRoot | Document | null
      const active = rootNode && 'activeElement' in rootNode ? rootNode.activeElement : null
      const tag = active?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const node = findNode(ui.root, id)
      if (!node) return
      e.preventDefault()
      if (node.positionType === 'absolute') {
        const step = e.shiftKey ? 10 : 1
        const base = { left: node.position?.left ?? 0, top: node.position?.top ?? 0 }
        updateNode(id, { position: { ...node.position, left: base.left + delta[0] * step, top: base.top + delta[1] * step } })
        return
      }
      // flow node: arrows reorder among IN-FLOW siblings (free siblings hold no
      // slot), toward the arrow's visual direction — inverted in *-reverse
      const parent = parentOf(ui.root, id)
      if (!parent) return
      const flow = parent.children.filter((c) => c.positionType !== 'absolute')
      const fi = flow.findIndex((c) => c.id === id)
      const reversed = (parent.flexDirection ?? 'row').endsWith('reverse')
      const fwd = (delta[0] > 0 || delta[1] > 0) !== reversed
      if (fwd ? fi >= flow.length - 1 : fi <= 0) return
      const neighborIdx = parent.children.indexOf(flow[fwd ? fi + 1 : fi - 1])
      moveNode(id, parent.id, fwd ? neighborIdx + 1 : neighborIdx)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const screen = (
    <div className={`eui-uib-screen-fit bg-${bg}`} style={{ width: VW * scale, height: VH * scale }}>
      <div
        className="eui-uib-stage"
        ref={stageRef}
        style={{ width: VW, height: VH, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        <CanvasNode node={root} selectedId={selectedId} />
        {dragActive && dragParent && (
          <div className="eui-uib-drop-parent" style={{ left: dragParent.x, top: dragParent.y, width: dragParent.w, height: dragParent.h }}>
            <span className={`eui-uib-drop-chip${dragParent.y < 18 ? ' inside' : ''}`}>{dragLabel}</span>
          </div>
        )}
        {dragActive && dragLine && (
          <div className="eui-uib-drop-line" style={{ left: dragLine.x, top: dragLine.y, width: dragLine.w, height: dragLine.h }} />
        )}
      </div>
    </div>
  )

  return (
    <div className="eui-uib-canvas">
      <div className="eui-uib-scroll" ref={areaRef} onPointerDown={onBgPointerDown}>
        {preset.mobile ? <div className="eui-uib-device">{screen}</div> : screen}
      </div>
    </div>
  )
}
