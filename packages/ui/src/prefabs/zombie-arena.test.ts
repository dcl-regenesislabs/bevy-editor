// The walkthrough regression: concept-final.md §2, from `File → New` to Deploy,
// frozen as a fixture and pushed through the real generators.
//
// What it protects. The two committed generated files (`src/scripts/spawnables.ts`
// and `src/scripts/game-config.ts`) are the only place the editor writes code a
// creator ships. A wrong registry does not fail the build — it constructs the
// wrong class, or the right one with no arguments, and the zombie simply behaves
// differently spawned than placed. So the goldens are byte-for-byte, and the
// fixture deliberately reads the four kit prefabs off disk: change a kit's
// composite and this test tells you the registry a creator ships changed too.
//
// Regenerate the goldens after an intended change:
//   UPDATE_GOLDENS=1 npx vitest run packages/ui/src/prefabs/zombie-arena.test.ts
//
// packages/desktop/validate/probe-zombie-arena.mjs materialises the SAME fixture
// into a real scene and runs it; the two are one fixture with two consumers.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  gameConfigColumns,
  normalizeGameConfig,
  tableRowsAsNumbers,
  type GameConfigValue
} from '../gameconfig/normalize'
import { gameConfigProblems, renderGameConfig } from '../gameconfig/codegen'
import { PREFABS_ROOT, filesUnder, readPrefabFile } from './builtin-fixtures'
import {
  REGISTRY_LAYOUT,
  REGISTRY_PRIORITY,
  SPAWNABLES_PATH,
  exportShape,
  prefabRefParams,
  renderSpawnables,
  type SpawnableSource
} from './codegen'
import { parseLayout } from '../script/parser'
import {
  SCRIPT_COMPONENT,
  clone,
  isRecord,
  parsePrefabComposite,
  parsePrefabData,
  type PrefabComposite,
  type PrefabData
} from './format'
import { readSpawnable } from './spawnable'
import { snapshotComponentName } from '@scene/composite'
import { runSceneChecks, type SceneCheckContext } from '../features/editor/scene-checks'
import { CHECK_IDS } from '../features/editor/scene-check-rules'

const FIXTURES = new URL('fixtures/zombie-arena/', import.meta.url)
const UPDATE = process.env.UPDATE_GOLDENS === '1'

function readFixture(name: string): string {
  // CRLF checkouts must not fail the byte-exact goldens
  return readFileSync(new URL(name, FIXTURES), 'utf8').replace(/\r\n/g, '\n')
}

function golden(name: string, actual: string): void {
  if (UPDATE) {
    writeFileSync(fileURLToPath(new URL(name, FIXTURES)), actual)
    return
  }
  expect(actual).toBe(readFixture(name))
}

interface FixtureEntry {
  folder: string
  builtin?: string
  data?: unknown
  composite?: unknown
}

const entries: FixtureEntry[] = (JSON.parse(readFixture('prefabs.json')) as { prefabs: FixtureEntry[] }).prefabs
const configValue: GameConfigValue = normalizeGameConfig(
  (JSON.parse(readFixture('game-config.json')) as { value: unknown }).value
)
const sceneComposite: PrefabComposite = parsePrefabComposite(readFixture('scene-composite.json'), 'scene')
const fixtureScripts: Record<string, string> = (
  JSON.parse(readFixture('scene-scripts.json')) as { scripts: Record<string, string> }
).scripts

// A `builtin` entry is the shipped kit folder, read the way a placed copy of it
// would sit in the project: same files, rooted at custom/<slug>.
function sourceOf(entry: FixtureEntry): SpawnableSource {
  if (entry.builtin === undefined) {
    return {
      folder: entry.folder,
      data: parsePrefabData(JSON.stringify(entry.data), entry.folder, 'missing-id'),
      composite: parsePrefabComposite(JSON.stringify(entry.composite), entry.folder)
    }
  }
  return {
    folder: entry.folder,
    data: parsePrefabData(readPrefabFile(`${entry.builtin}/data.json`), entry.folder, 'missing-id'),
    composite: parsePrefabComposite(readPrefabFile(`${entry.builtin}/composite.json`), entry.folder)
  }
}

