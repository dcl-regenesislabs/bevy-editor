import { describe, it, expect, beforeEach } from 'vitest'
import { buildFromSchema, type ComponentSchema } from './schema'
import { state } from './state'

// Animator-shaped schema: a repeated message whose elements carry a string +
// numbers. Guards the repeated-rebuild path: untouched element fields must
// survive a commit (they were being reset to proto defaults — clips emptied).
const ANIMATOR: ComponentSchema = {
  name: 'Animator',
  root: {
    kind: 'message',
    name: '',
    fields: [
      {
        kind: 'repeated',
        name: 'states',
        element: {
          kind: 'message',
          name: 'state',
          fields: [
            { kind: 'leaf', name: 'clip', semantic: 'string', default: '' },
            { kind: 'leaf', name: 'playing', semantic: 'bool', default: false },
            { kind: 'leaf', name: 'weight', semantic: 'number', default: 1 },
            { kind: 'leaf', name: 'speed', semantic: 'number', default: 1 }
          ]
        }
      }
    ]
  },
  enums: {}
} as unknown as ComponentSchema

const VALUE = {
  states: [
    { clip: 'Idle', playing: true, weight: 1, speed: 1 },
    { clip: 'Run', playing: false, weight: 0.5, speed: 2 }
  ]
}

describe('buildFromSchema repeated elements', () => {
  beforeEach(() => {
    state.fieldEdits = new Map()
  })

  it('preserves untouched element fields on rebuild', () => {
    const res = buildFromSchema('e::Animator', ANIMATOR, VALUE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const out = JSON.parse(res.json) as typeof VALUE
    expect(out.states[0].clip).toBe('Idle')
    expect(out.states[1].clip).toBe('Run')
    expect(out.states[1].weight).toBe(0.5)
  })

  it('applies a single staged edit without clobbering siblings', () => {
    state.fieldEdits = new Map([['e::Animator::states.1.weight', '0.9']])
    const res = buildFromSchema('e::Animator', ANIMATOR, VALUE)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const out = JSON.parse(res.json) as typeof VALUE
    expect(out.states[1].weight).toBe(0.9)
    expect(out.states[1].clip).toBe('Run')
    expect(out.states[0].clip).toBe('Idle')
    expect(out.states[0].playing).toBe(true)
  })
})
