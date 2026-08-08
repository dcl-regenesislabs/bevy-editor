import { describe, it, expect } from 'vitest'
import { readPrefabFile } from './builtin-fixtures'
import {
  PENDING_LABEL,
  PLANNED_GUARANTEE,
  chipsFromModes,
  guaranteeChips,
  guaranteeSummaries,
  modesFromCalls,
  scanSpawnCalls,
  scriptLayouts,
  spawnCallsIn,
  spawnModesFor,
  summariesFromModes
} from './guarantees'
import type { PrefabData } from './format'

const zombie: PrefabData = {
  id: 'zombie-uuid',
  name: 'Zombie Basic',
  category: 'custom',
  tags: [],
  spawnable: { max: 64 }
}

const arena: PrefabData = {
  id: 'arena-uuid',
  name: 'Arena Graveyard',
  category: 'custom',
  tags: [],
  spawnable: { max: 4 }
}

const plain: PrefabData = { id: 'bench-uuid', name: 'Bench', category: 'custom', tags: [] }

// wave-director.ts, as the kit actually writes it: a renamed named import, the
// plan callback in the middle of the argument list, options after it.
const waveDirector = `
import { plan as openPlannedPool, type Pool } from './runtime/spawner'

export class WaveDirector {
  constructor(public src: string, public entity: Entity, public zombie: PrefabRef = '') {}
  start(): void {
    this.pool = openPlannedPool(this.zombie, (tuple) => buildWavePlan(tuple, this.planConfig(), createRng), {
      outcomes: ['hit', 'bite']
    })
  }
}
`

// level-slots.ts: the ref reaches the call through a field and a helper, so the
// first argument is a local and only the script's own params can place it.
const levelSlots = `
import { pool as openPool, poolFor as existingPool, type Pool } from './runtime/spawner'

export class LevelSlots {
  private refs: string[] = []
  constructor(public src: string, public entity: Entity, public arenas: PrefabRef[] = []) {}
  start(): void {
    this.refs = normalizeRefs(this.arenas)
  }
  private arenaPool(ref: string): Pool | null {
    return openPool(ref, 'seeded')
  }
}
`

// Layouts are keyed by SCRIPT PATH: the params of the rows that run that file.
const layouts = {
  'a.ts': [{ zombie: { type: 'prefab', value: 'zombie-uuid' } }],
  'b.ts': [{ arenas: { type: 'prefabList', value: ['arena-uuid'] }, slotCount: { type: 'number', value: 2 } }]
}

describe('spawnCallsIn', () => {
  it('reads a renamed named import and keeps the callback out of the argument split', () => {
    expect(spawnCallsIn(waveDirector, 'custom/wave_director/scripts/wave-director.ts')).toEqual([
      {
        script: 'custom/wave_director/scripts/wave-director.ts',
        mode: 'planned',
        ref: { kind: 'param', name: 'zombie' }
      }
    ])
  })

  it('reads a namespace import', () => {
    const text = `
      import * as spawner from './runtime/spawner'
      spawner.perPlayer(Spawnables.PlayerRig)
      spawner.pool(this.slot, 'server')
    `
    expect(spawnCallsIn(text)).toEqual([
      { script: '', mode: 'perPlayer', ref: { kind: 'alias', name: 'PlayerRig' } },
      { script: '', mode: 'server', ref: { kind: 'param', name: 'slot' } }
    ])
  })

  it('ignores a commented-out import and the calls under it', () => {
    const text = `
      // import { plan } from './runtime/spawner'
      /* plan(this.zombie, () => []) */
      const plan = (a: string) => a
      plan(this.zombie)
    `
    expect(spawnCallsIn(text)).toEqual([])
  })

  it('ignores an import from anything that is not the spawner module', () => {
    const text = `
      import { pool } from './runtime/water-pool'
      pool(this.zombie, 'server')
    `
    expect(spawnCallsIn(text)).toEqual([])
  })

  it('drops a pool() whose mode is not a literal — a guessed mode is worse than none', () => {
    const text = `
      import { pool } from './runtime/spawner'
      pool(this.zombie, mode)
    `
    expect(spawnCallsIn(text)).toEqual([])
  })

  it('does not match a method that merely ends in the imported name', () => {
    const text = `
      import { plan } from './runtime/spawner'
      this.replan(this.zombie)
      other.plan(this.zombie)
    `
    expect(spawnCallsIn(text)).toEqual([])
  })

  it('reads a string-literal prefab id', () => {
    const text = `
      import { pool } from './runtime/spawner'
      pool('zombie-uuid', 'seeded')
    `
    expect(spawnCallsIn(text)).toEqual([
      { script: '', mode: 'seeded', ref: { kind: 'literal', value: 'zombie-uuid' } }
    ])
  })
})

