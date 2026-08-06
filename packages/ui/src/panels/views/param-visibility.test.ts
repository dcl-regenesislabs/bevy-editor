// The conditional-fields predicate, run against the REAL Spawner layout: its
// JSDoc `For "<choice>"` convention is the contract this mechanism keys on, so
// the spawner script itself is the fixture — a reworded doc line that breaks
// the pairing fails here, not in a creator's inspector.
import { describe, expect, it } from 'vitest'
import { getScriptParams } from '../../script/parser'
import { readPrefabFile } from '../../prefabs/builtin-fixtures'
import type { ScriptParam } from '../../script/parser'
import { isParamVisible, paramCondition, paramHint, visibleParams } from './param-visibility'

const spawner = getScriptParams(readPrefabFile('spawner/scripts/spawner.ts')).params

function withWhen(value: string): Record<string, ScriptParam> {
  return { ...spawner, when: { ...spawner.when, value } }
}

function names(params: Record<string, ScriptParam>): string[] {
  return visibleParams(params).map(([name]) => name)
}

describe('the spawner layout drives the predicate', () => {
  it('carries the doc lines the convention keys on', () => {
    expect(paramCondition(spawner.everySeconds)).toBe('every few seconds')
    expect(paramCondition(spawner.hoverLabel)).toBe('when clicked')
    expect(paramCondition(spawner.hoverLabel)).toBe('when clicked')
    expect(paramCondition(spawner.spawn)).toBeNull()
    expect(paramCondition(spawner.atMostAtOnce)).toBeNull()
  })

  it('shows only the fields the picked trigger needs', () => {
    expect(names(withWhen('when clicked'))).not.toContain('everySeconds')
    expect(names(withWhen('when clicked'))).toContain('hoverLabel')
    expect(names(withWhen('when clicked'))).toContain('hoverLabel')
    expect(names(withWhen('every few seconds'))).toContain('everySeconds')
    expect(names(withWhen('every few seconds'))).not.toContain('hoverLabel')
    expect(names(withWhen('every few seconds'))).not.toContain('hoverLabel')
    expect(names(withWhen('when a player enters'))).toContain('atMostAtOnce')
    expect(names(withWhen('when a player enters'))).not.toContain('everySeconds')
  })

  it('never hides the unconditional params', () => {
    for (const value of spawner.when.options ?? []) {
      const visible = names(withWhen(value))
      for (const name of ['spawn', 'when', 'atMostAtOnce', 'disappearsAfter']) {
        expect(visible, `"${value}" hides ${name}`).toContain(name)
      }
    }
  })

  it('keeps declaration order among what it shows', () => {
    const all = Object.keys(spawner)
    const visible = names(withWhen('when a player enters'))
    expect(visible).toEqual(all.filter((name) => visible.includes(name)))
  })
})

describe('the predicate fails open', () => {
  it('shows a param with no description', () => {
    expect(isParamVisible({ type: 'number', value: 1 }, spawner)).toBe(true)
  })

  it('shows a param whose condition no sibling dropdown offers', () => {
    const orphan: ScriptParam = { type: 'number', value: 1, description: 'For "a choice nothing offers"' }
    expect(isParamVisible(orphan, spawner)).toBe(true)
  })

  it('only reads conditions off the START of the doc line', () => {
    const mention: ScriptParam = { type: 'number', value: 1, description: 'Used with For "when clicked" spots' }
    expect(paramCondition(mention)).toBeNull()
    expect(isParamVisible(mention, withWhen('every few seconds'))).toBe(true)
  })
})

describe('paramHint', () => {
  it('strips the condition opener and its separator', () => {
    expect(paramHint(spawner.hoverLabel)).toBe('the words a player sees before they click.')
  })

  it('is empty when the doc line is only the condition', () => {
    expect(paramHint({ type: 'number', value: 1, description: 'For "every few seconds"' })).toBeUndefined()
  })

  it('passes an unconditional doc line through', () => {
    expect(paramHint(spawner.disappearsAfter)).toBe(spawner.disappearsAfter.description)
  })
})
