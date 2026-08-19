import { describe, expect, it } from 'vitest'
import {
  parseRequests,
  prefabSlug,
  resolveEntityRef,
  resolvePrefabRef,
  resolvePrefabSource,
  type PrefabRefChoice
} from './request-format'
import type { Snapshot } from '@scene/state'

const NAME = 'core-schema::Name'

describe('parseRequests', () => {
  it('reads a well-formed place + attach pair', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({
        version: 1,
        requests: [
          {
            type: 'placePrefab',
            slug: 'trigger-zone',
            name: 'Front Door Zone',
            position: { x: 8, y: 1.5, z: 10 },
            scale: { x: 4, y: 3, z: 4 },
            params: { who: 'any player', cooldown: 0.5, loud: true }
          },
          { type: 'attachScript', script: 'src/scripts/HallDoor.ts', to: 'Front Door' }
        ]
      })
    )
    expect(problems).toEqual([])
    expect(requests).toEqual([
      {
        type: 'placePrefab',
        slug: 'trigger-zone',
        name: 'Front Door Zone',
        position: { x: 8, y: 1.5, z: 10 },
        scale: { x: 4, y: 3, z: 4 },
        params: { who: 'any player', cooldown: 0.5, loud: true }
      },
      { type: 'attachScript', script: 'src/scripts/HallDoor.ts', to: 'Front Door' }
    ])
  })

  it('accepts a bare array', () => {
    const { requests } = parseRequests('[{"type":"placePrefab","slug":"trigger-zone"}]')
    expect(requests).toHaveLength(1)
  })

  it('never throws on garbage', () => {
    expect(parseRequests('not json at all')).toEqual({
      requests: [],
      problems: ['the assistant left a request file that is not valid JSON']
    })
    expect(parseRequests('{"version":1}').requests).toEqual([])
    expect(parseRequests('null').requests).toEqual([])
  })

  it('skips the bad request and keeps the good one', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({
        requests: [
          { type: 'summonDragon', slug: 'dragon' },
          { type: 'placePrefab' },
          'a string',
          { type: 'attachScript', script: 'src/index.ts' },
          { type: 'attachScript', script: 'src/scripts/Ok.ts' }
        ]
      })
    )
    expect(requests).toEqual([{ type: 'attachScript', script: 'src/scripts/Ok.ts' }])
    expect(problems).toEqual([
      'skipped an unknown request "summonDragon"',
      'skipped a place request with no prefab named',
      'skipped a request that was not an object',
      'skipped "src/index.ts" — only files in src/scripts/ attach to an entity'
    ])
  })

  it('drops an unreadable position but still places the prefab', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({ requests: [{ type: 'placePrefab', slug: 'trigger-zone', position: { x: 1, y: 'up' } }] })
    )
    expect(requests).toEqual([{ type: 'placePrefab', slug: 'trigger-zone' }])
    expect(problems).toEqual(['ignored an unreadable position for "trigger-zone"'])
  })

  it('keeps a list of prefab names, and refuses a list of anything else', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({
        requests: [
          { type: 'placePrefab', slug: 'level-slots', params: { arenas: ['Ruins', ' Rooftop ', ''], counts: [1, 2] } }
        ]
      })
    )
    expect((requests[0] as { params?: unknown }).params).toEqual({ arenas: ['Ruins', 'Rooftop'] })
    expect(problems).toEqual(['ignored the param "counts" — a list may only hold prefab names or positions'])
  })

  it('reads a setParams request and needs both halves of it', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({
        requests: [
          { type: 'setParams', to: 'Wave Director', params: { zombie: 'Zombie Basic' } },
          { type: 'setParams', params: { zombie: 'Zombie Basic' } },
          { type: 'setParams', to: 'Level Slots' }
        ]
      })
    )
    expect(requests).toEqual([{ type: 'setParams', to: 'Wave Director', params: { zombie: 'Zombie Basic' } }])
    expect(problems).toEqual([
      'skipped a settings change with no entity named',
      'skipped the settings change for "Level Slots" — it named no settings'
    ])
  })

  it('rejects param values that are not scalars', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({
        requests: [{ type: 'placePrefab', slug: 'z', params: { ok: 1, bad: { x: 1 }, nan: NaN } }]
      })
    )
    expect((requests[0] as { params?: unknown }).params).toEqual({ ok: 1 })
    expect(problems).toHaveLength(2)
  })

  it('normalises the reported script path and notes an odd version', () => {
    const { requests, problems } = parseRequests(
      JSON.stringify({
        version: 2,
        requests: [{ type: 'attachScript', script: '/Users/me/scene/src/scripts/Door.ts' }]
      })
    )
    expect(requests).toEqual([{ type: 'attachScript', script: 'src/scripts/Door.ts' }])
    expect(problems).toEqual(['the request file claims version 2 — reading it as version 1'])
  })

  it('caps a runaway file', () => {
    const many = Array.from({ length: 40 }, () => ({ type: 'placePrefab', slug: 'trigger-zone' }))
    const { requests, problems } = parseRequests(JSON.stringify({ requests: many }))
    expect(requests).toHaveLength(24)
    expect(problems).toEqual(['only the first 24 requests were run'])
  })
})

