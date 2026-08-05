// What a Spawnable prefab actually promises at runtime, as chips.
//
// Sync mode is never authored: it is an argument at pool-open — `spawner.plan(…)`,
// `spawner.pool(…, 'server')`, `spawner.perPlayer(…)` — so the only honest place
// to read it is the code that opens the pool. Nothing here looks at `data.json`
// for a mode, and a prefab two consumers use differently gets both chip sets.
// With no consumer, the answer is one chip that says so, never a guess.
//
// The scan is textual on purpose: the editor has no bundler view of the project,
// and the call it looks for is a one-liner by construction. It reads through the
// two import shapes the kit actually uses — `import * as spawner from …` and
// `import { plan as openPlannedPool } from …` — and it resolves the first
// argument through the Script layout params, because that is where a
// `PrefabRef` param's UUID lives.
//
// Pure: text in, chips out. Reading the project's scripts is consumers.ts.
import { parseLayout } from '../script/parser'
import { SCRIPT_COMPONENT, isRecord, type PrefabData } from './format'
import { aliasFor, readSpawnable } from './spawnable'

export type SpawnMode = 'server' | 'planned' | 'seeded' | 'perPlayer'
export type GuaranteeTone = 'server' | 'client' | 'info'

export interface GuaranteeChip {
  tone: GuaranteeTone
  label: string
  tip: string
}

/** How a call site names the prefab it opens a pool for. */
export type SpawnRef =
  | { kind: 'param'; name: string }
  | { kind: 'alias'; name: string }
  | { kind: 'literal'; value: string }
  | { kind: 'unknown' }

export interface SpawnCall {
  /** project-relative path of the script the call sits in */
  script: string
  mode: SpawnMode
  ref: SpawnRef
}

type SpawnFn = 'plan' | 'pool' | 'perPlayer'

const SPAWN_FNS: SpawnFn[] = ['plan', 'pool', 'perPlayer']
const SPAWNER_MODULE = /(^|\/)spawner(\.ts)?$/
const MODE_ORDER: SpawnMode[] = ['server', 'planned', 'seeded', 'perPlayer']

// The trust ceiling, stated once. Every clause is a chip; joined, they are the
// sentence concept-final.md requires verbatim, which is also the card tooltip.
const PLANNED_LABELS = [
  'Same spawns and same alive-set everywhere',
  'positions client-simulated',
  'hits client-reported',
  'damage server-tracked'
] as const

export const PLANNED_GUARANTEE = `${PLANNED_LABELS.join(' · ')}.`

export const PENDING_LABEL = 'pending — mode derived from consumer'

const PENDING_CHIP: GuaranteeChip = {
  tone: 'info',
  label: PENDING_LABEL,
  tip: 'No code opens a pool for this prefab yet. Call spawner.plan, spawner.pool or spawner.perPlayer on it and the guarantees fill in.'
}

