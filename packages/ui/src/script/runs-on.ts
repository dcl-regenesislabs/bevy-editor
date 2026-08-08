// Where a script's code runs, derived from its own text — the script card's
// runs-on line. Never declared: no metadata says a script is green, the call
// sites do, and the same scan answers for a hand-typed file and for one the
// assistant wrote.
//
// The fork is which callback you write, so the table below IS the answer: every
// entry is a call the game module documents as running on the server (green) or
// on this player's screen (blue). `game.onMessage` counts as green — its
// screen-side direction (a screen hearing the game) belongs to the broadcast
// half the v1 facade ships plain, and the message/decide shape is what the
// template teaches and what every kit script writes.
//
// Two things read this file: the runs-on line (runsOn) and the scene checks that
// ask what a script listens for, sends and ends (gameUse). One parse serves
// both — a second scanner would drift from this one within a release.
//
// Same discipline as guarantees.ts: comments and string CONTENTS are masked
// before matching (script-source.ts), so a call written inside a doc block never
// puts a name on the line, and the scan only runs on a script that really
// imports the module.
import { scanScriptSource, type ScriptSource } from '../prefabs/script-source'

export interface RunsOn {
  /** labels of the parts that run on the server, for everyone */
  green: string[]
  /** labels of the parts that run on this player's screen */
  blue: string[]
}

const GAME_MODULE = /(^|\/)game$/

/** How one call site turns into a label; `null` when the call names nothing. */
type Label = (arg: string | null) => string | null

const GREEN: Record<string, Label> = {
  onMessage: (name) => name ?? 'a message',
  onEnterArea: (area) => `enter ${area ?? 'an area'}`,
  onExitArea: (area) => `leave ${area ?? 'an area'}`,
  onStart: () => 'start',
  onRoundStart: () => 'round start',
  onPlayerJoin: () => 'a player arrives',
  onPlayerLeave: () => 'a player leaves',
  every: (seconds) => (seconds === null ? 'a timer' : `every ${seconds}s`)
}

const STATE_CHANGE_LABEL = 'synced state changes'

const BLUE: Record<string, Label> = {
  onStateChange: () => STATE_CHANGE_LABEL,
  layout: (prefab) => (prefab === null ? 'layouts' : `${prefab} layout`)
}

// The module's two exports a script calls directly. `onClick` is blue by
// construction — pointer state exists only on the screen that owns the cursor.
const BLUE_FREE: Record<string, string> = { onClick: 'clicks' }

// What the game owns and a screen only reads. `round` belongs here with `state`
// and `now`: the round tuple is synced state under another name, and a sign that
// paints the round number is doing exactly what this label says.
const SYNCED_READS = ['state', 'now', 'round']
const SYNCED_READ_LABEL = 'shows synced state'

interface Bindings {
  /** local name the `game` object was imported under, when it was */
  game: string | null
  /** local name → the free export it was imported as */
  free: Map<string, string>
}

function gameBindings(code: string): Bindings {
  const bindings: Bindings = { game: null, free: new Map<string, string>() }
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (!GAME_MODULE.test(m[2])) continue
    const braces = /\{([\s\S]*)\}/.exec(m[1])
    if (braces === null) continue
    for (const part of braces[1].split(',')) {
      const entry = part.trim()
      if (entry === '' || entry.startsWith('type ')) continue
      const [imported, alias] = entry.split(/\s+as\s+/).map((s) => s.trim())
      const local = alias === undefined || alias === '' ? imported : alias
      if (imported === 'game') bindings.game = local
      else if (BLUE_FREE[imported] !== undefined) bindings.free.set(local, imported)
    }
  }
  return bindings
}

// Module-level string constants, so `game.onMessage(FINISH, …)` — how real
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

// --- which offsets the game runs ---

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

