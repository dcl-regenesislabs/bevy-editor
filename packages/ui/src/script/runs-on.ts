// Where a script's code runs, derived from its own text — the behavior card's
// runs-on line. Never declared: no metadata says a script is green, the call
// sites do, and the same scan answers for a hand-typed file and for one the
// assistant wrote.
//
// The fork is which callback you write, so the table below IS the answer: every
// entry is a call the game module documents as running in the game (green) or on
// this player's screen (blue). `game.onMessage` counts as green — its screen-side
// direction (a screen hearing the game) belongs to the broadcast half the v1
// facade ships plain, and the ask/decide shape is what the template teaches and
// what every kit script writes.
//
// Same discipline as guarantees.ts: comments and string CONTENTS are masked
// before matching (script-source.ts), so a call written inside a doc block never
// puts a name on the line, and the scan only runs on a script that really
// imports the module.
import { scanScriptSource, type ScriptSource } from '../prefabs/script-source'

export interface RunsOn {
  /** labels of the parts that run in the game, for everyone */
  green: string[]
  /** labels of the parts that run on this player's screen */
  blue: string[]
}

const GAME_MODULE = /(^|\/)game$/

/** How one call site turns into a label; `null` when the call names nothing. */
type Label = (arg: string | null) => string | null

const GREEN: Record<string, Label> = {
  onMessage: (name) => name,
  onEnterZone: (zone) => (zone === null ? null : `enter ${zone}`),
  onExitZone: (zone) => (zone === null ? null : `leave ${zone}`),
  onStart: () => 'start',
  onRoundStart: () => 'round start',
  onPlayerJoin: () => 'a player arrives',
  onPlayerLeave: () => 'a player leaves',
  every: (seconds) => (seconds === null ? 'a timer' : `every ${seconds}s`)
}

const BLUE: Record<string, Label> = {
  onStateChange: () => 'shared facts change',
  layout: (prefab) => (prefab === null ? null : `${prefab} layout`)
}

// The module's two exports a script calls directly. `onClick` is blue by
// construction — pointer state exists only on the screen that owns the cursor.
const BLUE_FREE: Record<string, string> = { onClick: 'clicks' }

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

// The call's first argument, when it is a plain literal — a name, a zone, a
// prefab, a number. Anything computed has no label a creator would recognise, so
// it contributes nothing rather than a guess.
function firstLiteral(source: ScriptSource, open: number): string | null {
  const rest = source.code.slice(open + 1, open + 80)
  const text = /^\s*['"]([^'"]*)['"]\s*[,)]/.exec(rest)
  if (text !== null) return text[1].trim() === '' ? null : text[1]
  const num = /^\s*(\d+(?:\.\d+)?)\s*[,)]/.exec(rest)
  return num === null ? null : num[1]
}

function collect(source: ScriptSource, pattern: RegExp, labels: Record<string, Label>, out: string[]): void {
  for (const m of source.code.matchAll(pattern)) {
    const open = (m.index ?? 0) + m[0].length - 1
    if (source.inString[open] === 1) continue // an example call inside a doc string
    const label = labels[m[1]]?.(firstLiteral(source, open))
    if (label !== null && label !== undefined && !out.includes(label)) out.push(label)
  }
}

/** What one script's text says about where its code runs. */
export function runsOn(text: string): RunsOn {
  const source = scanScriptSource(text)
  const bindings = gameBindings(source.code)
  const green: string[] = []
  const blue: string[] = []
  if (bindings.game !== null) {
    const calls = (labels: Record<string, Label>): RegExp =>
      new RegExp(`(?:^|[^\\w$.])${bindings.game}\\s*\\.\\s*(${Object.keys(labels).join('|')})\\s*\\(`, 'g')
    collect(source, calls(GREEN), GREEN, green)
    collect(source, calls(BLUE), BLUE, blue)
  }
  for (const [local, imported] of bindings.free) {
    const pattern = new RegExp(`(?:^|[^\\w$.])(${local})\\s*\\(`, 'g')
    collect(source, pattern, { [local]: () => BLUE_FREE[imported] }, blue)
  }
  return { green, blue }
}

export const RUNS_ON_GREEN = 'in the game, for everyone'
export const RUNS_ON_BLUE = 'on this player’s screen'
export const RUNS_ON_GREEN_TIP = 'This part runs in the game — it keeps going even with no players near.'
export const RUNS_ON_BLUE_TIP = 'This part runs on each player’s screen — only they see it.'