const CHIPS: Record<SpawnMode, GuaranteeChip[]> = {
  server: [
    {
      tone: 'server',
      label: 'Server-owned',
      tip: 'One copy, simulated on the Multiplayer Server and synced to every client.'
    },
    {
      tone: 'client',
      label: 'read-only on clients',
      tip: 'A client that writes to it is rejected by the validator — the server’s value wins.'
    }
  ],
  planned: [
    {
      tone: 'info',
      label: PLANNED_LABELS[0],
      tip: 'Every client rebuilds the same plan from the same server tuple, so the same clones exist on every screen and the ledger keeps the alive-set in step.'
    },
    {
      tone: 'client',
      label: PLANNED_LABELS[1],
      tip: 'Each client moves its own copies. Two players never see one in exactly the same place — the server never materialises these entities, so it cannot say where they are.'
    },
    {
      tone: 'client',
      label: PLANNED_LABELS[2],
      tip: 'A hit is a claim a client sends. The server rate-limits and clamps it; it cannot verify proximity, in principle.'
    },
    {
      tone: 'server',
      label: PLANNED_LABELS[3],
      tip: 'HP lives on the server, keyed by plan-entry id, and every change is broadcast in sequence. The number is trustworthy even though the position is not.'
    }
  ],
  seeded: [
    {
      tone: 'server',
      label: 'Same choice everywhere',
      tip: 'The server picks; the pick is what travels. Everyone reconstructs from the same value.'
    },
    {
      tone: 'client',
      label: 'geometry client-reconstructed',
      tip: 'The entities are client-local rebuilds of that pick. Nothing about them is synced, and nothing about them is validated.'
    }
  ],
  perPlayer: [
    {
      tone: 'info',
      label: 'One per player',
      tip: 'One clone per connected player, spawned at join and released when they leave.'
    },
    {
      tone: 'client',
      label: 'client-rendered',
      tip: 'What you see is drawn locally and follows the avatar. Its position is cosmetic, not authoritative.'
    },
    {
      tone: 'server',
      label: 'HP server-owned',
      tip: 'The health number is server-tracked and validated. Where the healthbar sits is not.'
    }
  ]
}

// One chip per mode for the card grid, where four clauses would not fit. The
// verbatim promise moves into the tooltip rather than being shortened.
const SUMMARY: Record<SpawnMode, GuaranteeChip> = {
  server: {
    tone: 'server',
    label: 'Server-owned',
    tip: 'One copy on the Multiplayer Server, synced to every client. Client writes are rejected.'
  },
  planned: { tone: 'info', label: 'Planned spawns', tip: PLANNED_GUARANTEE },
  seeded: {
    tone: 'client',
    label: 'Seeded from the server',
    tip: 'Same choice everywhere · geometry client-reconstructed.'
  },
  perPlayer: {
    tone: 'client',
    label: 'One per player',
    tip: 'One per player · client-rendered · HP server-owned.'
  }
}

// Comments are stripped before anything is matched: a kit script documents its
// own imports in a comment block, and a commented-out `import … from './runtime/
// spawner'` would otherwise bind a name that no live call uses.
function stripComments(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c
      i++
      while (i < text.length) {
        if (text[i] === '\\') {
          out += text.slice(i, i + 2)
          i += 2
          continue
        }
        out += text[i]
        i++
        if (text[i - 1] === c) break
      }
      continue
    }
    out += c
    i++
  }
  return out
}

interface Bindings {
  /** local name → the spawner function it was imported as */
  named: Map<string, SpawnFn>
  /** `import * as spawner from './runtime/spawner'` */
  namespaces: string[]
}

function spawnerBindings(text: string): Bindings {
  const named = new Map<string, SpawnFn>()
  const namespaces: string[] = []
  for (const m of text.matchAll(/import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (!SPAWNER_MODULE.test(m[2])) continue
    const clause = m[1].trim()
    const ns = /^\*\s*as\s+(\w+)$/.exec(clause)
    if (ns !== null) {
      namespaces.push(ns[1])
      continue
    }
    const braces = /\{([\s\S]*)\}/.exec(clause)
    if (braces === null) continue
    for (const part of braces[1].split(',')) {
      const entry = part.trim()
      if (entry === '' || entry.startsWith('type ')) continue
      const [imported, local] = entry.split(/\s+as\s+/).map((s) => s.trim())
      const fn = SPAWN_FNS.find((f) => f === imported)
      if (fn === undefined) continue
      named.set(local === undefined || local === '' ? imported : local, fn)
    }
  }
  return { named, namespaces }
}

// Top-level arguments of the call whose `(` sits at `open`. Quote- and
// nesting-aware so an arrow-function argument (`plan(ref, (tuple) => …, opts)`)
// does not split at its own commas.
function argsAt(text: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  let quote = ''
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (quote !== '') {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) {
        args.push(text.slice(start, i))
        return args
      }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(start, i))
      start = i + 1
    }
  }
  return args
}