function scriptTexts(): Record<string, string> {
  const texts: Record<string, string> = { ...fixtureScripts }
  for (const entry of entries) {
    if (entry.builtin === undefined) continue
    const scripts = new URL(`${entry.builtin}/scripts/`, PREFABS_ROOT)
    for (const rel of filesUnder(scripts)) {
      if (!rel.endsWith('.ts')) continue
      texts[`${entry.folder}/scripts/${rel}`] = readPrefabFile(`${entry.builtin}/scripts/${rel}`)
    }
  }
  return texts
}

const prefabs = entries.map(sourceOf)
const scripts = scriptTexts()
const byFolder = new Map(prefabs.map((p) => [p.folder, p]))
const dataById = new Map(prefabs.map((p) => [p.data.id, p.data]))

function withData(folder: string, edit: (data: PrefabData) => PrefabData): SpawnableSource[] {
  return prefabs.map((p) => (p.folder === folder ? { ...p, data: edit(clone(p.data)) } : p))
}

// Every Script row placed in the scene, as (entity, path, parsed layout).
interface PlacedScript {
  entityId: string
  path: string
  priority: number
  layout: string
}


function placedScripts(composite: PrefabComposite): PlacedScript[] {
  const rows: PlacedScript[] = []
  const component = composite.components.find((c) => c.name === SCRIPT_COMPONENT)
  for (const [entityId, entry] of Object.entries(component?.data ?? {})) {
    const value = isRecord(entry.json) ? entry.json.value : undefined
    if (!Array.isArray(value)) continue
    for (const row of value) {
      if (!isRecord(row) || typeof row.path !== 'string') continue
      rows.push({
        entityId,
        path: row.path,
        priority: typeof row.priority === 'number' ? row.priority : 0,
        layout: typeof row.layout === 'string' ? row.layout : ''
      })
    }
  }
  return rows
}

function paramNamesOf(layout: string): string[] {
  return Object.keys(parseLayout(layout)?.params ?? {})
}

/**
 * `scene-composite.json` in the form the editor holds it in memory: entity id →
 * SDK component name → value. This is what a scene-check context wants, so the
 * same fixture feeds the checks once they are wired up.
 */
export function sceneSnapshot(composite: PrefabComposite): Record<string, Record<string, unknown>> {
  const snapshot: Record<string, Record<string, unknown>> = {}
  for (const component of composite.components) {
    const name = snapshotComponentName(component.name)
    if (name === undefined) continue
    for (const [entityId, entry] of Object.entries(component.data)) {
      snapshot[entityId] = { ...snapshot[entityId], [name]: entry.json }
    }
  }
  return snapshot
}

// A PrefabRef[] is a comma-separated string in the inspector today and may become
// a real array once the parser learns the annotation; both read the same here.
function refIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value !== 'string') return []
  return value.split(',').map((v) => v.trim()).filter((v) => v !== '')
}

