// Keep packages/desktop/runtime-modules/ and the prefabs that use it in step.
//
// A prefab no longer carries a copy of the runtime: its scripts import
// `~runtime/<module>`, and the editor rewrites that to the project's single
// src/scripts/runtime/ when the prefab is placed. What still has to be kept true in
// this repo is metadata, and this script owns both halves of it:
//
//   1. `minRuntime` in each prefab's data.json — RUNTIME_VERSION for every prefab
//      with a non-empty runtime closure, absent for every prefab without one. A
//      hand-maintained minimum is a hand-maintained lie, so it is derived here from
//      the imports the prefab's scripts actually write.
//   2. runtime-digest.json — a SHA-256 over every master but version.ts. Recording a
//      moved digest under an unchanged RUNTIME_VERSION is refused, so editing a
//      master keeps `npm test` red until version.ts is bumped too.
//
// Usage:
//   node scripts/sync-runtime-modules.mjs           write the changes
//   node scripts/sync-runtime-modules.mjs --check   print what would change, exit 1
import fs from 'node:fs'
import path from 'node:path'
import posix from 'node:path/posix'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// What a prefab script writes. The editor rewrites it to a relative path into the
// project's src/scripts/runtime/ at placement, so the depth a prefab folder sits at
// is never written down anywhere.
const RUNTIME_ALIAS = '~runtime/'
const VERSION_FILE = 'version.ts'

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

// One hash over the whole module set. `files` is [rel, text] pairs; the path and the
// text length go in beside the body so a rename or a moved boundary shows up too.
export function digestOf(files) {
  const hash = createHash('sha256')
  for (const [rel, text] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    hash.update(`${rel} ${text.length} ${text} `)
  }
  return hash.digest('hex')
}

export function parseRuntimeVersion(text) {
  const found = /RUNTIME_VERSION\s*=\s*'([^']+)'/.exec(text)
  if (found === null) throw new Error(`${VERSION_FILE}: no RUNTIME_VERSION literal to read`)
  return found[1]
}

// What runtime-digest.json should hold, or null when it already agrees. Throws when
// the masters moved under an unchanged version: that is the whole point of the file.
export function digestUpdate(digest, recorded, version) {
  if (recorded !== null && recorded.digest === digest && recorded.runtimeVersion === version) return null
  if (recorded !== null && recorded.digest !== digest && recorded.runtimeVersion === version) {
    throw new Error(
      `a runtime module changed but RUNTIME_VERSION is still ${version} — bump it in packages/desktop/runtime-modules/version.ts, then re-run`
    )
  }
  return { runtimeVersion: version, digest }
}

// `closures` is every prefab folder → the runtime modules it pulls in (possibly none);
// `current` is every prefab folder → the minRuntime its data.json declares today.
export function stampActions(closures, current, version) {
  const actions = []
  for (const [folder, modules] of closures) {
    const want = modules.length > 0 ? version : undefined
    const have = current.get(folder)
    if (have !== want) actions.push({ folder, from: have, to: want })
  }
  return actions
}

// minRuntime reads next to the prefab's own version, so it is written there rather
// than appended wherever the parse happened to leave it.
export function setMinRuntime(data, version) {
  const out = {}
  for (const [key, value] of Object.entries(data)) {
    if (key === 'minRuntime') continue
    if (key === 'version' && version !== undefined) out.minRuntime = version
    out[key] = value
  }
  if (version !== undefined && out.minRuntime === undefined) out.minRuntime = version
  return out
}

// --- fs driver ---

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mastersDir = path.join(root, 'packages/desktop/runtime-modules')
const prefabsDir = path.join(root, 'packages/desktop/prefabs')
const digestFile = path.join(mastersDir, 'runtime-digest.json')

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

// Every master the digest covers: the code, never version.ts (which records the
// digest's own version) and never the README (which is prose about it).
export function digestInputs() {
  return listFiles(mastersDir)
    .filter((rel) => rel.endsWith('.ts') && rel !== VERSION_FILE)
    .map((rel) => [rel, fs.readFileSync(path.join(mastersDir, rel), 'utf8')])
}

export function runtimeVersion() {
  return parseRuntimeVersion(fs.readFileSync(path.join(mastersDir, VERSION_FILE), 'utf8'))
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

function currentMinRuntimes() {
  const current = new Map()
  for (const folder of prefabFolders()) {
    const data = JSON.parse(fs.readFileSync(path.join(prefabsDir, folder, 'data.json'), 'utf8'))
    current.set(folder, data.minRuntime)
  }
  return current
}

function readRecordedDigest() {
  if (!fs.existsSync(digestFile)) return null
  return JSON.parse(fs.readFileSync(digestFile, 'utf8'))
}

function apply(stamps, digest) {
  for (const action of stamps) {
    const file = path.join(prefabsDir, action.folder, 'data.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, `${JSON.stringify(setMinRuntime(data, action.to), null, 2)}\n`)
  }
  if (digest !== null) fs.writeFileSync(digestFile, `${JSON.stringify(digest, null, 2)}\n`)
}

function main() {
  const check = process.argv.includes('--check')
  let stamps
  let digest
  try {
    const version = runtimeVersion()
    stamps = stampActions(plan(), currentMinRuntimes(), version)
    digest = digestUpdate(digestOf(digestInputs()), readRecordedDigest(), version)
  } catch (error) {
    console.error(`sync-runtime-modules: ${error.message}`)
    process.exit(1)
  }
  const count = stamps.length + (digest === null ? 0 : 1)
  if (count === 0) {
    console.log('sync-runtime-modules: every minRuntime and the runtime digest are in step')
    return
  }
  for (const action of stamps) {
    console.log(`  ~ prefabs/${action.folder}/data.json  minRuntime ${action.from ?? '(none)'} → ${action.to ?? '(none)'}`)
  }
  if (digest !== null) {
    console.log(`  ~ runtime-modules/runtime-digest.json  ${digest.runtimeVersion} ${digest.digest.slice(0, 12)}…`)
  }
  if (check) {
    console.error(
      `sync-runtime-modules: ${count} file${count === 1 ? ' is' : 's are'} out of date — run \`node scripts/sync-runtime-modules.mjs\``
    )
    process.exit(1)
  }
  apply(stamps, digest)
  console.log(`sync-runtime-modules: wrote ${count} file${count === 1 ? '' : 's'}`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
