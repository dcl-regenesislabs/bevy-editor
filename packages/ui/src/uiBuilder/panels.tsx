// The UI builder's docked panels (design-system styled): a palette to add nodes,
// a layer tree, and a grouped property inspector covering the full React-ECS prop
// surface. Any field can be bound to an expression/prop via its "fx" toggle.
import { useState, useRef, type ReactNode } from 'react'
import { useStore } from '../store'
import { IconTrash } from '../icons'
import { uiLoadLocalImages, uiImportImage, uiResolveImageUrl } from '../actions'
import {
  ui, addChild, select, updateNode, deleteNode, moveNode, setExpr, findNode, parentOf, px,
  type UiNode, type UiKind, type Rgba, type Dim, type Sides, type Radius
} from './model'

const to255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n * 255)))
const rgbaToHex = (c: Rgba): string => '#' + [c.r, c.g, c.b].map((v) => to255(v).toString(16).padStart(2, '0')).join('')
const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({
  r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255
})

const KINDS: Array<{ kind: UiKind; glyph: string; label: string }> = [
  { kind: 'box', glyph: '▱', label: 'Container' },
  { kind: 'text', glyph: 'T', label: 'Text' },
  { kind: 'button', glyph: '⬚', label: 'Button' },
  { kind: 'image', glyph: '▣', label: 'Image' },
  { kind: 'input', glyph: '⌨', label: 'Input' },
  { kind: 'dropdown', glyph: '▿', label: 'Dropdown' }
]

// ---------- palette ----------
export function Palette(): JSX.Element {
  const selectedId = useStore(() => ui.selectedId)
  const target = selectedId ? findNode(ui.root, selectedId) : null
  const parentId = target && (target.kind === 'box' || target.id === ui.root.id) ? target.id : ui.root.id
  return (
    <div className="eui-uib-palette">
      {KINDS.map((k) => (
        <button key={k.kind} className="eui-uib-pal-btn" data-tip={`Add ${k.label}`} onClick={() => addChild(parentId, k.kind)}>
          <span className="glyph">{k.glyph}</span>
          <span>{k.label}</span>
        </button>
      ))}
    </div>
  )
}

