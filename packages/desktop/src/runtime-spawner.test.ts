import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  instanceKey,
  isFunctionStyleScript,
  methodOf,
  parseScriptLayout,
  resolveScriptClass,
  resolveScriptParams,
  scriptSrc,
  type ActionRef
} from '../runtime-modules/pure/scriptInit'
import { PoolState, stableId } from '../runtime-modules/pure/poolState'
import {
  PLAN_ID_STRIDE,
  PlanQueue,
  planIndexOf,
  planInstanceId,
  planPhaseOf,
  sortPlan,
  tupleKey
} from '../runtime-modules/pure/spawnPlan'
import {
  OutcomeLog,
  OutcomeStream,
  chunkEntries,
  readOutcomeEntries,
  readOutcomeEntry
} from '../runtime-modules/pure/outcomeLedger'

const modulesDir = path.resolve(__dirname, '../runtime-modules')
const read = (rel: string): string => fs.readFileSync(path.join(modulesDir, rel), 'utf8')

// The file spawner.ts shadows. It ships inside sdk-commands, whose channel moves
// without notice, so the parity assertions below read the real thing rather than
// trusting a copy of it in someone's memory.
function runnerSource(): string {
  const candidates = [
    '../../../node_modules/@dcl/sdk-commands/dist/logic/runtime-script.js',
    '../../../node_modules/@dcl/sdk-auth/node_modules/@dcl/sdk-commands/dist/logic/runtime-script.js'
  ]
  for (const rel of candidates) {
    const file = path.resolve(__dirname, rel)
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8')
  }
  throw new Error('runtime-script.js not found — install dependencies before running the parity tests')
}

describe('_runtime scriptInit', () => {
  it('passes the script DIRECTORY as src, the way sdk-commands does', () => {
    expect(scriptSrc('custom/zombie-basic/scripts/zombie-brain.ts')).toBe('custom/zombie-basic/scripts')
    expect(scriptSrc('src/scripts/spawnables.ts')).toBe('src/scripts')
    expect(scriptSrc('solo.ts')).toBe('')
  })

  it('keys instances as `${entity}:${path}` so callScriptMethod reaches clones', () => {
    expect(instanceKey(512, 'src/scripts/a.ts')).toBe('512:src/scripts/a.ts')
  })

  it('resolves params positionally, in the layout object order', () => {
    const layout = parseScriptLayout(
      '{"params":{"speed":{"type":"number","value":2.5},"loud":{"type":"boolean","value":true},"tag":{"type":"string","value":"x"}}}'
    )
    expect(resolveScriptParams(layout, () => () => {})).toEqual([2.5, true, 'x'])
  })

  it('turns action params into callbacks and leaves every other type alone', () => {
    const fired: ActionRef[] = []
    const layout = parseScriptLayout(
      '{"params":{"n":{"type":"number","value":1},"go":{"type":"action","value":{"entity":513,"action":"open"}}}}'
    )
    const params = resolveScriptParams(layout, (ref) => () => fired.push(ref))
    expect(params[0]).toBe(1)
    expect(typeof params[1]).toBe('function')
    ;(params[1] as () => void)()
    expect(fired).toEqual([{ entity: 513, action: 'open' }])
  })

  it('only synthesises a callback when the action value is an object, as the runner does', () => {
    const layout = parseScriptLayout(
      '{"params":{"a":{"type":"action","value":null},"b":{"type":"action","value":"open"},"c":{"type":"action"}}}'
    )
    expect(resolveScriptParams(layout, () => () => {})).toEqual([null, 'open', undefined])
  })

  it('treats an empty or missing layout as zero params', () => {
    expect(resolveScriptParams(parseScriptLayout(undefined), () => () => {})).toEqual([])
    expect(resolveScriptParams(parseScriptLayout('{}'), () => () => {})).toEqual([])
    expect(resolveScriptParams(parseScriptLayout('{"params":{},"actions":[]}'), () => () => {})).toEqual([])
  })

  it('picks the first function-valued export, exactly like runScripts', () => {
    class First {}
    class Second {}
    const module = { NOT_A_CLASS: 3, First, Second }
    expect(resolveScriptClass(module)).toBe(First)
    expect(resolveScriptClass({ nothing: 1 })).toBeNull()
  })

  it('detects the function-style script the runner also supports', () => {
    expect(isFunctionStyleScript({ start: () => {} })).toBe(true)
    expect(isFunctionStyleScript({ Thing: class {} })).toBe(false)
  })

  it('binds methods to their instance and reports missing ones as null', () => {
    const instance = {
      hits: 0,
      update(): void {
        instance.hits += 1
      }
    }
    methodOf(instance, 'update')?.()
    expect(instance.hits).toBe(1)
    expect(methodOf(instance, 'detach')).toBeNull()
  })
})

