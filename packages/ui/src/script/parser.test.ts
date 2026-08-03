import { describe, expect, it } from 'vitest'
import { getScriptParams, mergeLayout, parseLayout } from './parser'
import { buildScriptPath, getScriptTemplateClass, getZoneReactionTemplate, toPascalCase } from './template'

describe('getScriptParams', () => {
  it('parses class constructor params after src/entity', () => {
    const { params, error } = getScriptParams(`
      import { Entity } from '@dcl/sdk/ecs'
      export class Foo {
        constructor(
          public src: string,
          public entity: Entity,
          public speed: number = 30,
          public label: string,
          public enabled: boolean = true,
          public target: Entity
        ) {}
        start() {}
        update(dt: number) {}
      }
    `)
    expect(error).toBeUndefined()
    expect(params).toEqual({
      speed: { type: 'number', optional: true, value: 30 },
      label: { type: 'string', optional: false, value: '' },
      enabled: { type: 'boolean', optional: true, value: true },
      target: { type: 'entity', optional: false, value: 0 }
    })
  })

  it('parses functional scripts (export function start)', () => {
    const { params } = getScriptParams(`
      import { Entity } from '@dcl/sdk/ecs'
      export function start(src: string, entity: Entity, radius: number = 2) {}
    `)
    expect(params).toEqual({ radius: { type: 'number', optional: true, value: 2 } })
  })

  it('reports a signature error when src/entity are missing', () => {
    const { error } = getScriptParams(`
      export class Bad { constructor(public speed: number) {} }
    `)
    expect(error).toContain('First parameter')
  })

  it('reports parse errors on invalid source', () => {
    const { error } = getScriptParams('export class {{{')
    expect(error).not.toBe('')
    expect(error).toBeDefined()
  })

  it('collects @action-tagged methods', () => {
    const { actions } = getScriptParams(`
      import { Entity } from '@dcl/sdk/ecs'
      export class Door {
        constructor(public src: string, public entity: Entity) {}
        /**
         * Opens the door
         * @action
         */
        open(speed: number = 1) {}
      }
    `)
    expect(actions).toHaveLength(1)
    expect(actions[0].methodName).toBe('open')
    expect(actions[0].description).toBe('Opens the door')
  })
})

describe('layout helpers', () => {
  it('parseLayout round-trips and tolerates garbage', () => {
    expect(parseLayout(undefined)).toBeUndefined()
    expect(parseLayout('not json')).toBeUndefined()
    expect(parseLayout('{"params":{}}')).toEqual({ params: {} })
  })

  it('mergeLayout keeps edited values for matching name+type, adopts new params', () => {
    const fresh = {
      params: {
        speed: { type: 'number' as const, optional: true, value: 30 },
        added: { type: 'string' as const, optional: false, value: '' }
      },
      actions: []
    }
    const edited = {
      params: {
        speed: { type: 'number' as const, optional: true, value: 99 },
        removed: { type: 'string' as const, optional: false, value: 'gone' }
      }
    }
    const merged = mergeLayout(fresh, edited)
    expect(merged.params.speed.value).toBe(99) // user edit preserved
    expect(merged.params.added).toEqual(fresh.params.added) // new param adopted
    expect(merged.params.removed).toBeUndefined() // dropped param removed
  })
})

describe('template', () => {
  it('builds src/scripts paths', () => {
    expect(buildScriptPath('rotator')).toBe('src/scripts/rotator.ts')
    expect(buildScriptPath('rotator.tsx')).toBe('src/scripts/rotator.tsx')
    expect(buildScriptPath('src/scripts/x.ts')).toBe('src/scripts/x.ts')
  })

  it('scaffolds a parseable class whose name derives from the file name', () => {
    expect(toPascalCase('my-cool thing', 'Script')).toBe('MyCoolThingScript')
    const src = getScriptTemplateClass('rotator')
    expect(src).toContain('export class RotatorScript')
    const { params, error } = getScriptParams(src)
    expect(error).toBeUndefined()
    expect(params).toEqual({})
  })

  // Attaching it to the zone IS the configuration, so the scaffold has no params
  // at all — nothing to fill in, nothing to typo.
  it('scaffolds a zone reaction with no params, resolving the zone from the entity', () => {
    const src = getZoneReactionTemplate('zone-reaction')
    expect(src).toContain('export class ZoneReaction')
    expect(src).toContain('zoneOf(this.entity)')
    const { params, error } = getScriptParams(src)
    expect(error).toBeUndefined()
    expect(params).toEqual({})
  })

  // Enter is only a third of the story: leaving and "while inside" have to be
  // visible in the file, or the creator never learns the zone can do them.
  it('shows the creator enter, exit and occupancy', () => {
    const src = getZoneReactionTemplate('zone-reaction')
    expect(src).toContain("'any'")
    expect(src).toContain("event.kind === 'enter'")
    expect(src).toContain('isInZone')
  })
})

// Every param a script declares is shown, always. A script's constructor is the
// creator's own contract with the inspector, so the inspector doesn't get to decide
// that some of it is too advanced to look at.
describe('param visibility', () => {
  it('reports every param, with no hidden or advanced tier', () => {
    const { params } = getScriptParams(`export class Zone {
      constructor(
        public src: string,
        public entity: Entity,
        /** How often it fires */
        public fireWhen: 'every time' | 'once ever' = 'every time',
        /** Boundary hysteresis. */
        public exitDelay: number = 0.3
      ) {}
    }`)
    expect(Object.keys(params)).toEqual(['fireWhen', 'exitDelay'])
    expect(JSON.stringify(params)).not.toContain('advanced')
  })
})