// ---------- layers ----------
function LayerRow(props: { node: UiNode; depth: number; selectedId: string | null }): JSX.Element {
  const { node, depth, selectedId } = props
  return (
    <>
      <div
        className={`eui-row ${node.id === selectedId ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={node.id !== ui.root.id}
        onClick={() => select(node.id)}
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData('text/ui-id', node.id) }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation()
          const dragId = e.dataTransfer.getData('text/ui-id')
          if (!dragId || dragId === node.id) return
          if (node.kind === 'box' || node.id === ui.root.id) moveNode(dragId, node.id, node.children.length)
          else {
            const p = parentOf(ui.root, node.id)
            if (p) moveNode(dragId, p.id, p.children.findIndex((c) => c.id === node.id) + 1)
          }
        }}
      >
        <span className="label">{node.name}<span className="dim">{node.kind}</span></span>
      </div>
      {node.children.map((c) => <LayerRow key={c.id} node={c} depth={depth + 1} selectedId={selectedId} />)}
    </>
  )
}

export function Layers(): JSX.Element {
  const root = useStore(() => ui.root)
  const selectedId = useStore(() => ui.selectedId)
  return <div className="eui-uib-layers"><LayerRow node={root} depth={0} selectedId={selectedId} /></div>
}

// ---------- field editors ----------
function Num(props: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string }): JSX.Element {
  return (
    <input className="eui-num" type="number" value={props.value ?? ''} placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  )
}

function Sel<T extends string>(props: { value: T | undefined; onChange: (v: T | undefined) => void; options: readonly T[]; empty?: string }): JSX.Element {
  return (
    <select className="eui-select" value={props.value ?? ''} onChange={(e) => props.onChange((e.target.value || undefined) as T | undefined)}>
      <option value="">{props.empty ?? '—'}</option>
      {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function DimIn(props: { value?: Dim; onChange: (d: Dim | undefined) => void }): JSX.Element {
  const d = props.value
  return (
    <>
      <Num value={d?.value} placeholder="auto" onChange={(v) => props.onChange(v === undefined ? undefined : { value: v, unit: d?.unit ?? 'px' })} />
      <select className="eui-select" style={{ width: 48, flex: 'none' }} value={d?.unit ?? 'px'}
        onChange={(e) => props.onChange({ value: d?.value, unit: e.target.value as 'px' | '%' })}>
        <option value="px">px</option><option value="%">%</option>
      </select>
    </>
  )
}

function SidesIn(props: { value?: Sides; onChange: (s: Sides | undefined) => void }): JSX.Element {
  const s = props.value ?? {}
  const set = (k: keyof Sides, v: number | undefined): void => {
    const next = { ...s, [k]: v }
    const empty = (['top', 'right', 'bottom', 'left'] as const).every((kk) => next[kk] === undefined)
    props.onChange(empty ? undefined : next)
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
      {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
        <Num key={k} value={s[k]} placeholder={k[0].toUpperCase()} onChange={(v) => set(k, v)} />
      ))}
    </div>
  )
}

function ColorIn(props: { value?: Rgba; onChange: (c: Rgba) => void; def?: Rgba }): JSX.Element {
  const c = props.value ?? props.def ?? { r: 1, g: 1, b: 1, a: 1 }
  return (
    <>
      <input type="color" className="eui-color-swatch" value={rgbaToHex(c)} onChange={(e) => props.onChange({ ...hexToRgb(e.target.value), a: c.a })} />
      <Num value={c.a} placeholder="α" onChange={(a) => props.onChange({ ...c, a: a ?? 1 })} />
    </>
  )
}

function Bool(props: { value?: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return <div className={`eui-toggle ${props.value ? 'on' : ''}`} onClick={() => props.onChange(!props.value)} />
}

// A property row with an "fx" toggle: bind the field to an expression/prop instead
// of a literal. When bound, the literal editor is replaced by a code input.
function Fx(props: { node: UiNode; field: string; label: string; children: ReactNode }): JSX.Element {
  const expr = props.node.exprs[props.field]
  return (
    <div className="eui-prop">
      <span className="plabel">{props.label}</span>
      <div className="pvalue">
        {expr !== undefined
          ? <input className="eui-input" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} value={expr} onChange={(e) => setExpr(props.node.id, props.field, e.target.value)} />
          : props.children}
        <button
          className={`eui-btn icon ${expr !== undefined ? 'active' : ''}`}
          style={{ width: 22, height: 22, fontFamily: 'var(--font-mono)', fontSize: 10 }}
          data-tip={expr !== undefined ? 'Use a literal value' : 'Bind to a prop / expression'}
          onClick={() => setExpr(props.node.id, props.field, expr !== undefined ? null : `props.${props.field}`)}
        >fx</button>
      </div>
    </div>
  )
}

function Group(props: { title: string; open?: boolean; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(props.open ?? false)
  return (
    <div className="eui-comp">
      <div className="eui-comp-head" onClick={() => setOpen(!open)}>
        <span className="twisty">{open ? '▾' : '▸'}</span>
        <span className="name">{props.title}</span>
      </div>
      {open && <div className="eui-comp-body">{props.children}</div>}
    </div>
  )
}

const FLEX_DIR = ['row', 'column', 'row-reverse', 'column-reverse'] as const
const JUSTIFY = ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] as const
const ALIGN = ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline', 'space-between', 'space-around'] as const
const WRAP = ['nowrap', 'wrap', 'wrap-reverse'] as const
const DISPLAY = ['flex', 'none'] as const
const OVERFLOW = ['visible', 'hidden', 'scroll'] as const
const POS_TYPE = ['relative', 'absolute'] as const
const TEX_MODE = ['stretch', 'center', 'nine-slices'] as const
const FONT = ['sans-serif', 'serif', 'monospace'] as const
const TEXT_ALIGN = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const

// ---------- inspector ----------
export function BuilderInspector(): JSX.Element {
  const selectedId = useStore(() => ui.selectedId)
  useStore(() => ui.root)
  const n = selectedId ? findNode(ui.root, selectedId) : null
  if (!n) {
    return (
      <div className="eui-panel eui-right">
        <div className="eui-panel-head"><div className="eui-head-text"><span className="eui-overline">UI Element</span><span className="eui-title dim">Nothing selected</span></div></div>
        <div className="eui-panel-body"><div className="eui-empty">Select an element on the canvas or in Layers</div></div>
      </div>
    )
  }
  const set = (patch: Partial<UiNode>): void => updateNode(n.id, patch)
  const hasBg = n.kind !== 'text' && n.kind !== 'raw'
  const isText = n.kind === 'text' || n.kind === 'button'

  return (
    <div className="eui-panel eui-right">
      <div className="eui-panel-head">
        <div className="eui-head-text">
          <span className="eui-overline">{n.kind}</span>
          <input className="eui-name-input" value={n.name} spellCheck={false} onChange={(e) => set({ name: e.target.value })} />
        </div>
        {n.id !== ui.root.id && <button className="eui-btn icon" data-tip="Delete element" onClick={() => deleteNode(n.id)}><IconTrash /></button>}
      </div>

      <div className="eui-panel-body">
        {n.kind === 'raw' ? (
          <div className="eui-comp-body">
            <div className="eui-group-label">Raw JSX (kept verbatim from import)</div>
            <textarea className="eui-raw" style={{ minHeight: 140 }} value={n.raw ?? ''} spellCheck={false} onChange={(e) => set({ raw: e.target.value })} />
          </div>
        ) : (
          <>
            <Group title="Layout" open>
              <Fx node={n} field="flexDirection" label="Direction"><Sel value={n.flexDirection} options={FLEX_DIR} onChange={(v) => set({ flexDirection: v })} /></Fx>
              <Fx node={n} field="justifyContent" label="Justify"><Sel value={n.justifyContent} options={JUSTIFY} onChange={(v) => set({ justifyContent: v })} /></Fx>
              <Fx node={n} field="alignItems" label="Align items"><Sel value={n.alignItems} options={ALIGN} onChange={(v) => set({ alignItems: v })} /></Fx>
              <Fx node={n} field="alignSelf" label="Align self"><Sel value={n.alignSelf} options={ALIGN} onChange={(v) => set({ alignSelf: v })} /></Fx>
              <Fx node={n} field="alignContent" label="Align content"><Sel value={n.alignContent} options={ALIGN} onChange={(v) => set({ alignContent: v })} /></Fx>
              <Fx node={n} field="flexWrap" label="Wrap"><Sel value={n.flexWrap} options={WRAP} onChange={(v) => set({ flexWrap: v })} /></Fx>
              <Fx node={n} field="display" label="Display"><Sel value={n.display} options={DISPLAY} onChange={(v) => set({ display: v })} /></Fx>
              <Fx node={n} field="overflow" label="Overflow"><Sel value={n.overflow} options={OVERFLOW} onChange={(v) => set({ overflow: v })} /></Fx>
            </Group>

            <Group title="Size" open>
              <Fx node={n} field="width" label="Width"><DimIn value={n.width} onChange={(d) => set({ width: d })} /></Fx>
              <Fx node={n} field="height" label="Height"><DimIn value={n.height} onChange={(d) => set({ height: d })} /></Fx>
              <Fx node={n} field="minWidth" label="Min W"><DimIn value={n.minWidth} onChange={(d) => set({ minWidth: d })} /></Fx>
              <Fx node={n} field="maxWidth" label="Max W"><DimIn value={n.maxWidth} onChange={(d) => set({ maxWidth: d })} /></Fx>
              <Fx node={n} field="minHeight" label="Min H"><DimIn value={n.minHeight} onChange={(d) => set({ minHeight: d })} /></Fx>
              <Fx node={n} field="maxHeight" label="Max H"><DimIn value={n.maxHeight} onChange={(d) => set({ maxHeight: d })} /></Fx>
              <Fx node={n} field="flexGrow" label="Grow"><Num value={n.flexGrow} onChange={(v) => set({ flexGrow: v })} /></Fx>
              <Fx node={n} field="flexShrink" label="Shrink"><Num value={n.flexShrink} onChange={(v) => set({ flexShrink: v })} /></Fx>
              <Fx node={n} field="flexBasis" label="Basis"><Num value={n.flexBasis} onChange={(v) => set({ flexBasis: v })} /></Fx>
            </Group>

            <Group title="Spacing">
              <div className="eui-group-label">Padding</div>
              <Fx node={n} field="padding" label="T R B L"><SidesIn value={n.padding} onChange={(s) => set({ padding: s })} /></Fx>
              <div className="eui-group-label">Margin</div>
              <Fx node={n} field="margin" label="T R B L"><SidesIn value={n.margin} onChange={(s) => set({ margin: s })} /></Fx>
            </Group>

            <Group title="Position">
              <Fx node={n} field="positionType" label="Type"><Sel value={n.positionType} options={POS_TYPE} onChange={(v) => set({ positionType: v })} /></Fx>
              <Fx node={n} field="position" label="T R B L"><SidesIn value={n.position} onChange={(s) => set({ position: s })} /></Fx>
            </Group>

            <Group title="Border">
              <Fx node={n} field="borderWidth" label="Width"><SidesIn value={n.borderWidth} onChange={(s) => set({ borderWidth: s })} /></Fx>
              <Fx node={n} field="borderColor" label="Color"><ColorIn value={n.borderColor?.top} onChange={(c) => set({ borderColor: { top: c, right: c, bottom: c, left: c } })} /></Fx>
              <RadiusRow node={n} />
            </Group>

            <Group title="Effects">
              <Fx node={n} field="opacity" label="Opacity"><Num value={n.opacity} onChange={(v) => set({ opacity: v })} /></Fx>
              <Fx node={n} field="zIndex" label="Z-index"><Num value={n.zIndex} onChange={(v) => set({ zIndex: v })} /></Fx>
            </Group>

            {hasBg && n.kind !== 'image' && (
              <Group title="Background" open={n.kind === 'box' || n.kind === 'button'}>
                <Fx node={n} field="background" label="Color"><ColorIn value={n.background} onChange={(c) => set({ background: c })} /></Fx>
              </Group>
            )}

            {n.kind === 'image' && (
              <Group title="Image" open>
                <ImageSource node={n} />
                <Fx node={n} field="textureMode" label="Mode"><Sel value={n.textureMode} options={TEX_MODE} onChange={(v) => set({ textureMode: v })} /></Fx>
                {n.textureMode === 'nine-slices' && <Fx node={n} field="textureSlices" label="Slices"><SidesIn value={n.textureSlices} onChange={(s) => set({ textureSlices: s })} /></Fx>}
                <AtlasEditor node={n} />
              </Group>
            )}

            {isText && (
              <Group title="Text" open>
                <Fx node={n} field="text" label="Value"><input className="eui-input" value={n.text ?? ''} onChange={(e) => set({ text: e.target.value })} /></Fx>
                <Fx node={n} field="fontSize" label="Font size"><Num value={n.fontSize} onChange={(v) => set({ fontSize: v })} /></Fx>
                <Fx node={n} field="color" label="Color"><ColorIn value={n.color} onChange={(c) => set({ color: c })} /></Fx>
                <Fx node={n} field="font" label="Font"><Sel value={n.font} options={FONT} onChange={(v) => set({ font: v })} /></Fx>
                <Fx node={n} field="textAlign" label="Align"><Sel value={n.textAlign} options={TEXT_ALIGN} onChange={(v) => set({ textAlign: v })} /></Fx>
                <div className="eui-prop"><span className="plabel">Wrap</span><div className="pvalue"><Bool value={n.textWrap} onChange={(v) => set({ textWrap: v })} /></div></div>
                <Fx node={n} field="outlineWidth" label="Outline w"><Num value={n.outlineWidth} onChange={(v) => set({ outlineWidth: v })} /></Fx>
                <Fx node={n} field="outlineColor" label="Outline c"><ColorIn value={n.outlineColor} def={{ r: 0, g: 0, b: 0, a: 1 }} onChange={(c) => set({ outlineColor: c })} /></Fx>
                {n.kind === 'button' && <Fx node={n} field="onClick" label="onClick"><span style={{ color: 'var(--text-3)', fontSize: 11 }}>(bind a handler)</span></Fx>}
              </Group>
            )}

            {n.kind === 'input' && (
              <Group title="Input" open>
                <Fx node={n} field="placeholder" label="Placeholder"><input className="eui-input" value={n.placeholder ?? ''} onChange={(e) => set({ placeholder: e.target.value })} /></Fx>
                <Fx node={n} field="value" label="Value"><input className="eui-input" value={n.value ?? ''} onChange={(e) => set({ value: e.target.value })} /></Fx>
                <Fx node={n} field="color" label="Text color"><ColorIn value={n.color} onChange={(c) => set({ color: c })} /></Fx>
                <Fx node={n} field="placeholderColor" label="Hint color"><ColorIn value={n.placeholderColor} onChange={(c) => set({ placeholderColor: c })} /></Fx>
                <Fx node={n} field="fontSize" label="Font size"><Num value={n.fontSize} onChange={(v) => set({ fontSize: v })} /></Fx>
                <Fx node={n} field="font" label="Font"><Sel value={n.font} options={FONT} onChange={(v) => set({ font: v })} /></Fx>
                <Fx node={n} field="textAlign" label="Align"><Sel value={n.textAlign} options={TEXT_ALIGN} onChange={(v) => set({ textAlign: v })} /></Fx>
                <div className="eui-prop"><span className="plabel">Disabled</span><div className="pvalue"><Bool value={n.disabled} onChange={(v) => set({ disabled: v })} /></div></div>
                <div className="eui-prop"><span className="plabel">Multi-line</span><div className="pvalue"><Bool value={n.multiLine} onChange={(v) => set({ multiLine: v })} /></div></div>
                <Fx node={n} field="onChange" label="onChange"><span style={{ color: 'var(--text-3)', fontSize: 11 }}>(bind)</span></Fx>
                <Fx node={n} field="onSubmit" label="onSubmit"><span style={{ color: 'var(--text-3)', fontSize: 11 }}>(bind)</span></Fx>
              </Group>
            )}

            {n.kind === 'dropdown' && (
              <Group title="Dropdown" open>
                <Fx node={n} field="options" label="Options"><input className="eui-input" style={{ fontSize: 11 }} value={(n.options ?? []).join(', ')} placeholder="a, b, c" onChange={(e) => set({ options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></Fx>
                <Fx node={n} field="selectedIndex" label="Selected"><Num value={n.selectedIndex} onChange={(v) => set({ selectedIndex: v })} /></Fx>
                <div className="eui-prop"><span className="plabel">Accept empty</span><div className="pvalue"><Bool value={n.acceptEmpty} onChange={(v) => set({ acceptEmpty: v })} /></div></div>
                <Fx node={n} field="emptyLabel" label="Empty label"><input className="eui-input" value={n.emptyLabel ?? ''} onChange={(e) => set({ emptyLabel: e.target.value })} /></Fx>
                <Fx node={n} field="color" label="Text color"><ColorIn value={n.color} onChange={(c) => set({ color: c })} /></Fx>
                <Fx node={n} field="fontSize" label="Font size"><Num value={n.fontSize} onChange={(v) => set({ fontSize: v })} /></Fx>
                <Fx node={n} field="font" label="Font"><Sel value={n.font} options={FONT} onChange={(v) => set({ font: v })} /></Fx>
                <Fx node={n} field="textAlign" label="Align"><Sel value={n.textAlign} options={TEXT_ALIGN} onChange={(v) => set({ textAlign: v })} /></Fx>
                <div className="eui-prop"><span className="plabel">Disabled</span><div className="pvalue"><Bool value={n.disabled} onChange={(v) => set({ disabled: v })} /></div></div>
                <Fx node={n} field="onChange" label="onChange"><span style={{ color: 'var(--text-3)', fontSize: 11 }}>(bind)</span></Fx>
              </Group>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function RadiusRow(props: { node: UiNode }): JSX.Element {
  const { node } = props
  const r = node.borderRadius ?? {}
  const set = (k: keyof Radius, v: number | undefined): void => {
    const next: Radius = { ...node.borderRadius, [k]: v }
    const empty = (['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).every((kk) => next[kk] === undefined)
    updateNode(node.id, { borderRadius: empty ? undefined : next })
  }
  return (
    <div className="eui-prop">
      <span className="plabel">Radius</span>
      <div className="pvalue" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
        {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map((k) => (
          <Num key={k} value={r[k]} placeholder={k === 'topLeft' ? 'TL' : k === 'topRight' ? 'TR' : k === 'bottomLeft' ? 'BL' : 'BR'} onChange={(v) => set(k, v)} />
        ))}
      </div>
    </div>
  )
}

function ImageSource(props: { node: UiNode }): JSX.Element {
  const { node } = props
  const [picking, setPicking] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const choose = async (rel: string): Promise<void> => {
    const url = await uiResolveImageUrl(rel)
    updateNode(node.id, { src: rel, previewUrl: url })
    setPicking(false)
  }
  return (
    <>
      <Fx node={node} field="src" label="Source">
        <input className="eui-input" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} value={node.src ?? ''} placeholder="images/ui.png" onChange={(e) => updateNode(node.id, { src: e.target.value, previewUrl: undefined })} />
      </Fx>
      <div style={{ display: 'flex', gap: 6, padding: '2px 0 2px 100px' }}>
        <button className="eui-btn" style={{ height: 24, flex: 1 }} onClick={() => fileRef.current?.click()}>Import…</button>
        <button className="eui-btn" style={{ height: 24, flex: 1 }} onClick={async () => { setImages(await uiLoadLocalImages()); setPicking((p) => !p) }}>Pick</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
          onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const { rel, url } = await uiImportImage(f); updateNode(node.id, { src: rel, previewUrl: url }); e.target.value = '' }} />
      </div>
      {picking && (
        <div className="eui-pop-list" style={{ maxHeight: 160 }}>
          {images.length === 0 && <div className="eui-empty">no images in project</div>}
          {images.map((p) => <div key={p} className="eui-pop-item" onClick={() => void choose(p)}>{p}</div>)}
        </div>
      )}
    </>
  )
}

function AtlasEditor(props: { node: UiNode }): JSX.Element {
  const { node } = props
  const on = node.uvs !== undefined
  return (
    <div className="eui-group">
      <label className="eui-check" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={on} onChange={(e) => updateNode(node.id, { uvs: e.target.checked ? [0, 0, 0, 1, 1, 1, 1, 0] : undefined })} />
        Atlas UVs
      </label>
      {on && node.uvs && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
          {node.uvs.map((v, i) => (
            <Num key={i} value={v} onChange={(nv) => { const uvs = [...node.uvs!]; uvs[i] = nv ?? 0; updateNode(node.id, { uvs }) }} />
          ))}
        </div>
      )}
    </div>
  )
}