describe('scanSpawnCalls', () => {
  it('skips carried runtime modules — the spawner is not its own consumer', () => {
    const scripts = {
      'custom/wave_director/scripts/runtime/spawner.ts': `
        export function pool(prefab: string, mode: 'server' | 'seeded') {}
        import { pool } from './spawner'
        pool(this.anything, 'server')
      `
    }
    expect(scanSpawnCalls(scripts)).toEqual([])
  })
})

describe('spawnModesFor', () => {
  it('resolves this.<param> through the layout that holds the prefab id', () => {
    expect(spawnModesFor({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts })).toEqual(['planned'])
  })

  it('resolves a PrefabRef[] param through the script that mentions it', () => {
    expect(spawnModesFor({ data: arena, scripts: { 'b.ts': levelSlots }, layouts })).toEqual(['seeded'])
  })

  it('does not attribute one script’s pool to a prefab it never names', () => {
    expect(spawnModesFor({ data: arena, scripts: { 'a.ts': waveDirector }, layouts })).toEqual([])
    expect(spawnModesFor({ data: zombie, scripts: { 'b.ts': levelSlots }, layouts })).toEqual([])
  })

  it('reads a layout passed as bare values too', () => {
    const bare = { 'a.ts': [{ zombie: 'zombie-uuid' }] }
    expect(spawnModesFor({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts: bare })).toEqual(['planned'])
  })

  // The tightening: attribution is per consumer, and per param type.
  it('does not resolve a param through another script’s layout', () => {
    const elsewhere = { 'z.ts': [{ zombie: { type: 'prefab', value: 'zombie-uuid' } }] }
    expect(spawnModesFor({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts: elsewhere })).toEqual([])
  })

  it('does not treat a plain string param that happens to hold the id as a prefab ref', () => {
    const stringy = { 'a.ts': [{ zombie: { type: 'string', value: 'zombie-uuid' } }] }
    expect(spawnModesFor({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts: stringy })).toEqual([])
  })

  it('keeps both bindings when two entities run the same script with different prefabs', () => {
    const twice = {
      'a.ts': [
        { zombie: { type: 'prefab', value: 'zombie-uuid' } },
        { zombie: { type: 'prefab', value: 'arena-uuid' } }
      ]
    }
    const scripts = { 'a.ts': waveDirector }
    expect(spawnModesFor({ data: zombie, scripts, layouts: twice })).toEqual(['planned'])
    expect(spawnModesFor({ data: arena, scripts, layouts: twice })).toEqual(['planned'])
  })

  // The failure the chips must never produce: a prefab called server-owned
  // because the word appears in prose.
  it('reads no pool out of a comment or a doc string', () => {
    const text = `
      import { pool } from './runtime/spawner'
      // pool(this.zombie, 'server')
      const usage = "pool(this.zombie, 'server') — call this from start()"
      const help = \`spawner.pool(this.zombie, 'server')\`
      console.log(usage, help)
    `
    expect(spawnModesFor({ data: zombie, scripts: { 'a.ts': text }, layouts })).toEqual([])
  })

  it('credits an unfollowable ref only to params the script actually reads', () => {
    const text = `
      import { pool as openPool } from './runtime/spawner'
      export class Slots {
        constructor(public src: string, public entity: Entity, public arenas: PrefabRef[] = [], public zombie: PrefabRef = '') {}
        start(): void { this.open(normalizeRefs(this.arenas)) }
        private open(ref: string) { return openPool(ref, 'seeded') }
      }
    `
    const both = {
      'b.ts': [
        {
          arenas: { type: 'prefabList', value: ['arena-uuid'] },
          zombie: { type: 'prefab', value: 'zombie-uuid' }
        }
      ]
    }
    const scripts = { 'b.ts': text }
    expect(spawnModesFor({ data: arena, scripts, layouts: both })).toEqual(['seeded'])
    // `zombie` is a prefab param of the same script, but nothing in it reads
    // this.zombie — so the pool that ref reaches is not this prefab's
    expect(spawnModesFor({ data: zombie, scripts, layouts: both })).toEqual([])
  })

  it('resolves the alias the generated registry exports', () => {
    const text = `
      import * as spawner from './runtime/spawner'
      spawner.perPlayer(Spawnables.ZombieBasic)
    `
    expect(spawnModesFor({ data: zombie, scripts: { 'a.ts': text }, layouts: {} })).toEqual(['perPlayer'])
  })

  it('derives modes for a prefab without spawn overrides — every prefab is spawnable', () => {
    const text = `
      import { pool } from './runtime/spawner'
      pool('bench-uuid', 'server')
    `
    expect(spawnModesFor({ data: plain, scripts: { 'a.ts': text }, layouts: {} })).toEqual(['server'])
  })

  it('keeps both modes when two consumers use one prefab differently', () => {
    const other = `
      import * as spawner from './runtime/spawner'
      spawner.pool(Spawnables.ZombieBasic, 'seeded')
    `
    const modes = spawnModesFor({ data: zombie, scripts: { 'a.ts': waveDirector, 'c.ts': other }, layouts })
    expect(modes).toEqual(['planned', 'seeded'])
  })
})

