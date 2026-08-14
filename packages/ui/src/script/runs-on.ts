// What a script's own text says about the game and about the side its code runs
// on, derived from the file rather than from a table of verb names: a creator
// says which side a line is on with the official `isServer()` from
// '@dcl/sdk/network', so the server's regions are the branches themselves.
//
// Two things read this file: the scene checks that ask what a script listens
// for, asks and ends (`gameUse`), and the spawned-only check, which asks whether
// a prefab keeps a non-empty server region (`hasServerRegion`). One parse serves
// both — a second scanner would drift from this one within a release.
//
// Same discipline as guarantees.ts: comments and string CONTENTS are masked
// before matching (script-source.ts), so a call written inside a doc block never
// counts, and the game verbs are only read on a script that really imports the
// module.
import { scanScriptSource, type ScriptSource } from '../prefabs/script-source'

const GAME_MODULE = /(^|\/)game$/
const SDK_NETWORK = '@dcl/sdk/network'
const IS_SERVER = 'isServer'

interface Bindings {
  /** local name the `game` object was imported under, when it was */
  game: string | null
  /** local names that call the SDK's isServer() */
  server: string[]
}

const IMPORT_RE = /import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g

/** `{ a, b as c }` → the imported/local pairs, type-only entries dropped. */
function namedImports(clause: string): Array<[string, string]> {
  const braces = /\{([\s\S]*)\}/.exec(clause)
  if (braces === null) return []
  const out: Array<[string, string]> = []
  for (const part of braces[1].split(',')) {
    const entry = part.trim()
    if (entry === '' || entry.startsWith('type ')) continue
    const [imported, alias] = entry.split(/\s+as\s+/).map((s) => s.trim())
    out.push([imported, alias === undefined || alias === '' ? imported : alias])
  }
  return out
}

function escapeName(name: string): string {
  return name.replace(/\$/g, '\\$')
}

// `isServer` is answered even when the file never imported it: the name has one
// meaning in a scene, and a file that calls it without the import does not build
// anyway. The import only widens the set, for the alias spelling.
function bindings(code: string): Bindings {
  const found: Bindings = { game: null, server: [IS_SERVER] }
  for (const m of code.matchAll(IMPORT_RE)) {
    for (const [imported, local] of namedImports(m[1])) {
      if (GAME_MODULE.test(m[2]) && imported === 'game') found.game = local
      if (m[2] === SDK_NETWORK && imported === IS_SERVER && !found.server.includes(local)) found.server.push(local)
    }
  }
  return found
}

// Module-level string constants, so `game.onRequest(FINISH, …)` — how real
// scripts name their messages — reads as well as an inlined literal would.
function stringConstants(code: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const m of code.matchAll(/(?:^|[^\w$.])const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]*)['"]/g)) {
    if (m[2].trim() !== '') found[m[1]] = m[2]
  }
  return found
}

// The call's first argument: a literal, or a constant this file declares.
// Anything else computed has no label a creator would recognise, so the caller
// falls back to naming the verb rather than guessing.
function firstLiteral(source: ScriptSource, open: number, consts: Record<string, string>): string | null {
  const rest = source.code.slice(open + 1, open + 80)
  const text = /^\s*['"]([^'"]*)['"]\s*[,)]/.exec(rest)
  if (text !== null) return text[1].trim() === '' ? null : text[1]
  const num = /^\s*(\d+(?:\.\d+)?)\s*[,)]/.exec(rest)
  if (num !== null) return num[1]
  const ref = /^\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest)
  return ref === null ? null : (consts[ref[1]] ?? null)
}

// --- the regions the Multiplayer Server runs ---

/** A span of the masked source, both ends inclusive: the brackets that hold it. */
interface Region {
  start: number
  end: number
}