describe('the zombie-arena walkthrough', () => {
  it('generates the registry the scene ships', () => {
    // gameConfig: true — the scene HAS a Game Config, so the registry is what
    // pulls src/scripts/game-config.ts into the bundle. Nothing else imports it.
    const { text, problems, blocking } = renderSpawnables({ prefabs, scripts, gameConfig: true })
    expect(problems).toEqual([])
    expect(blocking).toBe(false)
    golden('spawnables.expected.txt', text)
  })

  it('generates the config accessor the scene ships', () => {
    expect(gameConfigProblems(configValue)).toEqual([])
    golden('game-config.expected.txt', renderGameConfig(configValue))
  })

  it('registers exactly the four Spawnable prefabs, aliased', () => {
    const spawnable = prefabs.filter((p) => readSpawnable(p.data) !== null).map((p) => p.folder)
    expect(spawnable.sort()).toEqual([
      'custom/arena_graveyard',
      'custom/arena_mall',
      'custom/player_rig',
      'custom/zombie_basic'
    ])
    const text = renderSpawnables({ prefabs, scripts }).text
    for (const alias of ['ArenaGraveyard', 'ArenaMall', 'PlayerRig', 'ZombieBasic']) {
      expect(text).toContain(`  ${alias}: '`)
    }
    // clones must never carry the authored name: a name-keyed lookup (a trigger
    // zone, zoneBus) would silently bind the clone.
    expect(text).not.toContain('core-schema::Name')
    expect(exportShape(text.replace("from '@dcl/sdk/ecs'", "from './ecs'")).functions).toEqual([
      'SpawnableRegistry'
    ])
  })

  it('installs the registry as one entity-0 Script row, and nothing else', () => {
    const rows = placedScripts(sceneComposite).filter((r) => r.entityId === '0')
    expect(rows).toEqual([{ entityId: '0', path: SPAWNABLES_PATH, priority: REGISTRY_PRIORITY, layout: REGISTRY_LAYOUT }])
    const config = sceneComposite.components.find((c) => c.name === 'editor::GameConfig')
    expect(Object.keys(config?.data ?? {})).toEqual(['0'])
  })

  it('places every kit instance as its own entity, wired by PrefabRef', () => {
    const paths = placedScripts(sceneComposite).map((r) => r.path)
    expect(paths).toContain('custom/round_loop/scripts/round-loop.ts')
    expect(paths).toContain('custom/level_slots/scripts/level-slots.ts')
    expect(paths).toContain('custom/player_rig/scripts/gun-hitscan.ts')

    // the Wave Director drops as its own instance — never attached to another
    // kit's entity, or its drift chip would arm on every kit update
    const director = placedScripts(sceneComposite).filter(
      (r) => r.path === 'custom/wave_director/scripts/wave-director.ts'
    )
    expect(director).toHaveLength(1)
    expect(placedScripts(sceneComposite).filter((r) => r.entityId === director[0].entityId)).toHaveLength(1)
  })

  it('resolves every PrefabRef param to a Spawnable prefab in the project', () => {
    const refs: Array<{ path: string; name: string; id: string }> = []
    for (const row of placedScripts(sceneComposite)) {
      const source = byFolder.get(row.path.split('/').slice(0, 2).join('/'))
      const text = source === undefined ? undefined : scripts[row.path]
      if (text === undefined) continue
      const params = parseLayout(row.layout)?.params ?? {}
      for (const name of prefabRefParams(text)) {
        for (const id of refIds(params[name]?.value)) refs.push({ path: row.path, name, id })
      }
    }
    // wave-director.zombie, level-slots.arenas × 2, player-rig.rig
    expect(refs.map((r) => r.name).sort()).toEqual(['arenas', 'arenas', 'rig', 'zombie'])
    for (const ref of refs) {
      const data = dataById.get(ref.id)
      expect(data, `${ref.path}: ${ref.name} points at an unknown prefab`).toBeDefined()
      expect(readSpawnable(data as PrefabData), `${ref.path}: ${ref.name} is not Spawnable`).not.toBeNull()
    }
  })

  it('keeps every wave inside the pool cap', () => {
    const counts = tableRowsAsNumbers(configValue, 'waves', 'count')
    expect(counts).toHaveLength(10)
    const zombie = byFolder.get('custom/zombie_basic') as SpawnableSource
    expect(Math.max(...counts)).toBe(48)
    expect(Math.max(...counts)).toBeLessThanOrEqual(readSpawnable(zombie.data)?.max ?? 0)
  })

  it('sources every tunable number once', () => {
    const columns = new Set(gameConfigColumns(configValue).map((c) => c.column))
    const shadowed: string[] = []
    const layouts = [
      ...placedScripts(sceneComposite).map((r) => r.layout),
      ...prefabs.flatMap((p) => placedScripts(p.composite).map((r) => r.layout))
    ]
    for (const layout of layouts) {
      for (const name of paramNamesOf(layout)) if (columns.has(name)) shadowed.push(name)
    }
    expect(shadowed).toEqual([])
    // and the numbers that are NOT params are the ones the server also reads
    expect(columns.has('hp')).toBe(true)
    expect(columns.has('biteDamage')).toBe(true)
    expect(columns.has('gunDamage')).toBe(true)
  })
})