describe('guaranteeChips', () => {
  it('states the planned ceiling verbatim across its clauses', () => {
    const chips = guaranteeChips({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts })
    expect(`${chips.map((c) => c.label).join(' · ')}.`).toBe(
      'Same spawns and same alive-set everywhere · positions client-simulated · hits client-reported · damage server-tracked.'
    )
    expect(PLANNED_GUARANTEE).toBe(
      'Same spawns and same alive-set everywhere · positions client-simulated · hits client-reported · damage server-tracked.'
    )
  })

  it('colours the planned clauses by who actually owns each one', () => {
    const chips = guaranteeChips({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts })
    expect(chips.map((c) => c.tone)).toEqual(['info', 'client', 'client', 'server'])
  })

  it('says pending, and nothing else, when no consumer opens a pool', () => {
    const chips = guaranteeChips({ data: zombie, scripts: {}, layouts })
    expect(chips.map((c) => c.label)).toEqual([PENDING_LABEL])
  })

  it('speaks creator language out of pending — no API names, an example instead', () => {
    const [pending] = guaranteeChips({ data: zombie, scripts: {}, layouts })
    expect(pending.tip).toContain('Pick it in a spawner')
    expect(pending.tip).not.toContain('spawner.plan')
    expect(pending.tip).not.toContain('pool')
  })

  it('renders chips for a prefab without spawn overrides — every prefab is spawnable', () => {
    expect(guaranteeChips({ data: plain, scripts: { 'a.ts': waveDirector }, layouts }).length).toBeGreaterThan(0)
  })

  it('reads per-player as one per player, on this player’s screen, HP server-owned', () => {
    expect(chipsFromModes(zombie, ['perPlayer']).map((c) => c.label)).toEqual([
      'One per player',
      'On this player’s screen',
      'HP server-owned'
    ])
  })

  it('merges two modes without repeating a clause', () => {
    const labels = chipsFromModes(zombie, ['server', 'seeded']).map((c) => c.label)
    expect(labels).toEqual(['Server-owned', 'read-only for players', 'On this player’s screen', 'nothing synced'])
  })

  it('only ever emits tones the Chip component can render', () => {
    for (const mode of ['server', 'planned', 'seeded', 'perPlayer'] as const) {
      for (const chip of chipsFromModes(zombie, [mode])) {
        expect(['server', 'client', 'info']).toContain(chip.tone)
        expect(chip.tip.length).toBeGreaterThan(20)
      }
    }
  })
})

describe('guaranteeSummaries', () => {
  // The sync-mode pills are gone on purpose: they named mechanism and no
  // creator acted on them. The card keeps exactly one behavioural nudge.
  it('shows nothing for a prefab something already spawns', () => {
    const chips = guaranteeSummaries({ data: zombie, scripts: { 'a.ts': waveDirector }, layouts })
    expect(chips).toEqual([])
  })

  it('keeps the pending nudge when nothing brings the prefab into the game', () => {
    expect(summariesFromModes(zombie, []).map((c) => c.label)).toEqual([PENDING_LABEL])
  })

  it('stays quiet for a placed copy nothing spawns — a bench is just a bench', () => {
    expect(summariesFromModes(zombie, [], false)).toEqual([])
  })
})