function matchingBracket(source: ScriptSource, open: number, close: string): number {
  const opener = source.code[open]
  let depth = 0
  for (let i = open; i < source.code.length; i++) {
    if (source.inString[i] === 1) continue
    const c = source.code[i]
    if (c === opener) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

// Words that take a parenthesised head and a block, and are not functions.
const NOT_A_FUNCTION = ['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'constructor', 'return']

// Every declared function, method and constructor body in the file. An inverted
// bail (`if (!isServer()) return`) hands the REST of the method to the server, so
// the walk has to know where the method holding that branch ends. Names are not
// kept: two classes can both declare `start()`, and keeping only the first would
// leave the second's body outside every span.
function functionBodies(source: ScriptSource): Region[] {
  const bodies: Region[] = []
  for (const m of source.code.matchAll(/(?:^|[^\w$.])(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (NOT_A_FUNCTION.includes(m[1])) continue
    const open = (m.index ?? 0) + m[0].length - 1
    if (source.inString[open] === 1) continue
    const close = matchingBracket(source, open, ')')
    if (close < 0) continue
    // a declaration, not a call: the parameter list is followed by a block,
    // optionally through a return-type annotation
    const head = /^(?:\s*:[^{;=)]*)?\s*\{/.exec(source.code.slice(close + 1))
    if (head === null) continue
    const body = close + head[0].length
    const end = matchingBracket(source, body, '}')
    if (end > body) bodies.push({ start: body, end })
  }
  return bodies
}

/** The narrowest function body holding an offset — where a bail's `return` lands. */
function innermostBody(bodies: Region[], at: number): Region | null {
  let best: Region | null = null
  for (const body of bodies) {
    if (at < body.start || at > body.end) continue
    if (best === null || body.start > best.start) best = body
  }
  return best
}

// The end of an unbraced statement: the first `;` or line break outside brackets,
// or the bracket that closes the block around it — `{ if (isServer()) return }`
// on one line ends at the `return`, not at the end of the file.
function statementEnd(source: ScriptSource, from: number): number {
  let depth = 0
  for (let i = from; i < source.code.length; i++) {
    if (source.inString[i] === 1) continue
    const c = source.code[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i - 1
      depth--
    } else if (depth === 0 && (c === ';' || c === '\n')) return i
  }
  return source.code.length - 1
}

/** True when a half hands control back — the shape that makes the rest the other side's. */
function bails(text: string): boolean {
  return /(?:^|[;{}\n])\s*(?:return|throw)\b[^;\n]*[;\s]*$/.test(text)
}

interface Half {
  region: Region
  /** true when the half ends in a `return`, so the code after it is the other side's */
  bails: boolean
}

/** The block or single statement a branch head governs, starting after `close`. */
function halfAfter(source: ScriptSource, close: number): Half | null {
  let at = close + 1
  while (at < source.code.length && /\s/.test(source.code[at])) at++
  if (at >= source.code.length) return null
  if (source.code[at] === '{') {
    const end = matchingBracket(source, at, '}')
    if (end < 0) return null
    return { region: { start: at, end }, bails: bails(source.code.slice(at + 1, end)) }
  }
  const end = statementEnd(source, at)
  return { region: { start: at, end }, bails: bails(source.code.slice(at, end + 1)) }
}

function elseAfter(source: ScriptSource, end: number): Half | null {
  const rest = /^(\s*(?:;\s*)?else\b)/.exec(source.code.slice(end + 1))
  if (rest === null) return null
  return halfAfter(source, end + rest[1].length)
}

/** Everything but whitespace, brackets and a bare `return` — an empty half has none. */
function meaningful(source: ScriptSource, region: Region): boolean {
  return source.code.slice(region.start, region.end + 1).replace(/\breturn\b|[{}();\s]/g, '') !== ''
}

// The spellings that read as "this is the Multiplayer Server", whitespace already
// stripped by the caller: the call itself, plus any place the answer was cached
// (`this.serverSide = isServer()`, which is how wave-director.ts writes it).
function truthTests(source: ScriptSource, names: string[]): string[] {
  const calls = names.map((n) => `${escapeName(n)}\\(\\)`)
  const cached: string[] = []
  const re = new RegExp(
    `(?:^|[^\\w$.])(?:(?:const|let|var)\\s+)?(this\\s*\\.\\s*)?([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${names
      .map((n) => `${escapeName(n)}\\s*\\(\\s*\\)`)
      .join('|')})`,
    'g'
  )
  for (const m of source.code.matchAll(re)) {
    if (source.inString[m.index ?? 0] === 1) continue
    const test = m[1] === undefined ? escapeName(m[2]) : `this\\.${escapeName(m[2])}`
    if (!cached.includes(test)) cached.push(test)
  }
  return [...calls, ...cached]
}

// Every span an `isServer()` branch puts on the Multiplayer Server. Textual and
// deliberately so — the point is to answer which side a region is on, not to
// type-check the file. Four shapes, all of them shipped in the kit today:
//
//   if (isServer()) { … }              the canonical branch
//   if (isServer()) this.startServer() the dispatcher — the call is the half
//   if (!isServer()) return            the client bails; the rest is the server's
//   this.serverSide = isServer()       the answer cached on a field, branched later
//
// `if (isServer()) return` is a branch with an EMPTY server half, which is why
// the spans are filtered for content rather than counted.
function serverRegions(source: ScriptSource, names: string[]): Region[] {
  const tests = truthTests(source, names)
  const positive = new RegExp(`^\\(*(?:${tests.join('|')})\\)*$`)
  const negated = new RegExp(`^\\(*!\\(*(?:${tests.join('|')})\\)*$`)
  const bodies = functionBodies(source)
  const regions: Region[] = []
  for (const m of source.code.matchAll(/(?:^|[^\w$.])if\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (source.inString[open] === 1) continue
    const close = matchingBracket(source, open, ')')
    if (close < 0) continue
    const head = source.code.slice(open + 1, close).replace(/\s+/g, '')
    const asks = positive.test(head)
    const inverted = !asks && negated.test(head)
    if (!asks && !inverted) continue
    const then = halfAfter(source, close)
    if (then === null) continue
    if (asks) {
      if (meaningful(source, then.region)) regions.push(then.region)
      continue
    }
    const otherwise = elseAfter(source, then.region.end)
    if (otherwise !== null) {
      if (meaningful(source, otherwise.region)) regions.push(otherwise.region)
      continue
    }
    if (!then.bails) continue
    const body = innermostBody(bodies, open)
    const rest = body === null ? null : { start: then.region.end + 1, end: body.end }
    if (rest !== null && rest.end > rest.start && meaningful(source, rest)) regions.push(rest)
  }
  return regions
}

// --- the scan every reader shares ---

interface Scan {
  source: ScriptSource
  bindings: Bindings
  consts: Record<string, string>
  /** true when the file says which side it is on, anywhere */
  branches: boolean
}

function scanGame(text: string): Scan {
  const source = scanScriptSource(text)
  const found = bindings(source.code)
  const call = new RegExp(`(?:^|[^\\w$.])(?:${found.server.map(escapeName).join('|')})\\s*\\(`, 'g')
  let branches = false
  for (const m of source.code.matchAll(call)) {
    if (source.inString[(m.index ?? 0) + m[0].length - 1] === 1) continue
    branches = true
    break
  }
  return { source, bindings: found, consts: stringConstants(source.code), branches }
}

/** Call sites of one `game.<verb>(`, with the offset of their first argument. */
function callSites(scan: Scan, verbs: string[]): Array<{ verb: string; open: number }> {
  if (scan.bindings.game === null) return []
  const pattern = new RegExp(
    `(?:^|[^\\w$.])${scan.bindings.game}\\s*\\.\\s*(${verbs.join('|')})\\s*(?:<[^<>()]*>)?\\s*\\(`,
    'g'
  )
  const out: Array<{ verb: string; open: number }> = []
  for (const m of scan.source.code.matchAll(pattern)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (scan.source.inString[open] === 1) continue // an example call inside a doc string
    out.push({ verb: m[1], open })
  }
  return out
}

/**
 * Whether a script keeps work on the Multiplayer Server — a NON-EMPTY server
 * region, never the presence of the token. The scaffold writes `isServer()` into
 * every script, and `if (isServer()) return` is a script standing its server half
 * down whole.
 */
export function hasServerRegion(text: string): boolean {
  const scan = scanGame(text)
  if (!scan.branches) return false
  return serverRegions(scan.source, scan.bindings.server).length > 0
}

// --- the two side mistakes nothing else reports ---

/**
 * What a script gets wrong about sides with no error anywhere: the compiler is
 * happy, Play boots, and the scene simply behaves as if one side were missing.
 */
export interface SideSlips {
  /** `isServer()` read in module-body code, where it answers false for every side */
  readsServerAtModuleScope: boolean
  /** the client-only calls made inside an `isServer()` region, deduped, in source order */
  clientOnlyOnServer: string[]
  /** `new MessageBus()` built in module-body code — the one module the server cannot load */
  makesMessageBusAtModuleScope: boolean
}

// Client-only by implementation, not by signature: Hammurabi answers
// ~system/RestrictedActions on the Multiplayer Server too, so these RESOLVE
// there — no throw, no log, and nobody moved.
const CLIENT_ONLY = ['movePlayerTo', 'triggerEmote', 'openExternalUrl']
const RESTRICTED_MODULE = '~system/RestrictedActions'
const MESSAGE_BUS_MODULE = '@dcl/sdk/message-bus'
const MESSAGE_BUS = 'MessageBus'

/** The canonical names plus whatever this file imported them as. */
function localNames(code: string, module: string, imported: string[]): string[] {
  const names = [...imported]
  for (const m of code.matchAll(IMPORT_RE)) {
    if (m[2] !== module) continue
    for (const [name, local] of namedImports(m[1])) {
      if (imported.includes(name) && !names.includes(local)) names.push(local)
    }
  }
  return names
}

// Everything that runs LATER than the module body: declared functions and
// methods, the constructors NOT_A_FUNCTION holds back from the bail walk, and
// arrow bodies, which no declaration names. Whatever is left is evaluated the
// moment the file loads.
function deferredSpans(source: ScriptSource): Region[] {
  const spans = functionBodies(source)
  for (const m of source.code.matchAll(/(?:^|[^\w$.])constructor\s*\(/g)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (source.inString[open] === 1) continue
    const close = matchingBracket(source, open, ')')
    if (close < 0) continue
    const half = halfAfter(source, close)
    if (half !== null) spans.push(half.region)
  }
  for (const m of source.code.matchAll(/=>/g)) {
    const at = m.index ?? 0
    if (source.inString[at] === 1) continue
    const half = halfAfter(source, at + 1)
    if (half !== null) spans.push(half.region)
  }
  return spans
}

function within(spans: Region[], at: number): boolean {
  return spans.some((span) => at >= span.start && at <= span.end)
}

/** Call sites of any of `names`, as offsets of the name itself. */
function sitesOf(source: ScriptSource, names: string[], head: string): Array<{ name: string; at: number }> {
  const re = new RegExp(`(?:^|[^\\w$.])${head}(${names.map(escapeName).join('|')})\\s*\\(`, 'g')
  const out: Array<{ name: string; at: number }> = []
  for (const m of source.code.matchAll(re)) {
    const at = (m.index ?? 0) + m[0].indexOf(m[1])
    if (source.inString[at] === 1) continue
    out.push({ name: m[1], at })
  }
  return out
}

/**
 * The two silent side mistakes, from the one parse every other reader here uses.
 *
 * `isServer()` is a synchronous read of an answer the platform swaps in before
 * the first tick, so in module-body code it answers false for EVERY side — a
 * creator who caches it at the top of a file gets the client path on the
 * Multiplayer Server, forever, and nothing says so.
 */
export function sideSlips(text: string): SideSlips {
  const source = scanScriptSource(text)
  const found = bindings(source.code)
  const spans = deferredSpans(source)
  const slips: SideSlips = {
    readsServerAtModuleScope: sitesOf(source, found.server, '').some((site) => !within(spans, site.at)),
    clientOnlyOnServer: [],
    makesMessageBusAtModuleScope: sitesOf(
      source,
      localNames(source.code, MESSAGE_BUS_MODULE, [MESSAGE_BUS]),
      'new\\s+'
    ).some((site) => !within(spans, site.at))
  }
  const regions = serverRegions(source, found.server)
  if (regions.length === 0) return slips
  const restricted = localNames(source.code, RESTRICTED_MODULE, CLIENT_ONLY)
  for (const site of sitesOf(source, restricted, '')) {
    if (!within(regions, site.at) || slips.clientOnlyOnServer.includes(site.name)) continue
    slips.clientOnlyOnServer.push(site.name)
  }
  return slips
}

/** What a script asks of the game — the raw names the scene checks compare. */
export interface GameUse {
  /** zone names it listens on (`game.onEnterArea`) */
  zones: string[]
  /** message names the server answers here (`game.onRequest`) */
  handles: string[]
  /** message names this client asks the server for (`game.request`) */
  sends: string[]
  /** true when this script ends a round itself (`game.newRound()`) */
  endsRound: boolean
  /** broadcast names this script listens on (`game.onBroadcast`) */
  listens: string[]
  /** broadcast names this script sends (`game.broadcast`) */
  broadcasts: string[]
}

// A broadcast needs no answer, so the SENDER needs no check — but a listener
// with nothing sending it is a placed item that can never do anything, which is
// why both halves are collected even though only one direction can be wrong.
export function gameUse(text: string): GameUse {
  const scan = scanGame(text)
  const use: GameUse = { zones: [], handles: [], sends: [], endsRound: false, listens: [], broadcasts: [] }
  const verbs = ['onEnterArea', 'onRequest', 'request', 'newRound', 'onBroadcast', 'broadcast'] as const
  const bucket: Record<string, keyof GameUse> = {
    onRequest: 'handles',
    request: 'sends',
    onEnterArea: 'zones',
    onBroadcast: 'listens',
    broadcast: 'broadcasts'
  }
  for (const site of callSites(scan, [...verbs])) {
    if (site.verb === 'newRound') {
      use.endsRound = true
      continue
    }
    const name = firstLiteral(scan.source, site.open, scan.consts)
    if (name === null) continue
    const into = use[bucket[site.verb]] as string[]
    if (!into.includes(name)) into.push(name)
  }
  return use
}