// Every named function and method body in the file, by name. A green callback
// that hands off (`() => this.finish(player)`) runs that method in the game too,
// so the region walk needs somewhere to follow the name to.
function functionBodies(source: ScriptSource): Map<string, Region> {
  const bodies = new Map<string, Region>()
  for (const m of source.code.matchAll(/(?:^|[^\w$.])(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1]
    if (NOT_A_FUNCTION.includes(name) || bodies.has(name)) continue
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
    if (end > body) bodies.set(name, { start: body, end })
  }
  return bodies
}

function calleesIn(source: ScriptSource, region: Region): string[] {
  const names: string[] = []
  const text = source.code.slice(region.start, region.end)
  for (const m of text.matchAll(/(?:^|[^\w$])(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (source.inString[region.start + (m.index ?? 0)] === 1) continue
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

// The spans of code the game runs: every green callback's arguments, plus the
// body of anything those callbacks call. Textual and deliberately so — the point
// is to keep a method that only ever runs on the server from being read as screen
// code, not to type-check the file.
function greenRegions(source: ScriptSource, game: string): Region[] {
  const pattern = new RegExp(`(?:^|[^\\w$.])${game}\\s*\\.\\s*(?:${Object.keys(GREEN).join('|')})\\s*\\(`, 'g')
  const regions: Region[] = []
  for (const m of source.code.matchAll(pattern)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (source.inString[open] === 1) continue
    const close = matchingBracket(source, open, ')')
    if (close > open) regions.push({ start: open, end: close })
  }
  const bodies = functionBodies(source)
  // grows as it walks: a method reached from a green callback is green, and so is
  // whatever it calls. Each body joins once, so the walk terminates.
  for (let i = 0; i < regions.length; i++) {
    for (const name of calleesIn(source, regions[i])) {
      const body = bodies.get(name)
      if (body === undefined || regions.some((r) => r.start === body.start)) continue
      regions.push(body)
    }
  }
  return regions
}

function inside(regions: Region[], at: number): boolean {
  return regions.some((region) => at >= region.start && at <= region.end)
}

// --- the scan both readers share ---

interface Scan {
  source: ScriptSource
  bindings: Bindings
  consts: Record<string, string>
  /** the spans the game runs; empty when the script never imports `game` */
  green: Region[]
}

function scanGame(text: string): Scan {
  const source = scanScriptSource(text)
  const bindings = gameBindings(source.code)
  return {
    source,
    bindings,
    consts: stringConstants(source.code),
    green: bindings.game === null ? [] : greenRegions(source, bindings.game)
  }
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

function collect(scan: Scan, labels: Record<string, Label>, out: string[]): void {
  for (const site of callSites(scan, Object.keys(labels))) {
    const label = labels[site.verb](firstLiteral(scan.source, site.open, scan.consts))
    if (label !== null && !out.includes(label)) out.push(label)
  }
}

// A screen that reads game.state / game.now() / game.round outside green code is
// showing synced state — the only signal a purely screen-side script gives, and
// without it a sign that paints the shared clock claimed to run nowhere at all.
function readsSyncedState(scan: Scan): boolean {
  if (scan.bindings.game === null) return false
  const pattern = new RegExp(`(?:^|[^\\w$.])${scan.bindings.game}\\s*\\.\\s*(?:${SYNCED_READS.join('|')})\\b`, 'g')
  for (const m of scan.source.code.matchAll(pattern)) {
    const at = (m.index ?? 0) + m[0].length - 1
    if (scan.source.inString[at] === 1) continue
    if (!inside(scan.green, at)) return true
  }
  return false
}

/** What one script's text says about where its code runs. */
export function runsOn(text: string): RunsOn {
  const scan = scanGame(text)
  const green: string[] = []
  const blue: string[] = []
  collect(scan, GREEN, green)
  collect(scan, BLUE, blue)
  // "reacts to a change" already tells the creator this screen reads the state;
  // saying both on one line is two chips for one fact
  if (!blue.includes(STATE_CHANGE_LABEL) && readsSyncedState(scan)) blue.push(SYNCED_READ_LABEL)
  for (const [local, imported] of scan.bindings.free) {
    const label = BLUE_FREE[imported]
    if (blue.includes(label)) continue
    for (const m of scan.source.code.matchAll(new RegExp(`(?:^|[^\\w$.])${local}\\s*\\(`, 'g'))) {
      if (scan.source.inString[(m.index ?? 0) + m[0].length - 1] === 1) continue
      blue.push(label)
      break
    }
  }
  return { green, blue }
}

/** What a script asks of the game — the raw names the scene checks compare. */
export interface GameUse {
  /** zone names it listens on (`game.onEnterArea` / `game.onExitArea`) */
  zones: string[]
  /** message names the game answers here (`game.onMessage`) */
  handles: string[]
  /** message names sent from this player's screen (`game.send` in blue code) */
  sends: string[]
  /** true when this script ends a round itself (`game.newRound()`) */
  endsRound: boolean
}

export function gameUse(text: string): GameUse {
  const scan = scanGame(text)
  const use: GameUse = { zones: [], handles: [], sends: [], endsRound: false }
  for (const site of callSites(scan, ['onEnterArea', 'onExitArea', 'onMessage', 'send', 'newRound'])) {
    if (site.verb === 'newRound') {
      use.endsRound = true
      continue
    }
    // a send from green code is the game telling every screen — nothing has to
    // answer it, so it is not an unanswered message
    if (site.verb === 'send' && inside(scan.green, site.open)) continue
    const name = firstLiteral(scan.source, site.open, scan.consts)
    if (name === null) continue
    const into = site.verb === 'onMessage' ? use.handles : site.verb === 'send' ? use.sends : use.zones
    if (!into.includes(name)) into.push(name)
  }
  return use
}

export const RUNS_ON_GREEN = 'on the server, for everyone'
export const RUNS_ON_BLUE = 'on this player’s screen'
export const RUNS_ON_GREEN_TIP = 'This part runs on the server — it keeps going even with no players near.'
export const RUNS_ON_BLUE_TIP = 'This part runs on each player’s screen — only they see it.'
