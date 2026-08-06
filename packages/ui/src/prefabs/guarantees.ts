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
// Attribution is PER CONSUMER, and that is the whole discipline here. A call in
// `wave-director.ts` is resolved against the params of the Script rows that run
// `wave-director.ts` — never against every layout in the scene — and only against
// params the parser typed `prefab`/`prefabList`. Comments and string contents are
// masked before anything is matched, so a prefab whose only mention of a server
// pool is in prose never gets a `server` chip. What is left is one honest
// over-attribution, documented at `refersTo`: inside ONE script, a ref the scan
// cannot follow is credited to that script's own prefab params.
//
// Pure: text in, chips out. Reading the project's scripts is consumers.ts.
import { parseLayout, type ScriptParam } from '../script/parser'
import { paramMentions, scanScriptSource, type ScriptSource } from './script-source'
import { SCRIPT_COMPONENT, isRecord, type PrefabData } from './format'
import { aliasFor } from './spawnable'

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
  /** a local the scan cannot follow; `mentions` is every `this.<name>` its script reads */
  | { kind: 'unknown'; mentions: string[] }

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

export const PENDING_LABEL = 'Not used yet'

// The chip's tip says the same thing, but a chip nobody hovers is a chip nobody
// reads: the one state where the whole row is "we cannot promise anything yet"
// gets its sentence in the open, under the chips.
export const PENDING_EXPLAINER =
  'Nothing brings it into the game yet. Pick it in a spawner — the Wave Director’s enemy setting, for example — and it appears while you play.'

const PENDING_CHIP: GuaranteeChip = {
  tone: 'info',
  label: PENDING_LABEL,
  tip: 'Tip: nothing brings this into the game yet. Pick it in a spawner — the Wave Director’s enemy setting, for example — and it appears while you play.'
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
      tip: 'The server rejects anything a player’s own game writes to it — the server’s value wins.'
    }
  ],
  planned: [
    {
      tone: 'info',
      label: PLANNED_LABELS[0],
      tip: 'Every player’s game builds the same spawns from the same numbers the server sends, so the same copies exist on every screen and the same ones are alive.'
    },
    {
      tone: 'client',
      label: PLANNED_LABELS[1],
      tip: 'Each player’s game moves its own copies, so two players never see one in exactly the same place. The server never holds these copies, so it cannot say where they are.'
    },
    {
      tone: 'client',
      label: PLANNED_LABELS[2],
      tip: 'A hit is a claim the player’s own game sends. The server caps how fast hits count and how much they take off, but it cannot check how close the shot really was.'
    },
    {
      tone: 'server',
      label: PLANNED_LABELS[3],
      tip: 'Health lives on the server and every change goes out to everyone in order. The number is trustworthy even when the position is not.'
    }
  ],
  seeded: [
    {
      tone: 'server',
      label: 'Same choice everywhere',
      tip: 'The server makes the pick and sends it out, so every player’s game builds from the same one.'
    },
    {
      tone: 'client',
      label: 'geometry client-reconstructed',
      tip: 'Each player’s game builds these copies itself. Nothing about them is synced, and nothing about them is checked.'
    }
  ],
  perPlayer: [
    {
      tone: 'info',
      label: 'One per player',
      tip: 'One copy per player in the scene, spawned when they join and removed when they leave.'
    },
    {
      tone: 'client',
      label: 'client-rendered',
      tip: 'Each player’s game draws this copy and follows the avatar with it. Where it sits is cosmetic.'
    },
    {
      tone: 'server',
      label: 'HP server-owned',
      tip: 'The server owns and checks the health number. Where the health bar sits it does not.'
    }
  ]
}