describe('scriptLayouts', () => {
  const snapshot = {
    '512': {
      'core::Transform': { position: { x: 0, y: 0, z: 0 } },
      'asset-packs::Script': {
        value: [
          {
            path: 'custom/wave_director/scripts/wave-director.ts',
            priority: 0,
            layout: '{"params":{"zombie":{"type":"prefab","value":"zombie-uuid"}},"actions":[]}'
          },
          {
            path: 'src/scripts/extra.ts',
            priority: 0,
            layout: '{"params":{"arenas":{"type":"prefabList","value":["arena-uuid"]}},"actions":[]}'
          }
        ]
      }
    },
    '513': { 'core::Transform': {} },
    '514': { 'asset-packs::Script': { value: [{ path: 'src/scripts/plain.ts', priority: 0 }] } }
  }

  it('keys every row by the script that runs it, params typed', () => {
    expect(scriptLayouts(snapshot)).toEqual({
      'custom/wave_director/scripts/wave-director.ts': [
        { zombie: { type: 'prefab', value: 'zombie-uuid' } }
      ],
      'src/scripts/extra.ts': [{ arenas: { type: 'prefabList', value: ['arena-uuid'] } }]
    })
  })

  it('keeps one entry per row when two entities run the same script', () => {
    const twice = {
      '512': snapshot['512'],
      '513': {
        'asset-packs::Script': {
          value: [
            {
              path: 'custom/wave_director/scripts/wave-director.ts',
              priority: 0,
              layout: '{"params":{"zombie":{"type":"prefab","value":"arena-uuid"}},"actions":[]}'
            }
          ]
        }
      }
    }
    expect(scriptLayouts(twice)['custom/wave_director/scripts/wave-director.ts']).toHaveLength(2)
  })

  it('feeds the derivation end to end', () => {
    const scripts = { 'custom/wave_director/scripts/wave-director.ts': waveDirector }
    expect(spawnModesFor({ data: zombie, scripts, layouts: scriptLayouts(snapshot) })).toEqual(['planned'])
    // …and the second script's `arenas` row cannot lend its prefab to the first
    expect(spawnModesFor({ data: arena, scripts, layouts: scriptLayouts(snapshot) })).toEqual([])
  })
})

// The scan is regex over source, so the thing that breaks it is the kit writing
// its imports some way the fixtures above don't. Read the shipped scripts.
describe('the kit prefabs the editor ships', () => {
  it('reads Wave Director as planned, through its renamed import', () => {
    const text = readPrefabFile('wave-director/scripts/wave-director.ts')
    expect(spawnCallsIn(text, 'wave-director.ts')).toEqual([
      { script: 'wave-director.ts', mode: 'planned', ref: { kind: 'param', name: 'zombie' } }
    ])
  })

  it('reads Level Slots as seeded, with a ref it cannot follow statically', () => {
    const text = readPrefabFile('level-slots/scripts/level-slots.ts')
    const calls = spawnCallsIn(text, 'level-slots.ts')
    expect(calls.map((c) => c.mode)).toEqual(['seeded'])
    expect(calls[0].ref.kind).toBe('unknown')
    // and what it can say is which of its own params the script reads
    expect(calls[0].ref).toHaveProperty('mentions', expect.arrayContaining(['arenas']))
  })

  it('reads Player Rig as per player, through its namespace import', () => {
    const text = readPrefabFile('player-rig/scripts/player-rig.ts')
    expect(spawnCallsIn(text, 'player-rig.ts')).toEqual([
      { script: 'player-rig.ts', mode: 'perPlayer', ref: { kind: 'param', name: 'rig' } }
    ])
  })

  it('finds no pool-open in a kit script that only reads clone provenance', () => {
    expect(spawnCallsIn(readPrefabFile('player-rig/scripts/gun-hitscan.ts'))).toEqual([])
  })
})

describe('modesFromCalls', () => {
  it('is the same answer as the scanning path, from a pre-built call list', () => {
    const scripts = { 'a.ts': waveDirector, 'b.ts': levelSlots }
    const calls = scanSpawnCalls(scripts)
    expect(modesFromCalls(zombie, calls, layouts, scripts)).toEqual(
      spawnModesFor({ data: zombie, scripts, layouts })
    )
    expect(modesFromCalls(arena, calls, layouts, scripts)).toEqual(['seeded'])
  })
})
