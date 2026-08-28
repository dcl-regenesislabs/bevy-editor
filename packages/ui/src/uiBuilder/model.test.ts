import { describe, it, expect, beforeEach } from 'vitest'
import { ui, addChild, moveNode, makeNode, loadTree, rootNode } from './model'

const resetUi = (): void => loadTree(rootNode())

const childIds = (): string[] => ui.root.children.map((c) => c.id)

describe('moveNode', () => {
  beforeEach(() => resetUi())

  it('same-parent move to a later slot compensates for the removal shift', () => {
    addChild(ui.root.id, 'box')
    addChild(ui.root.id, 'text')
    addChild(ui.root.id, 'button')
    const [a, b, c] = childIds()
    // "drop A after C" arrives as pre-removal index 3
    moveNode(a, ui.root.id, 3)
    expect(childIds()).toEqual([b, c, a])
  })

  it('same-parent move to an earlier slot keeps the raw index', () => {
    addChild(ui.root.id, 'box')
    addChild(ui.root.id, 'text')
    addChild(ui.root.id, 'button')
    const [a, b, c] = childIds()
    moveNode(c, ui.root.id, 0)
    expect(childIds()).toEqual([c, a, b])
  })

  it('reparents into a nested box at the given index', () => {
    addChild(ui.root.id, 'box')
    addChild(ui.root.id, 'text')
    const [box, text] = childIds()
    moveNode(text, box, 0)
    expect(childIds()).toEqual([box])
    expect(ui.root.children[0].children.map((c) => c.id)).toEqual([text])
  })
})

describe('flow-first defaults', () => {
  it('never seeds positionType or position on any kind', () => {
    for (const kind of ['box', 'text', 'button', 'image', 'input', 'dropdown', 'raw'] as const) {
      const n = makeNode(kind)
      expect(n.positionType).toBeUndefined()
      expect(n.position).toBeUndefined()
    }
  })

  it('root is an explicit column (SDK default is row)', () => {
    resetUi()
    expect(ui.root.flexDirection).toBe('column')
  })
})