// One chip per mode for the card grid, where four clauses would not fit. The
// verbatim promise moves into the tooltip rather than being shortened.
// Each summary restates the mode's HEADLINE clause and must carry that clause's
// tone: the card and the sheet are two views of one statement, and tinting them
// apart made "Seeded from the server" a client-coloured chip naming the server.
const SUMMARY: Record<SpawnMode, GuaranteeChip> = {
  server: {
    tone: 'server',
    label: 'Server-owned',
    tip: 'One copy on the Multiplayer Server, synced to every player. The server rejects what a player’s own game writes.'
  },
  planned: { tone: 'info', label: 'Planned spawns', tip: PLANNED_GUARANTEE },
  seeded: {
    tone: 'server',
    label: 'Seeded from the server',
    tip: 'Same choice everywhere · geometry client-reconstructed.'
  },
  perPlayer: {
    tone: 'info',
    label: 'One per player',
    tip: 'One per player · client-rendered · HP server-owned.'
  }
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

function refOf(arg: string, mentions: string[]): SpawnRef {
  const expr = arg.trim().replace(/\s+as\s+[\w<>[\].| ]+$/, '')
  const param = /^this\.(\w+)$/.exec(expr)
  if (param !== null) return { kind: 'param', name: param[1] }
  const alias = /^Spawnables\.(\w+)$/.exec(expr)
  if (alias !== null) return { kind: 'alias', name: alias[1] }
  const literal = /^['"]([^'"]*)['"]$/.exec(expr)
  if (literal !== null) return { kind: 'literal', value: literal[1] }
  return { kind: 'unknown', mentions }
}

function modeOf(fn: SpawnFn, args: string[]): SpawnMode | null {
  if (fn === 'plan') return 'planned'
  if (fn === 'perPlayer') return 'perPlayer'
  const declared = /^['"](server|seeded)['"]$/.exec((args[1] ?? '').trim())
  return declared === null ? null : (declared[1] as SpawnMode)
}

interface CallScan {
  source: ScriptSource
  pattern: RegExp
  fnOf: (m: RegExpMatchArray) => SpawnFn
  script: string
  mentions: string[]
}

function callsAt(scan: CallScan): SpawnCall[] {
  const out: SpawnCall[] = []
  const { code, inString } = scan.source
  for (const m of code.matchAll(scan.pattern)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (inString[open] === 1) continue // an example call written inside a doc string
    const args = argsAt(code, open)
    if (args.length === 0) continue
    const mode = modeOf(scan.fnOf(m), args)
    if (mode === null) continue
    out.push({ script: scan.script, mode, ref: refOf(args[0], scan.mentions) })
  }
  return out
}

/** Every pool-open in one script's text. */
export function spawnCallsIn(text: string, script = ''): SpawnCall[] {
  const source = scanScriptSource(text)
  const bindings = spawnerBindings(source.code)
  const mentions = paramMentions(source)
  const calls: SpawnCall[] = []
  for (const [name, fn] of bindings.named) {
    calls.push(
      ...callsAt({
        source,
        pattern: new RegExp(`(?:^|[^\\w$.])${name}\\s*\\(`, 'g'),
        fnOf: () => fn,
        script,
        mentions
      })
    )
  }
  for (const ns of bindings.namespaces) {
    calls.push(
      ...callsAt({
        source,
        pattern: new RegExp(`(?:^|[^\\w$.])${ns}\\s*\\.\\s*(plan|pool|perPlayer)\\s*\\(`, 'g'),
        fnOf: (m) => m[1] as SpawnFn,
        script,
        mentions
      })
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

/** One Script row's params by name — a parsed `{type,value}` or a bare value. */
export type LayoutParams = Record<string, unknown>

/** Script path → the params of every Script row in the scene that runs it. */
export type ScriptLayouts = Record<string, LayoutParams[]>

const PREFAB_TYPES: Array<ScriptParam['type']> = ['prefab', 'prefabList']

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

// A parsed param says what it is, and only `prefab`/`prefabList` can name a
// prefab — a string param that happens to hold a UUID is a different thing, and
// the pre-parser fixtures were full of them. A bare value carries no type, so a
// caller that hands one over is taken at its word.
function isPrefabParam(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) return true
  const type = (raw as { type: unknown }).type
  return typeof type === 'string' && PREFAB_TYPES.some((known) => known === type)
}

/** The params of THIS script that point at this prefab. */
function prefabParamsIn(id: string, rows: LayoutParams[] | undefined): Set<string> {
  const names = new Set<string>()
  for (const params of rows ?? []) {
    for (const [name, raw] of Object.entries(params)) {
      if (!isPrefabParam(raw)) continue
      const value = paramValue(raw)
      if (value === id || (Array.isArray(value) && value.includes(id))) names.add(name)
    }
  }
  return names
}

// `params` is always the calling script's OWN prefab params, so nothing here can
// reach across scripts. What is left is one honest over-attribution: a call whose
// first argument is a local (`openPool(ref, 'seeded')`, where `ref` came out of
// `this.arenas` three functions ago) is credited to every prefab that script's
// own params point at, provided the script really reads them. Following the value
// properly needs a type checker; over-attributing inside one script says what that
// script does with its prefab params, which is what it does.
function refersTo(call: SpawnCall, id: string, alias: string, params: Set<string>): boolean {
  switch (call.ref.kind) {
    case 'param':
      return params.has(call.ref.name)
    case 'alias':
      return call.ref.name === alias
    case 'literal':
      return call.ref.value === id
    case 'unknown':
      return call.ref.mentions.some((name) => params.has(name))
  }
}

/**
 * Script path → the params of every Script row that runs it.
 *
 * Keyed by PATH, not by entity: the question a chip answers is "what does the
 * code in this file do with its prefab params", and a param named `zombie` on
 * some other script's row says nothing about this one. Two entities running the
 * same script are two bindings of the same params, so both are kept.
 *
 * A `PrefabRef` param stores the prefab's UUID and a `PrefabRef[]` an array of
 * them, which is the whole reason this map exists: it is what turns
 * `spawner.plan(this.zombie, …)` into a statement about one particular prefab.
 */
export function scriptLayouts(snapshot: Record<string, Record<string, unknown>>): ScriptLayouts {
  const layouts: ScriptLayouts = {}
  for (const components of Object.values(snapshot)) {
    const value = components[SCRIPT_COMPONENT]
    const rows = isRecord(value) ? value.value : undefined
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!isRecord(row) || typeof row.path !== 'string' || typeof row.layout !== 'string') continue
      const layout = parseLayout(row.layout)
      if (layout === undefined || Object.keys(layout.params).length === 0) continue
      const params: LayoutParams = {}
      for (const [name, param] of Object.entries(layout.params)) params[name] = param
      layouts[row.path] = [...(layouts[row.path] ?? []), params]
    }
  }
  return layouts
}

export interface GuaranteeInput {
  data: PrefabData
  /** every project script's text, keyed by project-relative path */
  scripts: Record<string, string>
  /** script path → the `asset-packs::Script` layout params of every row running it */
  layouts: ScriptLayouts
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
  layouts: ScriptLayouts,
  scripts: Record<string, string> = {}
): SpawnMode[] {
  const alias = aliasFor(data.name)
  const known = Object.keys(scripts).length > 0
  const byScript = new Map<string, Set<string>>()
  const found = new Set<SpawnMode>()
  for (const call of calls) {
    // the panel memoises the call list and the layouts separately, so a call can
    // outlive the script it came from by a render; that call says nothing
    if (known && !(call.script in scripts)) continue
    let params = byScript.get(call.script)
    if (params === undefined) {
      params = prefabParamsIn(data.id, layouts[call.script])
      byScript.set(call.script, params)
    }
    if (refersTo(call, data.id, alias, params)) found.add(call.mode)
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
  if (modes.length === 0) return [PENDING_CHIP]
  return chipsForModes(modes, (mode) => CHIPS[mode])
}

/** One chip per resolved mode — the card grid, where the full row does not fit. */
export function guaranteeSummaries(input: GuaranteeInput): GuaranteeChip[] {
  return summariesFromModes(input.data, spawnModesFor(input))
}

// `orphan` = the prefab's only presence is spawn-only or unplaced, so if nothing
// spawns it, it never appears in the game at all — that earns the hint. A placed
// bench that nothing spawns is a bench; saying "not used yet" on it is noise.
export function summariesFromModes(data: PrefabData, modes: SpawnMode[], orphan = true): GuaranteeChip[] {
  if (modes.length === 0) return orphan ? [PENDING_CHIP] : []
  // The sync-mode pills ("Seeded from the server", "Planned spawns"…) named
  // mechanism, not consequence — no creator did anything differently after
  // reading one. The only chip that changes what a creator does is the nudge
  // that nothing brings the prefab into the game yet.
  return []
}