describe('spawner mirrors the SDK script runner', () => {
  const runner = runnerSource()
  const spawner = read('spawner.ts')

  it('derives src with the runner’s own expression', () => {
    expect(runner).toContain("script.path.split('/').slice(0, -1).join('/')")
    // and ours agrees on every shape of path the runner can be handed
    for (const p of ['a/b/c.ts', 'c.ts', 'a/b.tsx']) {
      expect(scriptSrc(p)).toBe(p.split('/').slice(0, -1).join('/'))
    }
  })

  it('resolves the class the same way', () => {
    expect(runner).toContain("Object.values(module).find((exp) => typeof exp === 'function')")
    expect(read('pure/scriptInit.ts')).toContain("Object.values(module).find((exported) => typeof exported === 'function')")
  })

  it('tests action params with the runner’s condition', () => {
    expect(runner).toContain("param.type === 'action'")
    expect(runner).toMatch(/getActionEvents\)?\(actionRef\.entity\)/)
    expect(runner).toContain('actionEvents.emit(actionRef.action, {})')
    // the cast is the scene's, not the contract's: what has to match the runner is
    // that the event goes to the ref's own entity, under the ref's own action name
    expect(spawner).toMatch(/getActionEvents\(ref\.entity(?: as Entity)?\)\.emit\(ref\.action, \{\}\)/)
  })

  it('registers instances in the same global map, under the same key', () => {
    expect(runner).toContain('globalThis.__DCL_SCRIPT_INSTANCES__')
    expect(runner).toContain('`${script.entity}:${script.path}`')
    expect(spawner).toContain('__DCL_SCRIPT_INSTANCES__')
    expect(spawner).toContain('scriptRegistry().set(instanceKey(run.entity, run.path)')
  })

  it('logs construction and update failures with the runner’s wording', () => {
    expect(runner).toContain("'[Script Error] ' + script.path + ' class initialization failed:'")
    expect(runner).toContain("'[Script Error] update() failed:'")
    expect(spawner).toContain("'[Script Error] ' + spec.path + ' class initialization failed:'")
    expect(spawner).toContain("'[Script Error] update() failed:'")
  })

  it('skips removed entities in the update system, as the runner does', () => {
    expect(runner).toContain('EntityState.Removed')
    expect(spawner).toContain('engine.getEntityState(run.entity) === EntityState.Removed')
  })

  it('never reaches for ~sdk/script-utils, which exists only inside a scene bundle', () => {
    for (const file of fs.readdirSync(modulesDir).filter((name) => name.endsWith('.ts'))) {
      expect(read(file), file).not.toContain('~sdk/script-utils')
    }
  })
})

describe('spawner module contract', () => {
  const spawner = read('spawner.ts')

  it('anchors cross-copy state on a versioned globalThis key, probed by shape', () => {
    expect(spawner).toContain("const HUB_KEY = '__dclSpawner_v1'")
    expect(spawner).toContain('function isHub(value: unknown): value is SpawnerHub')
    expect(spawner).not.toContain('instanceof SpawnerHub')
  })

  it('rejects multi-entity server pools with the wording the lint copy uses', () => {
    expect(spawner).toContain("throw new Error('server-owned spawnables must be a single entity in v1')")
  })

  it('requires an outcomes declaration for planned pools', () => {
    expect(spawner).toContain('must declare outcomes')
  })

  it('defines SpawnedFrom idempotently — every prefab carries its own copy', () => {
    expect(spawner).toContain("engine.getComponentOrNull('runtime::SpawnedFrom')")
    expect(spawner).toMatch(/\?\?\s*defineSpawnedFrom\(\)/)
  })

  it('opens the outcomes rpc at module scope, before the engine seals', () => {
    const outcomes = read('outcomes.ts')
    const moduleScope = outcomes.split('export function outcomes(')[0]
    expect(moduleScope).toContain("const rpc = createRpc('outcomes')")
    expect(moduleScope).toContain('const room = registerMessages(')
  })

  it('keeps the typed escape hatches out of the runtime modules', () => {
    for (const file of ['spawner.ts', 'outcomes.ts', 'pure/scriptInit.ts', 'pure/poolState.ts', 'pure/spawnPlan.ts']) {
      expect(read(file), file).not.toMatch(/\bas any\b/)
    }
  })
})

