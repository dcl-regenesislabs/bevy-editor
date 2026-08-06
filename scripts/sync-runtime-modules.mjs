// Materialise every prefab's carried copy of packages/desktop/runtime-modules/*.
//
// A built-in prefab that uses a runtime module imports it as `./runtime/<name>`
// and ships a byte-identical copy inside its own folder, because a placed prefab
// is a folder the scene copies — nothing resolves back to this repo at runtime.
// Copies drifting from their master is the failure this repo's three source games
// shipped, so the copies are generated, never hand-edited: this script is the only
// producer, and `packages/ui/src/prefabs/builtin.test.ts` fails the build if a copy
// differs from its master.
//
// Usage:
//   node scripts/sync-runtime-modules.mjs           write the copies
//   node scripts/sync-runtime-modules.mjs --check   print what would change, exit 1
import fs from 'node:fs'
import path from 'node:path'
import posix from 'node:path/posix'
import { fileURLToPath } from 'node:url'

const RUNTIME_DIR = 'runtime'

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
  if (joined.startsWith('..')) throw new Error(`${fromRel}: '${spec}' escapes the prefab folder`)
  return withTs(joined)
}

// The runtime modules a prefab script depends on directly, as paths relative to the
// prefab's scripts/runtime/ directory. `fileRel` is the script's path relative to
// scripts/, so a nested script's `../runtime/x` resolves the same as a top-level
// script's `./runtime/x`.
export function runtimeImportsOf(text, fileRel) {
  const found = []
  for (const spec of importSpecifiers(text)) {
    const rel = resolveSpecifier(fileRel, spec)
    if (rel === null) continue
    if (rel === `${RUNTIME_DIR}.ts` || !rel.startsWith(`${RUNTIME_DIR}/`)) continue
    const inner = rel.slice(RUNTIME_DIR.length + 1)
    if (!found.includes(inner)) found.push(inner)
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

// { prefab folder → sorted rel paths of the runtime modules it must carry }
function plan() {
  const byPrefab = new Map()
  for (const folder of fs.readdirSync(prefabsDir).sort()) {
    const scriptsDir = path.join(prefabsDir, folder, 'scripts')
    if (!fs.existsSync(scriptsDir) || !fs.statSync(scriptsDir).isDirectory()) continue
    const entries = []
    for (const rel of listFiles(scriptsDir)) {
      if (rel === `${RUNTIME_DIR}` || rel.startsWith(`${RUNTIME_DIR}/`)) continue
      if (!/\.tsx?$/.test(rel)) continue
      const text = fs.readFileSync(path.join(scriptsDir, rel), 'utf8')
      for (const dep of runtimeImportsOf(text, rel)) if (!entries.includes(dep)) entries.push(dep)
    }
    const carried = listFiles(path.join(scriptsDir, RUNTIME_DIR))
    if (entries.length === 0 && carried.length === 0) continue
    byPrefab.set(folder, transitiveModules(entries, readMaster))
  }
  return byPrefab
}

function firstDifference(a, b) {
  const left = a.split('\n')
  const right = b.split('\n')
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return `line ${i + 1}\n      master: ${left[i] ?? '<eof>'}\n      copy:   ${right[i] ?? '<eof>'}`
    }
  }
  return 'no line differs (trailing bytes)'
}

// What would change on disk, as a list of { kind, folder, rel, detail } actions.
function diff(byPrefab) {
  const actions = []
  for (const [folder, wanted] of byPrefab) {
    const dir = path.join(prefabsDir, folder, 'scripts', RUNTIME_DIR)
    const carried = listFiles(dir)
    for (const rel of wanted) {
      const target = path.join(dir, rel)
      const master = readMaster(rel)
      if (!fs.existsSync(target)) {
        actions.push({ kind: 'add', folder, rel })
        continue
      }
      const current = fs.readFileSync(target, 'utf8')
      if (current !== master) actions.push({ kind: 'update', folder, rel, detail: firstDifference(master, current) })
    }
    for (const rel of carried) {
      if (!wanted.includes(rel)) actions.push({ kind: 'remove', folder, rel })
    }
  }
  return actions
}

function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) pruneEmptyDirs(p)
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

function apply(actions) {
  for (const action of actions) {
    const dir = path.join(prefabsDir, action.folder, 'scripts', RUNTIME_DIR)
    const target = path.join(dir, action.rel)
    if (action.kind === 'remove') {
      fs.rmSync(target, { force: true })
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, readMaster(action.rel))
  }
  for (const folder of new Set(actions.map((a) => a.folder))) {
    pruneEmptyDirs(path.join(prefabsDir, folder, 'scripts', RUNTIME_DIR))
  }
}

function main() {
  const check = process.argv.includes('--check')
  let actions
  try {
    actions = diff(plan())
  } catch (error) {
    console.error(`sync-runtime-modules: ${error.message}`)
    process.exit(1)
  }
  if (actions.length === 0) {
    console.log('sync-runtime-modules: every carried copy is in sync')
    return
  }
  const sign = { add: '+', update: '~', remove: '-' }
  for (const action of actions) {
    console.log(`  ${sign[action.kind]} ${action.folder}/scripts/${RUNTIME_DIR}/${action.rel}`)
    if (action.detail !== undefined) console.log(`      ${action.detail}`)
  }
  if (check) {
    console.error(
      `sync-runtime-modules: ${actions.length} carried cop${actions.length === 1 ? 'y is' : 'ies are'} out of date — run \`node scripts/sync-runtime-modules.mjs\``
    )
    process.exit(1)
  }
  apply(actions)
  console.log(`sync-runtime-modules: synced ${actions.length} file${actions.length === 1 ? '' : 's'}`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
