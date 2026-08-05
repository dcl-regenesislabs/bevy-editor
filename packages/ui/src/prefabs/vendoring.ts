// Installing operations carry modules. Dropping a prefab and turning Spawnable
// on both copy the `runtime/` modules the scripts import into the scene, because
// nothing in a creator's project resolves back to this repo — a placed prefab is
// a folder, and the generated registry is a file in `src/scripts/`.
//
// This is the renderer-side twin of `scripts/sync-runtime-modules.mjs`. The
// duplication is deliberate: that one walks the repo over `fs` at build time,
// this one walks a creator's project over the data layer at authoring time, and
// giving them one home would drag node's `fs` into the browser bundle. They agree
// on the one thing that matters — which specifiers count as runtime imports.

const RUNTIME_DIR = 'runtime'

// Drop comments so an example import inside a doc header — prefab scripts
// document their own usage that way — is never mistaken for a real dependency.
// String literals survive, since specifiers live in them.
export function stripComments(text: string): string {
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
    if (c === '`' || c === "'" || c === '"') {
      out += c
      i++
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') {
          out += text[i]
          i++
        }
        out += text[i] ?? ''
        i++
      }
      out += c
      i++
      continue
    }
    out += c
    i++
  }
  return out
}

// A fresh regex per call: `lastIndex` is per-object state, and one shared /g
// literal between matchAll and replace is a classic silent-skip bug.
function specifierPattern(): RegExp {
  return /\b(from|import)\s*(['"])([^'"\n]+)\2/g
}

// Every static module specifier in `text`. Dynamic import() is banned repo-wide
// and deliberately unmatched — a runtime module reached that way would not be
// carried, and would 404 inside the creator's scene rather than here.
export function importSpecifiers(text: string): string[] {
  const specs: string[] = []
  for (const m of stripComments(text).matchAll(specifierPattern())) specs.push(m[3])
  return specs
}

function normalize(path: string): string {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0 || out[out.length - 1] === '..') out.push('..')
      else out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

function withTs(rel: string): string {
  return /\.tsx?$/.test(rel) ? rel : `${rel}.ts`
}

// The part of a `./runtime/…` specifier that names the module inside runtime/,
// or null when the specifier is not a runtime import. `./runtime/pure/rng` and a
// nested script's `../runtime/pure/rng` both yield `pure/rng.ts`.
export function runtimeModuleOf(spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const i = spec.lastIndexOf(`${RUNTIME_DIR}/`)
  if (i < 0) return null
  const before = spec.slice(0, i)
  if (!/^(\.\.?\/)+$/.test(before)) return null
  const inner = normalize(spec.slice(i + RUNTIME_DIR.length + 1))
  return inner === '' ? null : withTs(inner)
}

/** The runtime modules a script imports directly, as paths inside `runtime/`. */
export function runtimeImportsOf(text: string): string[] {
  const found: string[] = []
  for (const spec of importSpecifiers(text)) {
    const rel = runtimeModuleOf(spec)
    if (rel !== null && !found.includes(rel)) found.push(rel)
  }
  return found
}

function resolveSibling(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : ''
  const joined = normalize(dir === '' ? spec : `${dir}/${spec}`)
  if (joined === '' || joined.startsWith('..')) return null
  return withTs(joined)
}

// Every module an entry script pulls in, transitively, as paths inside runtime/.
// `read(rel)` returns a master's text or null; a missing master throws, because
// carrying an incomplete set produces a scene that fails to build with an error
// pointing at generated code the creator never wrote.
export function transitiveModules(entryText: string, read: (rel: string) => string | null): string[] {
  const seen = new Set<string>()
  const queue = runtimeImportsOf(entryText)
  while (queue.length > 0) {
    const rel = queue.shift() as string
    if (seen.has(rel)) continue
    const text = read(rel)
    if (text === null) throw new Error(`no master for runtime module '${rel}'`)
    seen.add(rel)
    for (const spec of importSpecifiers(text)) {
      const dep = resolveSibling(rel, spec)
      if (dep !== null && !seen.has(dep)) queue.push(dep)
    }
  }
  return [...seen].sort()
}

// A captured script moves into the prefab folder, where its modules sit in a
// `runtime/` directory next to it. Re-express every runtime specifier against
// that copy — `../runtime/rpc` from a nested source becomes `./runtime/rpc`, and
// an already-correct specifier is left byte-identical.
export function rewriteRuntimeImports(text: string, fromDir: string, toDir: string): string {
  const from = normalize(fromDir)
  const to = normalize(toDir)
  return text.replace(specifierPattern(), (match, keyword: string, quote: string, spec: string) => {
    const rel = runtimeModuleOf(spec)
    if (rel === null) return match
    const resolved = withTs(normalize(`${from}/${spec}`))
    if (resolved === `${to}/${RUNTIME_DIR}/${rel}`) return match
    const kept = /\.tsx?$/.test(spec) ? rel : rel.replace(/\.ts$/, '')
    return `${keyword} ${quote}./${RUNTIME_DIR}/${kept}${quote}`
  })
}

// Relative imports that break when a script is copied into a prefab folder.
// Only `runtime/` modules travel (rewriteRuntimeImports re-points those), so a
// `./game-config` or `../../custom/other/scripts/runtime/x` resolves somewhere
// that does not exist once the copy sits in the folder — a build failure in a
// file the creator never wrote. A specifier that walks up to the same project
// path from both directories still resolves and is not reported.
export function strandedImports(text: string, fromDir: string, toDir: string): string[] {
  const from = normalize(fromDir)
  const to = normalize(toDir)
  const stranded: string[] = []
  for (const spec of importSpecifiers(text)) {
    if (!spec.startsWith('.') || runtimeModuleOf(spec) !== null) continue
    if (normalize(`${from}/${spec}`) === normalize(`${to}/${spec}`)) continue
    if (!stranded.includes(spec)) stranded.push(spec)
  }
  return stranded
}

// The `globalThis` keys the carried modules define, for a stub guide's
// `claims-globals:` front-matter. Only this repo's versioned-key convention
// (`__dclSpawner_v1`, `__dclZoneBus_v1`) is claimed — `__DCL_SCRIPT_INSTANCES__`
// belongs to the SDK's script runner and claiming it would be a lie.
export function claimedGlobals(moduleTexts: string[]): string[] {
  const keys = new Set<string>()
  for (const text of moduleTexts) {
    const code = stripComments(text)
    for (const m of code.matchAll(/globalThis\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*'([^']+)'\s*\])/g)) {
      const key = m[1] ?? m[2]
      if (/^__dcl[A-Za-z0-9_]*$/.test(key)) keys.add(key)
    }
  }
  return [...keys].sort()
}