describe('_runtime pool state', () => {
  it('caps concurrently-alive clones and refuses a duplicate id', () => {
    const pool = new PoolState<number>(2)
    expect(pool.canClaim(1)).toBe(true)
    pool.claim(1, 100)
    expect(pool.canClaim(1)).toBe(false)
    pool.claim(2, 200)
    expect(pool.full).toBe(true)
    expect(pool.canClaim(3)).toBe(false)
    expect(pool.release(200)).toBe(2)
    expect(pool.canClaim(3)).toBe(true)
  })

  it('never reuses an auto id, so a late outcome cannot land on the next tenant', () => {
    const pool = new PoolState<number>(4)
    const first = pool.nextId()
    pool.claim(first, 10)
    pool.release(10)
    expect(pool.nextId()).toBeGreaterThan(first)
  })

  it('keeps auto ids clear of externally supplied ones', () => {
    const pool = new PoolState<number>(4)
    pool.claim(500, 10)
    expect(pool.nextId()).toBe(501)
  })

  it('maps both ways and forgets an entity it never owned', () => {
    const pool = new PoolState<number>(4)
    pool.claim(7, 70)
    expect(pool.entityOf(7)).toBe(70)
    expect(pool.instanceIdOf(70)).toBe(7)
    expect(pool.release(99)).toBeNull()
    expect(pool.alive()).toEqual([70])
    expect(pool.slots()).toEqual([{ entity: 70, instanceId: 7 }])
  })

  it('parks entities for reuse without counting them as alive', () => {
    const pool = new PoolState<number>(1)
    pool.claim(1, 10)
    pool.release(10)
    pool.park(10)
    pool.park(10)
    expect(pool.parkedCount()).toBe(1)
    expect(pool.size).toBe(0)
    expect(pool.unpark()).toBe(10)
    expect(pool.unpark()).toBeNull()
  })

  it('derives the same per-player id from the same wallet, everywhere', () => {
    expect(stableId('0xABC')).toBe(stableId('0xABC'))
    expect(stableId('0xABC')).not.toBe(stableId('0xABD'))
    expect(stableId('')).toBeGreaterThanOrEqual(0)
  })
})

describe('_runtime spawn plan', () => {
  it('names spawn #i of a phase identically on every client', () => {
    expect(planInstanceId(3, 7)).toBe(3 * PLAN_ID_STRIDE + 7)
    expect(planPhaseOf(planInstanceId(3, 7))).toBe(3)
    expect(planIndexOf(planInstanceId(3, 7))).toBe(7)
    expect(planInstanceId(1, 0)).not.toBe(planInstanceId(0, 0))
    expect(() => planInstanceId(1, PLAN_ID_STRIDE)).toThrow()
  })

  it('orders a plan by time, then id, so drains match everywhere', () => {
    const sorted = sortPlan([
      { instanceId: 2, atMs: 100 },
      { instanceId: 1, atMs: 100 },
      { instanceId: 3, atMs: 50 }
    ])
    expect(sorted.map((entry) => entry.instanceId)).toEqual([3, 1, 2])
  })

  it('re-planning the same tuple is a no-op; a changed tuple replans', () => {
    const queue = new PlanQueue()
    const tuple = { seed: 9, phase: 1, phaseStartMs: 1000, configVersion: 2 }
    expect(queue.reset(tupleKey(tuple), [{ instanceId: 1, atMs: 0 }])).toBe(true)
    expect(queue.reset(tupleKey(tuple), [{ instanceId: 1, atMs: 0 }])).toBe(false)
    expect(queue.reset(tupleKey({ ...tuple, phase: 2 }), [{ instanceId: 2, atMs: 0 }])).toBe(true)
  })

  it('fast-forwards: everything already due spawns at once on the first sync', () => {
    const queue = new PlanQueue()
    queue.reset('k', [
      { instanceId: 1, atMs: 0 },
      { instanceId: 2, atMs: 500 },
      { instanceId: 3, atMs: 5000 }
    ])
    expect(queue.due(1000).map((entry) => entry.instanceId)).toEqual([1, 2])
    expect(queue.pendingCount).toBe(1)
    expect(queue.due(1000)).toEqual([])
  })

  it('a full pool delays a spawn instead of consuming it', () => {
    const queue = new PlanQueue()
    queue.reset('k', [
      { instanceId: 1, atMs: 0 },
      { instanceId: 2, atMs: 0 }
    ])
    expect(queue.due(10, 1).map((entry) => entry.instanceId)).toEqual([1])
    expect(queue.pendingCount).toBe(1)
    expect(queue.due(10, 1).map((entry) => entry.instanceId)).toEqual([2])
  })

  it('a death that arrives before the spawn cancels it — for good', () => {
    const queue = new PlanQueue()
    queue.suppress(2)
    queue.reset('k', [
      { instanceId: 1, atMs: 0 },
      { instanceId: 2, atMs: 0 }
    ])
    expect(queue.due(10).map((entry) => entry.instanceId)).toEqual([1])
    // and it survives a replan, which is what makes a rejoin land on the live set
    queue.reset('k2', [{ instanceId: 2, atMs: 0 }])
    expect(queue.due(10)).toEqual([])
    expect(queue.isSuppressed(2)).toBe(true)
  })

  it('never spawns the same instance twice across a replan', () => {
    const queue = new PlanQueue()
    queue.reset('k', [{ instanceId: 5, atMs: 0 }])
    expect(queue.due(1).map((entry) => entry.instanceId)).toEqual([5])
    queue.reset('k2', [{ instanceId: 5, atMs: 0 }])
    expect(queue.due(1)).toEqual([])
    expect(queue.hasSpawned(5)).toBe(true)
    queue.clear()
    expect(queue.hasSpawned(5)).toBe(false)
  })
})