function refOf(arg: string): SpawnRef {
  const expr = arg.trim().replace(/\s+as\s+[\w<>[\].| ]+$/, '')
  const param = /^this\.(\w+)$/.exec(expr)
  if (param !== null) return { kind: 'param', name: param[1] }
  const alias = /^Spawnables\.(\w+)$/.exec(expr)
  if (alias !== null) return { kind: 'alias', name: alias[1] }
  const literal = /^['"]([^'"]*)['"]$/.exec(expr)
  if (literal !== null) return { kind: 'literal', value: literal[1] }
  return { kind: 'unknown' }
}

function modeOf(fn: SpawnFn, args: string[]): SpawnMode | null {
  if (fn === 'plan') return 'planned'
  if (fn === 'perPlayer') return 'perPlayer'
  const declared = /^['"](server|seeded)['"]$/.exec((args[1] ?? '').trim())
  return declared === null ? null : (declared[1] as SpawnMode)
}

function callsAt(text: string, pattern: RegExp, fnOf: (m: RegExpMatchArray) => SpawnFn, script: string): SpawnCall[] {
  const out: SpawnCall[] = []
  for (const m of text.matchAll(pattern)) {
    const open = (m.index ?? 0) + m[0].length - 1
    const args = argsAt(text, open)
    if (args.length === 0) continue
    const mode = modeOf(fnOf(m), args)
    if (mode === null) continue
    out.push({ script, mode, ref: refOf(args[0]) })
  }
  return out
}

/** Every pool-open in one script's text. */
export function spawnCallsIn(text: string, script = ''): SpawnCall[] {
  const source = stripComments(text)
  const bindings = spawnerBindings(source)
  const calls: SpawnCall[] = []
  for (const [name, fn] of bindings.named) {
    calls.push(...callsAt(source, new RegExp(`(?:^|[^\\w$.])${name}\\s*\\(`, 'g'), () => fn, script))
  }
  for (const ns of bindings.namespaces) {
    calls.push(
      ...callsAt(
        source,
        new RegExp(`(?:^|[^\\w$.])${ns}\\s*\\.\\s*(plan|pool|perPlayer)\\s*\\(`, 'g'),
        (m) => m[1] as SpawnFn,
        script
      )
    )
  }
  return calls
}

// A carried runtime module IS the spawner — its own internals would read as a
// project-wide pool-open on every prefab.
function isConsumer(path: string): boolean {
  return !path.includes('/runtime/')
}

/** Every pool-open in the project, keyed back to the script it came from. */
export function scanSpawnCalls(scripts: Record<string, string>): SpawnCall[] {
  const calls: SpawnCall[] = []
  for (const [path, text] of Object.entries(scripts)) {
    if (!isConsumer(path)) continue
    calls.push(...spawnCallsIn(text, path))
  }
  return calls
}

// A layout param's stored value is the prefab UUID (`PrefabRef`) or a list of
// them (`PrefabRef[]`). Callers hand us either the values or the raw layout
// entries; both are read, because a caller that passes the layout untouched
// should get chips rather than silence.
function paramValue(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return (value as { value: unknown }).value
  }
  return value
}

function paramNamesFor(id: string, layouts: Record<string, Record<string, unknown>>): Set<string> {
  const names = new Set<string>()
  for (const params of Object.values(layouts)) {
    for (const [name, raw] of Object.entries(params)) {
      const value = paramValue(raw)
      if (value === id) names.add(name)
      else if (Array.isArray(value) && value.includes(id)) names.add(name)
    }
  }
  return names
}

// A call whose first argument is a local (`openPool(ref, 'seeded')`, where `ref`
// came out of `this.arenas` three functions ago) is attributed to every prefab
// the script's own params point at. Following the value properly needs a type
// checker; over-attributing inside one script is the honest failure — the chip
// says what that script does with its prefab params, which is what it does.
function refersTo(call: SpawnCall, id: string, alias: string, params: Set<string>, text: string | undefined): boolean {
  switch (call.ref.kind) {
    case 'param':
      return params.has(call.ref.name)
    case 'alias':
      return call.ref.name === alias
    case 'literal':
      return call.ref.value === id
    case 'unknown':
      return text !== undefined && [...params].some((p) => new RegExp(`this\\.${p}\\b`).test(text))
  }
}

