import { describe, it, expect } from 'vitest'
import { parseUiComponent, type ParsedUi } from './ui-ast'

const ok = (r: ReturnType<typeof parseUiComponent>): ParsedUi => {
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('parseUiComponent', () => {
  it('reads a box+label, collapsing into a text node with literals', () => {
    const r = ok(parseUiComponent(`
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
export function MyUi() {
  return (
    <UiEntity uiTransform={{ width: 100, padding: 8 }} uiBackground={{ color: Color4.create(1, 0, 0, 1) }}>
      <Label value="Hi" fontSize={14} />
    </UiEntity>
  )
}
`))
    expect(r.componentName).toBe('MyUi')
    expect(r.importLines).toHaveLength(2)
    expect(r.tree.kind).toBe('text')
    expect(r.tree.width).toEqual({ value: 100, unit: 'px' })
    expect(r.tree.padding).toEqual({ top: 8, right: 8, bottom: 8, left: 8 })
    expect(r.tree.background).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(r.tree.text).toBe('Hi')
    expect(r.tree.fontSize).toBe(14)
  })

  it('captures non-literal attribute values as expressions and reads the props type', () => {
    const r = ok(parseUiComponent(`
import ReactEcs, { Label } from '@dcl/sdk/react-ecs'
export function P(props: { score: number }) {
  return <Label value={props.score} fontSize={props.size} />
}
`))
    expect(r.propsType).toBe('props: { score: number }')
    expect(r.tree.kind).toBe('text')
    expect(r.tree.exprs.text).toBe('props.score')
    expect(r.tree.exprs.fontSize).toBe('props.size')
  })

  it('keeps dynamic JSX children as raw nodes', () => {
    const r = ok(parseUiComponent(`
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
export function P() {
  return (
    <UiEntity uiTransform={{ width: 200 }}>
      {open && <Panel />}
      {items.map((i) => <Row key={i} />)}
    </UiEntity>
  )
}
`))
    expect(r.tree.kind).toBe('box')
    const raws = r.tree.children.filter((c) => c.kind === 'raw')
    expect(raws).toHaveLength(2)
    expect(raws[0].raw).toBe('{open && <Panel />}')
    expect(raws[1].raw).toContain('items.map')
  })

  it('reads Input and Dropdown', () => {
    const r = ok(parseUiComponent(`
import ReactEcs, { Input, Dropdown } from '@dcl/sdk/react-ecs'
export function P() {
  return (
    <Dropdown options={['a', 'b']} selectedIndex={1} disabled={false} />
  )
}
`))
    expect(r.tree.kind).toBe('dropdown')
    expect(r.tree.options).toEqual(['a', 'b'])
    expect(r.tree.selectedIndex).toBe(1)
  })

  it('maps a button (onMouseDown) and captures the handler expression', () => {
    const r = ok(parseUiComponent(`
import ReactEcs, { Label, UiEntity } from '@dcl/sdk/react-ecs'
export function P(props: { onGo: () => void }) {
  return (
    <UiEntity uiTransform={{ width: 120 }} onMouseDown={props.onGo}>
      <Label value="Go" />
    </UiEntity>
  )
}
`))
    expect(r.tree.kind).toBe('button')
    expect(r.tree.exprs.onClick).toBe('props.onGo')
    expect(r.tree.text).toBe('Go')
  })

  it('gives a span that splices cleanly, leaving imports intact', () => {
    const source = `import ReactEcs, { Label } from '@dcl/sdk/react-ecs'
export function P() {
  return (
    <Label value="old" />
  )
}
`
    const r = ok(parseUiComponent(source))
    const spliced = source.slice(0, r.jsxStart) + '<Label value="new" />' + source.slice(r.jsxEnd)
    expect(spliced).toContain('<Label value="new" />')
    expect(spliced).not.toContain('value="old"')
    expect(spliced).toContain("import ReactEcs, { Label } from '@dcl/sdk/react-ecs'")
  })

  it('inlines a resolved child component (preview) with literal props baked in', () => {
    const healthBar = `
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
export function HealthBar(props: { percent: number }) {
  return (
    <UiEntity uiTransform={{ width: 240, height: 20 }} uiBackground={{ color: Color4.create(0, 0, 0, 1) }}>
      <UiEntity uiTransform={{ width: props.percent, height: '100%' }} uiBackground={{ color: Color4.create(0, 1, 0, 1) }} />
    </UiEntity>
  )
}`
    const resolve = (name: string): string | null => (name === 'HealthBar' ? healthBar : null)
    const r = parseUiComponent(`
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { HealthBar } from './HealthBar'
export function Hud() {
  return (
    <UiEntity uiTransform={{ width: 300 }}>
      <HealthBar percent={80} />
    </UiEntity>
  )
}
`, { resolve })
    if (!r.ok) throw new Error(r.error)
    const raw = r.tree.children[0]
    expect(raw.kind).toBe('raw')
    expect(raw.raw).toContain('<HealthBar')
    // preview present; the inner fill's width prop was baked to the literal 80
    const preview = raw.preview as { children: Array<{ width?: unknown; exprs: Record<string, string> }> }
    expect(preview).toBeTruthy()
    expect(preview.children[0].width).toEqual({ value: 80, unit: 'px' })
    expect(preview.children[0].exprs.width).toBeUndefined()
  })

  it('keeps a child prop dynamic when the call site passes an expression', () => {
    const badge = `
import ReactEcs, { Label } from '@dcl/sdk/react-ecs'
export function Badge(props: { text: string }) { return <Label value={props.text} /> }`
    const r = parseUiComponent(`
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Badge } from './Badge'
export function P(props: { name: string }) {
  return <UiEntity><Badge text={props.name} /></UiEntity>
}
`, { resolve: (n) => (n === 'Badge' ? badge : null) })
    if (!r.ok) throw new Error(r.error)
    const preview = r.tree.children[0].preview as { exprs: Record<string, string> }
    expect(preview.exprs.text).toBe('props.name')
  })

  it('reads texture/nine-slices as an image node', () => {
    const r = ok(parseUiComponent(`
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
export function P() {
  return <UiEntity uiBackground={{ texture: { src: 'images/x.png' }, textureMode: 'nine-slices', textureSlices: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 } }} />
}
`))
    expect(r.tree.kind).toBe('image')
    expect(r.tree.src).toBe('images/x.png')
    expect(r.tree.textureMode).toBe('nine-slices')
    expect(r.tree.textureSlices).toEqual({ top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 })
  })
})
