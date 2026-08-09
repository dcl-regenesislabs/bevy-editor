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

  // The documented fork from Creator Hub parser parity: a PrefabRef param is a
  // picker over Spawnable prefabs, not a text field, and PrefabRef[] is the only
  // array param type in v1.
  it('types PrefabRef and PrefabRef[] params as prefab pickers', () => {
    const { params, error } = getScriptParams(`
      import { Entity } from '@dcl/sdk/ecs'
      import { type PrefabRef } from './spawnables'
      export class Director {
        constructor(
          public src: string,
          public entity: Entity,
          public zombie: PrefabRef = '',
          public arenas: PrefabRef[] = [],
          public spares: Array<PrefabRef>,
          public label: string = 'x'
        ) {}
      }
    `)
    expect(error).toBeUndefined()
    expect(params).toEqual({
      zombie: { type: 'prefab', optional: true, value: '' },
      arenas: { type: 'prefabList', optional: true, value: [] },
      spares: { type: 'prefabList', optional: false, value: [] },
      label: { type: 'string', optional: true, value: 'x' }
    })
  })

  // `Entity` is a branded number, so `= 0` does not typecheck and every script
  // that wants a blank entity picker has to cast. The cast must not eat the value.
  it('reads an entity default written as a cast', () => {
    const { params, error } = getScriptParams(`
      import { Entity } from '@dcl/sdk/ecs'
      export class Spawner {
        constructor(
          public src: string,
          public entity: Entity,
          public clickable: Entity = 0 as Entity,
          public target: Entity = 512 as Entity
        ) {}
      }
    `)
    expect(error).toBeUndefined()
    expect(params.clickable).toEqual({ type: 'entity', optional: true, value: 0 })
    expect(params.target).toEqual({ type: 'entity', optional: true, value: 512 })
  })

  // The JSDoc line over each constructor param rides into the layout, where the
  // inspector shows it and keys conditional fields off its `For "<choice>"` opener.
  it('carries each param JSDoc line as its description', () => {
    const { params, error } = getScriptParams(`
      import { Entity } from '@dcl/sdk/ecs'
      export class Spawner {
        constructor(
          public src: string,
          public entity: Entity,
          /** What makes a copy appear */
          public when: 'when clicked' | 'every few seconds' = 'when clicked',
          /** For "every few seconds": how many seconds between copies. */
          public everySeconds: number = 10,
          public bare: number = 1
        ) {}
      }
    `)
    expect(error).toBeUndefined()
    expect(params.when.description).toBe('What makes a copy appear')
    expect(params.everySeconds.description).toBe('For "every few seconds": how many seconds between copies.')
    expect(params.bare).toEqual({ type: 'number', optional: true, value: 1 })
  })

  it('keeps the refs a PrefabRef[] param defaults to', () => {
    const { params } = getScriptParams(`
      export function start(src: string, entity: Entity, arenas: PrefabRef[] = ['a', 'b']) {}
    `)
    expect(params.arenas.value).toEqual(['a', 'b'])
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

  it('mergeLayout falls back to the fresh default when the stored enum value was removed', () => {
    const fresh = {
      params: {
        mode: { type: 'enum' as const, value: 'walk', options: ['walk', 'run'] }
      },
      actions: []
    }
    const edited = {
      params: {
        mode: { type: 'enum' as const, value: 'fly', options: ['walk', 'run', 'fly'] }
      }
    }
    const merged = mergeLayout(fresh, edited)
    expect(merged.params.mode).toEqual({ type: 'enum', value: 'walk', options: ['walk', 'run'] })
  })

  it('mergeLayout keeps a still-listed enum value under the fresh option list', () => {
    const fresh = {
      params: {
        mode: { type: 'enum' as const, value: 'walk', options: ['walk', 'run', 'crawl'] }
      },
      actions: []
    }
    const edited = {
      params: { mode: { type: 'enum' as const, value: 'run', options: ['walk', 'run'] } }
    }
    const merged = mergeLayout(fresh, edited)
    expect(merged.params.mode).toEqual({
      type: 'enum',
      value: 'run',
      options: ['walk', 'run', 'crawl']
    })
  })

  it('mergeLayout falls back to the fresh default when the stored value is mistyped', () => {
    const fresh = {
      params: {
        speed: { type: 'number' as const, value: 30 },
        active: { type: 'boolean' as const, value: true },
        arenas: { type: 'prefabList' as const, value: [] as string[] }
      },
      actions: []
    }
    const edited = {
      params: {
        speed: { type: 'number' as const, value: 'abc' as unknown as number },
        active: { type: 'boolean' as const, value: 'true' as unknown as boolean },
        arenas: { type: 'prefabList' as const, value: [1, 2] as unknown as string[] }
      }
    }
    const merged = mergeLayout(fresh, edited)
    expect(merged.params.speed.value).toBe(30)
    expect(merged.params.active.value).toBe(true)
    expect(merged.params.arenas.value).toEqual([])
  })

  it('mergeLayout accepts both engine ids and folder markers for entity params', () => {
    const fresh = {
      params: { target: { type: 'entity' as const, value: 0 } },
      actions: []
    }
    const asEngineId = mergeLayout(fresh, {
      params: { target: { type: 'entity' as const, value: 512 } }
    })
    expect(asEngineId.params.target.value).toBe(512)
    const asMarker = mergeLayout(fresh, {
      params: { target: { type: 'entity' as const, value: '{entity:5}' } }
    })
    expect(asMarker.params.target.value).toBe('{entity:5}')
    const asJunk = mergeLayout(fresh, {
      params: { target: { type: 'entity' as const, value: 'Front Door' } }
    })
    expect(asJunk.params.target.value).toBe(0)
  })

  it('mergeLayout lets the fresh parse own everything but the value', () => {
    const fresh = {
      params: { speed: { type: 'number' as const, optional: true, value: 30 } },
      actions: []
    }
    const edited = {
      params: {
        speed: {
          type: 'number' as const,
          optional: false,
          value: 99,
          options: ['stale'],
          stray: 'kept-nowhere'
        } as unknown as (typeof fresh.params)['speed']
      }
    }
    const merged = mergeLayout(fresh, edited)
    expect(merged.params.speed).toEqual({ type: 'number', optional: true, value: 99 })
  })

  // A stored layout keeps the creator's value, never the old wording: the source
  // file's doc line wins, and a description the source dropped goes away.
  it('mergeLayout keeps the freshly parsed description', () => {
    const fresh = {
      params: {
        speed: { type: 'number' as const, value: 30, description: 'New wording' },
        undocumented: { type: 'number' as const, value: 1 }
      },
      actions: []
    }
    const edited = {
      params: {
        speed: { type: 'number' as const, value: 99, description: 'Old wording' },
        undocumented: { type: 'number' as const, value: 2, description: 'Dropped from source' }
      }
    }
    const merged = mergeLayout(fresh, edited)
    expect(merged.params.speed).toEqual({ type: 'number', value: 99, description: 'New wording' })
    expect(merged.params.undocumented).toEqual({ type: 'number', value: 2 })
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

  // `isServer` does not exist in the SDK a new scene ships with — the capability
  // probe tests for that very absence — so the default is the shape that compiles
  // anywhere. A creator who has no Multiplayer Server never meets the branch.
  it('scaffolds no branch, and nothing to import, without a Multiplayer Server', () => {
    const src = getScriptTemplateClass('rotator')
    expect(src).not.toContain('isServer')
    expect(src).not.toContain('@dcl/sdk/network')
    expect(src.split('\n')[0]).toBe("import { Entity } from '@dcl/sdk/ecs'")
  })

  // The one fact the file has to carry: both methods run on both sides. The
  // branch is written the SAME way round in each, because an inverted twin eight
  // lines away makes the reader re-derive what `isServer()` means per method.
  it('scaffolds the identical, never-inverted branch in start() and update()', () => {
    const src = getScriptTemplateClass('rotator', true)
    expect(src).toContain("import { isServer } from '@dcl/sdk/network'")
    expect(src).not.toContain('!isServer')
    expect(src.split('if (isServer()) {').length - 1).toBe(2)
    expect(src.split('    }\n    // the client').length - 1).toBe(2)
    const { params, error } = getScriptParams(src)
    expect(error).toBeUndefined()
    expect(params).toEqual({})
  })

  // update() running on the Multiplayer Server is the most surprising fact in the
  // model, so its half ships written rather than left for the creator to add.
  it('names both sides in update(), not only in start()', () => {
    const [, update] = getScriptTemplateClass('rotator', true).split('update(dt: number) {')
    expect(update).toContain('if (isServer()) {')
    expect(update).toContain('// the Multiplayer Server: update() runs here too, every frame')
    expect(update).toContain('return')
    expect(update).toContain("// the client: this player's own copy, every frame")
  })

  // The branch teaches the sides; it does not drag the game module's whole
  // vendored closure into every scene that scaffolds a script.
  it('imports nothing from the game module either way', () => {
    expect(getScriptTemplateClass('rotator')).not.toContain('runtime/game')
    expect(getScriptTemplateClass('rotator', true)).not.toContain('runtime/game')
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

  // The two scaffolds are the only places the editor states the sides model, so
  // they must state the same one. A reaction is client work — only a player's
  // own client knows where that player is — and saying so keeps the server from
  // running the bus listener and this update() for an avatar it does not have.
  it('declares the zone reaction client-side once the scene has a Multiplayer Server', () => {
    const plain = getZoneReactionTemplate('zone-reaction')
    expect(plain).not.toContain('isServer')

    const src = getZoneReactionTemplate('zone-reaction', true)
    expect(src).toContain("import { isServer } from '@dcl/sdk/network'")
    expect(src).not.toContain('!isServer')
    expect(src.split('if (isServer()) return').length - 1).toBe(2)
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