/**
 * entityId → its Script layout param VALUES, merged across the entity's rows.
 *
 * A `PrefabRef` param stores the prefab's UUID and a `PrefabRef[]` an array of
 * them, which is the whole reason this map exists: it is what turns
 * `spawner.plan(this.zombie, …)` into a statement about one particular prefab.
 */
export function scriptLayouts(
  snapshot: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  const layouts: Record<string, Record<string, unknown>> = {}
  for (const [entityId, components] of Object.entries(snapshot)) {
    const value = components[SCRIPT_COMPONENT]
    const rows = isRecord(value) ? value.value : undefined
    if (!Array.isArray(rows)) continue
    const params: Record<string, unknown> = {}
    for (const row of rows) {
      if (!isRecord(row) || typeof row.layout !== 'string') continue
      const layout = parseLayout(row.layout)
      if (layout === undefined) continue
      for (const [name, param] of Object.entries(layout.params)) params[name] = param.value
    }
    if (Object.keys(params).length > 0) layouts[entityId] = params
  }
  return layouts
}

export interface GuaranteeInput {
  data: PrefabData
  /** every project script's text, keyed by project-relative path */
  scripts: Record<string, string>
  /** entityId → its `asset-packs::Script` layout param values */
  layouts: Record<string, Record<string, unknown>>
}

/** The modes the project's own code opens this prefab in, in a stable order. */
export function spawnModesFor(input: GuaranteeInput): SpawnMode[] {
  return modesFromCalls(input.data, scanSpawnCalls(input.scripts), input.layouts, input.scripts)
}

// The fast path: the panel scans once and resolves every card against the same
// call list, instead of re-reading every script per card.
export function modesFromCalls(
  data: PrefabData,
  calls: SpawnCall[],
  layouts: Record<string, Record<string, unknown>>,
  scripts: Record<string, string> = {}
): SpawnMode[] {
  if (readSpawnable(data) === null) return []
  const alias = aliasFor(data.name)
  const params = paramNamesFor(data.id, layouts)
  const found = new Set<SpawnMode>()
  for (const call of calls) {
    if (refersTo(call, data.id, alias, params, scripts[call.script])) found.add(call.mode)
  }
  return MODE_ORDER.filter((mode) => found.has(mode))
}

function chipsForModes(modes: SpawnMode[], pick: (mode: SpawnMode) => GuaranteeChip[]): GuaranteeChip[] {
  const out: GuaranteeChip[] = []
  for (const mode of modes) {
    for (const chip of pick(mode)) {
      if (!out.some((c) => c.label === chip.label)) out.push(chip)
    }
  }
  return out
}

/** The full clause row — the property sheet's Guarantees block. */
export function guaranteeChips(input: GuaranteeInput): GuaranteeChip[] {
  return chipsFromModes(input.data, spawnModesFor(input))
}

export function chipsFromModes(data: PrefabData, modes: SpawnMode[]): GuaranteeChip[] {
  if (readSpawnable(data) === null) return []
  if (modes.length === 0) return [PENDING_CHIP]
  return chipsForModes(modes, (mode) => CHIPS[mode])
}

/** One chip per resolved mode — the card grid, where the full row does not fit. */
export function guaranteeSummaries(input: GuaranteeInput): GuaranteeChip[] {
  return summariesFromModes(input.data, spawnModesFor(input))
}

export function summariesFromModes(data: PrefabData, modes: SpawnMode[]): GuaranteeChip[] {
  if (readSpawnable(data) === null) return []
  if (modes.length === 0) return [PENDING_CHIP]
  return chipsForModes(modes, (mode) => [SUMMARY[mode]])
}