// Three ways to break the walkthrough, each the failure a shipped check names.
// The good fixture above is the control: every one of these passes there.
describe('what the scene checks have to catch', () => {
  it('wave 10 requesting more zombies than the pool holds', () => {
    const broken = clone(configValue)
    const waves = broken.tables.find((t) => t.name === 'waves')
    if (waves !== undefined) waves.rows[9].cells[1] = '80'
    const max = readSpawnable((byFolder.get('custom/zombie_basic') as SpawnableSource).data)?.max ?? 0
    expect(Math.max(...tableRowsAsNumbers(broken, 'waves', 'count'))).toBeGreaterThan(max)
  })

  it('a script param shadowing a Game Config column', () => {
    const columns = new Set(gameConfigColumns(configValue).map((c) => c.column))
    const shadowed = '{"params":{"speed":{"type":"number","value":1.5},"hp":{"type":"number","value":40}},"actions":[]}'
    expect(paramNamesOf(shadowed).filter((name) => columns.has(name))).toEqual(['hp'])
  })

  it('a prefab with no spawn settings ships anyway — every prefab is spawnable', () => {
    const off = withData('custom/zombie_basic', (data) => {
      const { spawnable: _dropped, ...rest } = data
      return rest
    })
    const text = renderSpawnables({ prefabs: off, scripts }).text
    expect(text).toContain('zombie-brain')
    expect(text).toContain('ZombieBasic:')
    expect(text).toContain('max: 64')
  })
})

describe('the fixture itself', () => {
  it('names a folder for every prefab it declares, and no more', () => {
    const declared = entries.map((e) => e.folder).sort()
    expect(declared).toEqual([...new Set(declared)])
    expect(declared).toHaveLength(7)
  })

  it('ships the scene-side scripts the probe writes to disk', () => {
    expect(Object.keys(fixtureScripts)).toEqual(['custom/zombie_basic/scripts/zombie-brain.ts'])
    const brain = fixtureScripts['custom/zombie_basic/scripts/zombie-brain.ts']
    expect(exportShape(brain).functions).toEqual(['ZombieBrain'])
    // hp and biteDamage come from the config accessor, never from a param
    expect(brain).not.toMatch(/public\s+hp\b/)
    expect(brain).not.toMatch(/public\s+biteDamage\b/)
  })

  it('names only components the composite writer can resolve', () => {
    const unresolved: string[] = []
    for (const composite of [sceneComposite, ...prefabs.map((p) => p.composite)]) {
      for (const component of composite.components) {
        if (snapshotComponentName(component.name) === undefined) unresolved.push(component.name)
      }
    }
    expect([...new Set(unresolved)]).toEqual([])
    // and the snapshot form a scene-check context wants falls straight out of it
    const snapshot = sceneSnapshot(sceneComposite)
    // custom namespaces keep their full name in the snapshot; protocol ones become
    // their SDK export name (core::Transform → Transform)
    expect(Object.keys(snapshot['0'] ?? {}).sort()).toEqual(['asset-packs::Script', 'editor::GameConfig'])
    expect(Object.keys(snapshot['512'] ?? {}).sort()).toEqual(['Transform', 'core-schema::Name'])
    expect(Object.keys(snapshot).length).toBe(17)
  })

  it('keeps the fixture directory to data files only', () => {
    const names = readdirSync(fileURLToPath(FIXTURES)).sort()
    expect(names.every((n) => n.endsWith('.json') || n.endsWith('.txt') || n === 'README.md')).toBe(true)
  })
})

