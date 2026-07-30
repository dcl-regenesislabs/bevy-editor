// Guard rails for editing a scene's entry point.
//
// src/index.ts is the one file whose corruption breaks the whole scene: the SDK
// runtime imports it and calls main(). A script with a syntax error only breaks
// its own entity; a broken index.ts means nothing loads at all, and the editor
// rebuilds + restarts on every save — so a bad save is live immediately.
//
// Two levels, deliberately different:
//  - syntaxError  → HARD block. The file cannot parse, so it cannot possibly run.
//    Refusing costs the creator nothing; the buffer stays open and editable.
//  - missingMain  → WARNING only. `main` has several legal shapes and scenes in
//    the wild use all of them; blocking on a heuristic would lock someone out of
//    their own file with no way back. Say something, save anyway.
import { parse } from '@babel/parser'
import { ENTRY_FILE } from './project-files'

// ENTRY_FILE is the one the editor opens; .tsx is equally legal for a scene that
// renders SDK7 UI from its entry point.
export const ENTRY_POINTS = [ENTRY_FILE, 'src/index.tsx']

export function isEntryPoint(path: string | null): boolean {
  if (path === null) return false
  const p = path.replace(/^\.\//, '')
  return ENTRY_POINTS.includes(p)
}

/** The parse error a creator should see, or null when the file parses. */
export function syntaxError(source: string): string | null {
  try {
    parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy', 'classProperties']
    })
    return null
  } catch (e) {
    const err = e as { message?: string; loc?: { line?: number } }
    const line = err.loc?.line
    const raw = (err.message ?? 'could not be parsed').replace(/\s*\(\d+:\d+\)\s*$/, '')
    return line === undefined ? raw : `${raw} (line ${line})`
  }
}

// Every shape the SDK accepts as an entry point. Checked textually on purpose:
// this only drives a warning, so a false negative must stay cheap.
const MAIN_FORMS = [
  /\bexport\s+function\s+main\b/,
  /\bexport\s+async\s+function\s+main\b/,
  /\bexport\s+const\s+main\s*[:=]/,
  /\bexport\s+let\s+main\s*[:=]/,
  /\bexport\s*\{[^}]*\bmain\b[^}]*\}/
]

/** True when nothing that looks like an exported `main` survives the edit. */
export function missingMain(source: string): boolean {
  return !MAIN_FORMS.some((re) => re.test(source))
}

export interface GateResult {
  /** refuse the save outright */
  block: string | null
  /** save, but tell them */
  warn: string | null
}

export function checkEntryPoint(source: string): GateResult {
  const err = syntaxError(source)
  if (err !== null) return { block: `Not saved — ${err}`, warn: null }
  if (missingMain(source)) return { block: null, warn: 'Saved, but no exported main() found — the scene may not start.' }
  return { block: null, warn: null }
}