describe('resolveEntityRef', () => {
  const snapshot: Snapshot = {
    '512': { [NAME]: { value: 'Front Hall' } },
    '513': { [NAME]: { value: 'Door' } }
  }

  it('takes an id verbatim', () => {
    expect(resolveEntityRef(snapshot, '513')).toBe('513')
  })

  it('matches a name case- and whitespace-insensitively', () => {
    expect(resolveEntityRef(snapshot, ' FRONT hall ')).toBe('512')
  })

  it('answers null for a name nothing carries', () => {
    expect(resolveEntityRef(snapshot, 'Back Hall')).toBeNull()
    expect(resolveEntityRef(snapshot, '   ')).toBeNull()
  })
})

describe('resolvePrefabSource', () => {
  it('prefers the library, which copies itself into the project', () => {
    expect(
      resolvePrefabSource('trigger-zone', ['custom/trigger-zone'], ['builtin:trigger-zone'])
    ).toEqual({ kind: 'library', ref: 'builtin:trigger-zone' })
  })

  it('falls back to a project-only prefab', () => {
    expect(resolvePrefabSource('custom/my-thing', ['custom/my-thing'], [])).toEqual({
      kind: 'project',
      folder: 'custom/my-thing'
    })
  })

  it('answers null for a prefab nobody has', () => {
    expect(resolvePrefabSource('dragon', ['custom/trigger-zone'], ['builtin:seat'])).toBeNull()
  })
})

describe('resolvePrefabRef', () => {
  const choices: PrefabRefChoice[] = [
    { id: 'uuid-zombie', name: 'Zombie Basic', folder: 'custom/zombie_basic' },
    { id: 'uuid-crate', name: 'Crate', folder: 'custom/crate' },
    { id: 'uuid-ruins-a', name: 'Ruins', folder: 'custom/ruins' },
    { id: 'uuid-ruins-b', name: 'Ruins', folder: 'custom/ruins_2' }
  ]

  it('resolves the display name the assistant reads out of the context', () => {
    expect(resolvePrefabRef(' zombie BASIC ', choices)).toEqual({ id: 'uuid-zombie' })
  })

  it('takes a folder slug or the id itself', () => {
    expect(resolvePrefabRef('zombie-basic', choices)).toEqual({ id: 'uuid-zombie' })
    expect(resolvePrefabRef('uuid-zombie', choices)).toEqual({ id: 'uuid-zombie' })
  })

  it('clears the setting on an empty ref', () => {
    expect(resolvePrefabRef('  ', choices)).toEqual({ id: '' })
  })

  it('refuses rather than guessing between two prefabs of the same name', () => {
    const result = resolvePrefabRef('Ruins', choices)
    expect(result).toEqual({
      problem: '"Ruins" matches 2 prefabs (custom/ruins, custom/ruins_2) — name one of those folders instead'
    })
    expect(resolvePrefabRef('custom/ruins_2', choices)).toEqual({ id: 'uuid-ruins-b' })
  })

})

describe('prefabSlug', () => {
  it('strips scope and folder dressing', () => {
    expect(prefabSlug('builtin:trigger-zone')).toBe('trigger-zone')
    expect(prefabSlug('custom/Trigger-Zone')).toBe('trigger-zone')
    expect(prefabSlug('trigger-zone')).toBe('trigger-zone')
  })

  // A project copy's folder comes from the prefab NAME ("Trigger Zone" →
  // trigger_zone), so it must key the same as the hyphenated library slug.
  it('folds separators so a project copy matches its library slug', () => {
    expect(prefabSlug('custom/trigger_zone')).toBe(prefabSlug('builtin:trigger-zone'))
    expect(prefabSlug('custom/zone_authority')).toBe(prefabSlug('builtin:zone-authority'))
  })
})
