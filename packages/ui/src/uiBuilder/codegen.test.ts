import { describe, it, expect } from 'vitest'
import { generateTsx, emitJsx } from './codegen'
import { makeNode, type UiNode } from './model'

const mk = (kind: UiNode['kind'], patch: Partial<UiNode> = {}): UiNode => ({ ...makeNode(kind), ...patch })

describe('generateTsx', () => {
  it('emits SDK imports and a named component', () => {
    const out = generateTsx(mk('box'), 'MyPanel')
    expect(out).toContain("import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'")
    expect(out).toContain("import { Color4 } from '@dcl/sdk/math'")
    expect(out).toContain('export function MyPanel()')
    expect(out).toContain('<UiEntity')
  })

  it('emits %, px sizes and Color4 background', () => {
    const out = emitJsx(mk('box', { width: { value: 50, unit: '%' }, height: { value: 120, unit: 'px' }, background: { r: 1, g: 0, b: 0, a: 1 }, padding: undefined }))
    expect(out).toContain("width: '50%'")
    expect(out).toContain('height: 120')
    expect(out).toContain('uiBackground={{ color: Color4.create(1, 0, 0, 1) }}')
  })

  it('collapses uniform sides to a number, keeps partial as object', () => {
    expect(emitJsx(mk('box', { padding: { top: 8, right: 8, bottom: 8, left: 8 }, background: undefined }))).toContain('padding: 8')
    expect(emitJsx(mk('box', { padding: { top: 4, left: 12 }, background: undefined }))).toContain('padding: { top: 4, left: 12 }')
  })

  it('emits a Label child for text with align/font/outline', () => {
    const out = emitJsx(mk('text', { text: 'Hi', color: { r: 1, g: 1, b: 1, a: 1 }, font: 'serif', textAlign: 'middle-center', outlineWidth: 2, outlineColor: { r: 0, g: 0, b: 0, a: 1 } }))
    expect(out).toContain("<Label value={'Hi'}")
    expect(out).toContain("font={'serif'}")
    expect(out).toContain("textAlign={'middle-center'}")
    expect(out).toContain('outlineWidth={2}')
  })

  it('emits nine-slices + atlas uvs for image', () => {
    const out = emitJsx(mk('image', { src: 'images/x.png', textureMode: 'nine-slices', textureSlices: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 }, uvs: [0, 0, 0, 1, 1, 1, 1, 0], background: undefined }))
    expect(out).toContain("texture: { src: 'images/x.png' }")
    expect(out).toContain("textureMode: 'nine-slices'")
    expect(out).toContain('textureSlices: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 }')
    expect(out).toContain('uvs: [0, 0, 0, 1, 1, 1, 1, 0]')
  })

  it('emits Input and Dropdown components', () => {
    const inp = generateTsx(mk('input', { placeholder: 'Name', background: undefined }), 'C')
    expect(inp).toContain('<Input')
    expect(inp).toContain("placeholder={'Name'}")
    expect(inp).toContain('Input } from')
    const dd = generateTsx(mk('dropdown', { options: ['a', 'b'], background: undefined }), 'C')
    expect(dd).toContain('<Dropdown')
    expect(dd).toContain("options={['a', 'b']}")
  })

  it('emits expressions verbatim and derives a props interface', () => {
    const n = mk('button', { text: 'Go', exprs: { text: 'props.label', onClick: 'props.onGo' } })
    const out = generateTsx(n, 'C')
    expect(out).toContain('value={props.label}')
    expect(out).toContain('onMouseDown={props.onGo}')
    expect(out).toContain('label: string')
    expect(out).toContain('onGo: () => void')
  })

  it('uses an explicit propsType / importLines when provided (round-trip)', () => {
    const out = generateTsx(mk('box'), 'C', { propsType: 'props: { score: number }', importLines: ["import ReactEcs from '@dcl/sdk/react-ecs'"] })
    expect(out).toContain('export function C(props: { score: number })')
    expect(out).toContain("import ReactEcs from '@dcl/sdk/react-ecs'")
    expect(out).not.toContain('@dcl/sdk/math')
  })

  it('emits raw nodes verbatim', () => {
    const box = mk('box', { background: undefined, children: [mk('raw', { raw: '{open && <Panel />}' })] })
    expect(emitJsx(box)).toContain('{open && <Panel />}')
  })

  it('emits absolute position', () => {
    const out = emitJsx(mk('box', { positionType: 'absolute', position: { top: 20, left: 30 }, background: undefined }))
    expect(out).toContain("positionType: 'absolute'")
    expect(out).toContain('position: { top: 20, left: 30 }')
  })
})
