// Which runtime modules the built-in prefabs actually pull in.
//
// A prefab no longer carries a copy of the runtime: its scripts import
// `~runtime/<module>`, and the editor rewrites that to the project's single
// src/scripts/runtime/ when the prefab is placed. This module is the node-side
// resolver for that alias — the closure walk, and `plan()` over the real repo.
//
// It has no CLI. Its callers are sync-runtime-modules.test.mjs (which asserts
// which prefabs use the runtime, and fails when a specifier names a master that
// does not exist) and the two probes under packages/desktop/validate/.
import fs from 'node:fs'
import path from 'node:path'
import posix from 'node:path/posix'
import { fileURLToPath } from 'node:url'

// What a prefab script writes. The editor rewrites it to a relative path into the
// project's src/scripts/runtime/ at placement, so the depth a prefab folder sits at
// is never written down anywhere.
const RUNTIME_ALIAS = '~runtime/'

// --- pure core (unit-tested in sync-runtime-modules.test.mjs) ---

// Drop comments so an example import inside a doc header — prefab scripts document
// their own usage that way — is never mistaken for a real dependency. String literals
// survive, since specifiers live in them. Heuristic, not a parser: a regex literal
// containing an unbalanced quote would confuse it, so runtime modules avoid those.
export function stripCommentsAndStrings(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '`') {
      out += c
      i++
      while (i < text.length && text[i] !== '`') {
        if (text[i] === '\\') i++
        i++
      }
      out += '`'
      i++
      continue
    }
    if (c === "'" || c === '"') {
      out += c
      i++
      let body = ''
      while (i < text.length && text[i] !== c && text[i] !== '\n') {
        if (text[i] === '\\') {
          body += text[i]
          i++
        }
        body += text[i] ?? ''
        i++
      }
      out += body + c
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

// Every static module specifier in `text`: `from '…'`, bare `import '…'`, and the
// `export … from '…'` re-export form. Dynamic import() is banned repo-wide and is
// deliberately not matched — a runtime module reached that way would not be found.
export function importSpecifiers(text) {
  const code = stripCommentsAndStrings(text)
  const specs = []
  for (const m of code.matchAll(/\bfrom\s*['"]([^'"\n]+)['"]/g)) specs.push(m[1])
  for (const m of code.matchAll(/\bimport\s*['"]([^'"\n]+)['"]/g)) specs.push(m[1])
  return specs
}

function withTs(rel) {
  return rel.endsWith('.ts') ? rel : `${rel}.ts`
}

// Resolve `spec` (relative to `fromRel`, itself a path relative to some root) and
// return the normalised root-relative module path, or null when the specifier is a
// bare package name. Throws when it escapes the root.
export function resolveSpecifier(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  const joined = posix.normalize(posix.join(posix.dirname(fromRel), spec))
  if (joined.startsWith('..')) throw new Error(`${fromRel}: '${spec}' escapes the runtime-modules folder`)
  return withTs(joined)
}

// The runtime modules a prefab script asks for by name, as paths relative to the
// masters directory. The alias makes this independent of where the script sits.
export function runtimeImportsOf(text) {
  const found = []
  for (const spec of importSpecifiers(text)) {
    if (!spec.startsWith(RUNTIME_ALIAS) || spec.length === RUNTIME_ALIAS.length) continue
    const rel = withTs(spec.slice(RUNTIME_ALIAS.length))
    if (!found.includes(rel)) found.push(rel)
  }
  return found
}

// Every master a set of entry modules pulls in, transitively. `read(rel)` returns a
// master's text or null; a missing master is fatal — a prefab importing a module that
// does not exist would only fail later, inside a creator's scene.
export function transitiveModules(entries, read) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    const text = read(rel)
    if (text === null || text === undefined) {
      throw new Error(`no master for runtime module '${rel}' in packages/desktop/runtime-modules/`)
    }
    seen.add(rel)
    for (const spec of importSpecifiers(text)) {
      const dep = resolveSpecifier(rel, spec)
      if (dep !== null && !seen.has(dep)) queue.push(dep)
    }
  }
  return [...seen].sort()
}

// --- fs driver ---

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mastersDir = path.join(root, 'packages/desktop/runtime-modules')
const prefabsDir = path.join(root, 'packages/desktop/prefabs')

function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) listFiles(p, base, out)
    else out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out
}

// First line of every master. The editor's in-scene refresh only overwrites
// copies carrying it, so a master shipped without one could never be fixed in
// creators' scenes again — fail the sync rather than let that happen.
const MODULE_MARKER = 'Generated by Decentraland Studio.'

function readMaster(rel) {
  const p = path.join(mastersDir, rel)
  if (!fs.existsSync(p)) return null
  const text = fs.readFileSync(p, 'utf8')
  if (!text.split('\n', 1)[0].includes(MODULE_MARKER)) {
    throw new Error(
      `master ${rel} is missing the "${MODULE_MARKER}" first line — the editor refresh would never update its copies`
    )
  }
  return text
}

function prefabFolders() {
  return fs.readdirSync(prefabsDir).sort().filter((folder) => fs.existsSync(path.join(prefabsDir, folder, 'data.json')))
}

// { prefab folder → sorted rel paths of the runtime modules it pulls in }
export function plan() {
  const byPrefab = new Map()
  for (const folder of prefabFolders()) {
    const scriptsDir = path.join(prefabsDir, folder, 'scripts')
    const entries = []
    for (const rel of listFiles(scriptsDir)) {
      if (!/\.tsx?$/.test(rel)) continue
      const text = fs.readFileSync(path.join(scriptsDir, rel), 'utf8')
      for (const dep of runtimeImportsOf(text)) if (!entries.includes(dep)) entries.push(dep)
    }
    byPrefab.set(folder, transitiveModules(entries, readMaster))
  }
  return byPrefab
}