describe('_runtime outcome ledger', () => {
  it('assigns sequence numbers and answers repair requests', () => {
    const log = new OutcomeLog()
    log.append(1, 'hit', 12)
    const died = log.append(1, 'died', 0)
    expect(died.seq).toBe(2)
    expect(log.lastSeq).toBe(2)
    expect(log.since(1)).toEqual([died])
    expect(log.since(0)).toHaveLength(2)
  })

  it('restores from durable state and keeps counting', () => {
    const log = new OutcomeLog()
    log.restore([
      { seq: 4, instanceId: 1, kind: 'hit', value: 10 },
      { seq: 5, instanceId: 1, kind: 'died', value: 0 }
    ])
    expect(log.lastSeq).toBe(5)
    expect(log.append(2, 'hit', 3).seq).toBe(6)
  })

  it('applies in seq order and reports the gap it cannot fill', () => {
    const stream = new OutcomeStream()
    const first = { seq: 1, instanceId: 1, kind: 'hit', value: 5 }
    const third = { seq: 3, instanceId: 1, kind: 'died', value: 0 }
    expect(stream.accept([first]).applied).toEqual([first])
    const gapped = stream.accept([third])
    expect(gapped.applied).toEqual([])
    expect(gapped.gapFrom).toBe(2)
    const repaired = stream.accept([{ seq: 2, instanceId: 1, kind: 'hit', value: 5 }])
    expect(repaired.applied.map((entry) => entry.seq)).toEqual([2, 3])
    expect(repaired.gapFrom).toBeNull()
    expect(stream.lastSeq).toBe(3)
  })

  it('ignores replays of entries it already applied', () => {
    const stream = new OutcomeStream()
    const entry = { seq: 1, instanceId: 1, kind: 'hit', value: 5 }
    expect(stream.accept([entry]).applied).toHaveLength(1)
    expect(stream.accept([entry]).applied).toHaveLength(0)
  })

  it('fast-forwards a rejoiner past history the server no longer retains', () => {
    const stream = new OutcomeStream()
    const applied = stream.fastForward([
      { seq: 40, instanceId: 1, kind: 'died', value: 0 },
      { seq: 41, instanceId: 2, kind: 'hit', value: 7 }
    ])
    expect(applied.map((entry) => entry.seq)).toEqual([40, 41])
    expect(stream.lastSeq).toBe(41)
    expect(stream.accept([{ seq: 42, instanceId: 2, kind: 'died', value: 0 }]).applied).toHaveLength(1)
  })

  it('chunks deliveries so no message approaches the transport ceiling', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, instanceId: i, kind: 'hit', value: 1 }))
    expect(chunkEntries(entries, 2).map((chunk) => chunk.length)).toEqual([2, 2, 1])
    expect(chunkEntries([], 2)).toEqual([])
  })

  it('drops malformed entries instead of trusting them', () => {
    expect(readOutcomeEntry({ seq: 1, instanceId: 2, kind: 'hit', value: 3 })).toEqual({
      seq: 1,
      instanceId: 2,
      kind: 'hit',
      value: 3
    })
    expect(readOutcomeEntry({ seq: 0, instanceId: 2, kind: 'hit' })).toBeNull()
    expect(readOutcomeEntry({ seq: 1, instanceId: 'x', kind: 'hit' })).toBeNull()
    expect(readOutcomeEntry({ seq: 1, instanceId: 2, kind: '' })).toBeNull()
    expect(readOutcomeEntry(null)).toBeNull()
    expect(readOutcomeEntry({ seq: 1, instanceId: 2, kind: 'hit' })?.value).toBe(0)
    expect(readOutcomeEntries('nope')).toEqual([])
    expect(readOutcomeEntries([{ seq: 1, instanceId: 2, kind: 'hit', value: 1 }, 'junk'])).toHaveLength(1)
  })
})
