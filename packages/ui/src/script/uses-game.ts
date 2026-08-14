// Does this scene have a game in it? Read off the scripts' own text, the same
// way runs-on.ts reads where a script runs: nothing declares a game scene, the
// import does.
//
// The Game strip hangs its EXISTENCE on this answer. It used to hang it on a
// line the played scene prints, which never arrives in the editor's Play (the
// runtime gates that line on a preview realm) — so a scene that has a game
// looked exactly like a scene that has none, and the strip never appeared.
//
// Same discipline as runs-on.ts: comments are blanked and an import written
// inside a string is skipped (script-source.ts), so prose never mints a game
// scene. A type-only import is skipped too — it vanishes at build time and no
// game runs because of it.
import { scanScriptSource } from '../prefabs/script-source'

const GAME_MODULE = /(^|\/)game$/
const IMPORT = /import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g

/** True when this one script imports the game module for real. */
export function scriptUsesGame(text: string): boolean {
  const source = scanScriptSource(text)
  for (const m of source.code.matchAll(IMPORT)) {
    if (source.inString[m.index ?? 0] === 1) continue
    if (m[1].trim().startsWith('type ')) continue
    if (GAME_MODULE.test(m[2])) return true
  }
  return false
}

/**
 * True when a script the scene actually runs uses the game.
 *
 * `attached` is the paths of the scripts placed on entities (sceneScriptRows),
 * not every script the project holds: a game script sitting unused in src/ makes
 * no game, and reading the whole project raised the strip over scenes that have
 * nothing to do with one. `scripts` is `consumerStore.scripts`, so a path whose
 * text has not been read yet simply doesn't count yet — the strip appears when
 * the store catches up, the same staleness the store has always had.
 */
export function usesGame(scripts: Record<string, string>, attached: Iterable<string>): boolean {
  for (const path of attached) {
    const text = scripts[path]
    if (text !== undefined && scriptUsesGame(text)) return true
  }
  return false
}