// The other half of the fixture's job: the same project state the goldens are
// rendered from, run through the checks a creator actually sees. A rule that
// fires here fires on the walkthrough itself, which is the only place the
// difference between "a correct lint" and "noise" shows up.
type SnapshotForm = Record<string, Record<string, unknown>>

function checkContext(over: Partial<SceneCheckContext> = {}): SceneCheckContext {
  return {
    snapshot: sceneSnapshot(sceneComposite),
    prefabs: prefabs.map((p) => ({ folder: p.folder, data: p.data, composite: p.composite })),
    scripts,
    gameConfig: configValue,
    ...over
  }
}

function scriptRowsIn(snapshot: SnapshotForm, entityId: string): PlacedScript[] {
  const value = (snapshot[entityId]?.[SCRIPT_COMPONENT] as { value?: unknown } | undefined)?.value
  return Array.isArray(value) ? (value as PlacedScript[]) : []
}

describe('the shipped scene checks, over the whole fixture', () => {
  const ids = (ctx: SceneCheckContext): string[] =>
    [...new Set(runSceneChecks(ctx).map((f) => f.id))].sort()

  it('finds nothing to fix in the walkthrough as shipped', () => {
    expect(runSceneChecks(checkContext()).map((f) => `${f.id} — ${f.detail}`)).toEqual([])
  })

  it('names wave-count-vs-pool-max when a wave overruns the pool', () => {
    const broken = clone(configValue)
    const waves = broken.tables.find((t) => t.name === 'waves')
    if (waves !== undefined) waves.rows[9].cells[1] = '80'
    const found = runSceneChecks(checkContext({ gameConfig: broken }))
    expect(found.map((f) => f.id)).toEqual([CHECK_IDS.waveCount])
    expect(found[0].detail).toBe(
      'Wave 10 spawns 80 ZombieBasic, and Zombie Basic allows 64 alive at once. Lower the count in Game Config › waves.'
    )
  })

  // The right-click "Add a spawner" gesture parents a prefab instance to whatever
  // was clicked, and the Player Rig (522) is a placed anchor of a spawnable — so
  // before instanceDrift learned to stop at nested instance roots, three clicks on
  // the walkthrough's own scene raised a finding from the since-removed drift rule.
  it('stays quiet when a prefab instance is parented to a placed anchor', () => {
    const snapshot = clone(sceneSnapshot(sceneComposite)) as SnapshotForm
    snapshot['700'] = {
      Transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parent: 522 },
      'core-schema::Name': { value: 'Player Rig Spawner' },
      'inspector::CustomAsset': { assetId: '00000000-0000-4000-8000-00000000dead' }
    }
    expect(runSceneChecks(checkContext({ snapshot })).map((f) => `${f.id} — ${f.detail}`)).toEqual([])
  })

  it('names config-shadowing when a script param re-declares a config column', () => {
    const snapshot = clone(sceneSnapshot(sceneComposite)) as SnapshotForm
    for (const row of scriptRowsIn(snapshot, '522')) {
      row.layout = '{"params":{"hp":{"type":"number","value":40}},"actions":[]}'
    }
    const found = runSceneChecks(checkContext({ snapshot }))
    expect(found.map((f) => f.id)).toContain(CHECK_IDS.shadowing)
    expect(found.find((f) => f.id === CHECK_IDS.shadowing)?.detail).toContain('`gameConfig.zombie.hp`')
  })

  it('names empty-prefab-ref when the level variants are cleared', () => {
    const snapshot = clone(sceneSnapshot(sceneComposite)) as SnapshotForm
    for (const entityId of Object.keys(snapshot)) {
      for (const row of scriptRowsIn(snapshot, entityId)) {
        if (!row.path.includes('level-slots')) continue
        row.layout = row.layout.replace(/"value"\s*:\s*\[[^\]]*\]/, '"value":[]')
      }
    }
    expect(ids(checkContext({ snapshot }))).toEqual([CHECK_IDS.emptyRef])
  })
})
