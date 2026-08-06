// The cross-scene prefab library. A prefab is the same self-contained folder
// everywhere (data.json + composite.json + its resources); what changes is where
// it lives:
//
//   <resources>/prefabs/<name>/   builtins shipped with the app — read-only
//   <userData>/prefabs/<name>/    the user's own library — the only writable tree
//   <project>/custom/<slug>/      a scene's copy, the only one the engine loads
//
// Placing always copies into the project first, so a scene stays deployable with
// no dependency on this machine. Imports (folder, zip, GitHub) are staged in a
// scratch dir and only land in the library after the renderer confirms — they
// carry executable scripts, so the user sees the code before it is installed.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  PrefabCopyResult,
  PrefabImportInspect,
  PrefabImportOrigin,
  PrefabLibraryEntry,
  PrefabLibraryScope,
  PrefabScriptFile
} from '@dcl-editor/contract'

export interface LibraryDirs {
  user: string
  builtin: string
}

const PROJECT_PREFAB_DIR = 'custom'
const SCRIPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
// ai.md is previewed alongside the scripts: it is prose, but the in-app assistant
// is told to read it as authoritative instructions about the prefab, so it gets
// the same reviewed-before-installed look the executable files get.
const GUIDE_FILE = /(^|\/)ai\.md$/i
const SCRIPT_PREVIEW_CHARS = 8_000
const MAX_FILES = 2_000
const MAX_BYTES = 200 * 1024 * 1024
const MAX_LISTED_FILES = 400
const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'dist'])

// Every non-skipped file of the source must exist in the copy. cpSync reports
// some failures per-file rather than throwing, and a source rewritten mid-copy
// yields a silently shorter tree — either way the copy must be refused whole.
function verifyPrefabCopy(src: string, copied: string): void {
  const walk = (dir: string, rel = ''): string[] => {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const at = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) out.push(...walk(at, `${rel}${entry.name}/`))
      else out.push(`${rel}${entry.name}`)
    }
    return out
  }
  const missing = walk(src).filter((f) => !fs.existsSync(path.join(copied, f)))
  if (missing.length > 0) {
    fs.rmSync(copied, { recursive: true, force: true })
    throw new Error(`prefab copy incomplete — missing ${missing.slice(0, 3).join(', ')}`)
  }
}
const SHA_TIMEOUT_MS = 15_000
const TARBALL_TIMEOUT_MS = 120_000

// ---- names, refs, json ----

// Same slug shape the ui package writes (packages/ui/src/prefabs/format.ts), so a
// folder saved to the library and copied back keeps its name.
export function prefabSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_|_$)/g, '') || 'prefab'
  )
}

function safeSegment(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) && !name.includes('..')
}

export function parseRef(ref: string): { scope: PrefabLibraryScope; name: string } | null {
  const i = ref.indexOf(':')
  if (i < 0) return null
  const scope = ref.slice(0, i)
  const name = ref.slice(i + 1)
  if (scope !== 'user' && scope !== 'builtin') return null
  return safeSegment(name) ? { scope, name } : null
}

function refDir(dirs: LibraryDirs, ref: string): string | null {
  const parsed = parseRef(ref)
  if (parsed === null) return null
  const dir = path.join(parsed.scope === 'user' ? dirs.user : dirs.builtin, parsed.name)
  return fs.existsSync(path.join(dir, 'data.json')) ? dir : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function prefabName(data: Record<string, unknown> | null, fallback: string): string {
  return typeof data?.name === 'string' && data.name.trim() !== '' ? data.name : fallback
}

// First free "<base>", "<base>_2", "<base>_3", … under `parent`.
function freeFolder(parent: string, base: string): string {
  let name = base
  for (let n = 2; fs.existsSync(path.join(parent, name)); n++) name = `${base}_${n}`
  return path.join(parent, name)
}

function discard(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
}

function copyTree(src: string, dest: string): void {
  // Staged: a copy interrupted (or racing a source rewrite) must never leave a
  // half folder where a prefab should be — the scene then imports files that
  // are not there and the build breaks with no visible cause.
  const staging = `${dest}.copying`
  fs.rmSync(staging, { recursive: true, force: true })
  fs.cpSync(src, staging, {
    recursive: true,
    dereference: false,
    // symlinks could point anywhere outside the folder — a prefab is meant to be
    // a self-contained set of real files
    filter: (from) => {
      const base = path.basename(from)
      if (SKIP_DIRS.has(base)) return false
      try {
        return !fs.lstatSync(from).isSymbolicLink()
      } catch {
        return false
      }
    }
  })
  verifyPrefabCopy(src, staging)
  // overwriteProjectCopy's contract: files only the project's copy has (notes,
  // local tweaks) survive an update — carry them into staging before the swap.
  // scripts/runtime/ is the one exception: every file there is machine-generated
  // ("Do not edit" header), so one the new master no longer ships is a dead
  // module the update exists to remove — carrying it forward would leave old
  // machinery compiling forever next to the code that replaced it.
  for (const rel of walk(dest)) {
    const keep = path.join(staging, rel)
    if (fs.existsSync(keep)) continue
    if (rel.startsWith('scripts/runtime/')) continue
    fs.mkdirSync(path.dirname(keep), { recursive: true })
    fs.copyFileSync(path.join(dest, rel), keep)
  }
  fs.rmSync(dest, { recursive: true, force: true })
  fs.renameSync(staging, dest)
}

function walk(root: string, rel = '', out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) walk(root, child, out)
    else if (entry.isFile()) out.push(child)
    if (out.length > MAX_FILES) return out
  }
  return out
}

function treeBytes(root: string, files: string[]): number {
  let total = 0
  for (const rel of files) {
    try {
      total += fs.statSync(path.join(root, rel)).size
    } catch {
      /* vanished mid-walk */
    }
  }
  return total
}

// ---- listing ----

// Thumbnails ride along with the listing as data URLs — a couple dozen small
// PNGs once per refresh beats a per-card IPC round trip. Oversized files are
// skipped rather than shipped: a thumbnail is a preview, not an asset.
const MAX_THUMBNAIL_BYTES = 300 * 1024
function readThumbnail(file: string): string | null {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_THUMBNAIL_BYTES) return null
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

export function listLibrary(dirs: LibraryDirs): PrefabLibraryEntry[] {
  const entries: PrefabLibraryEntry[] = []
  for (const scope of ['builtin', 'user'] as const) {
    const root = scope === 'user' ? dirs.user : dirs.builtin
    let names: string[]
    try {
      names = fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && safeSegment(e.name))
        .map((e) => e.name)
    } catch {
      continue
    }
    for (const name of names.sort()) {
      const file = path.join(root, name, 'data.json')
      const data = readJson(file)
      if (data === null) continue
      // A builtin can ship with `hidden: true` while it is being reworked: the
      // folder stays in the app so scenes that already placed it keep working,
      // but the library never offers it.
      if (scope === 'builtin' && data.hidden === true) continue
      try {
        const thumbnail = readThumbnail(path.join(root, name, 'thumbnail.png'))
        entries.push({
          ref: `${scope}:${name}`,
          scope,
          data: fs.readFileSync(file, 'utf8'),
          ...(thumbnail === null ? {} : { thumbnail })
        })
      } catch {
        /* unreadable — skip rather than fail the whole listing */
      }
    }
  }
  return entries
}

// ---- project <-> library ----

// The project folder already holding this prefab id, if any — placing the same
// library prefab twice must not litter the scene with custom/door, custom/door_2.
function projectFolderForId(projectDir: string, id: unknown): string | null {
  if (typeof id !== 'string' || id === '') return null
  const root = path.join(projectDir, PROJECT_PREFAB_DIR)
  let names: string[]
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return null
  }
  for (const name of names) {
    const data = readJson(path.join(root, name, 'data.json'))
    if (data !== null && data.id === id) return `${PROJECT_PREFAB_DIR}/${name}`
  }
  return null
}

export function copyIntoProject(
  dirs: LibraryDirs,
  ref: string,
  projectDir: string
): PrefabCopyResult | null {
  const src = refDir(dirs, ref)
  if (src === null || !fs.existsSync(path.join(projectDir, 'scene.json'))) return null
  const data = readJson(path.join(src, 'data.json'))
  const name = prefabName(data, path.basename(src))

  const existing = projectFolderForId(projectDir, data?.id)
  if (existing !== null) return { folder: existing, name, reused: true }

  const parent = path.join(projectDir, PROJECT_PREFAB_DIR)
  fs.mkdirSync(parent, { recursive: true })
  const dest = freeFolder(parent, prefabSlug(name))
  copyTree(src, dest)
  return { folder: `${PROJECT_PREFAB_DIR}/${path.basename(dest)}`, name, reused: false }
}

// Overwrite the project's existing copy of `ref` (matched by data.json id) with
// the master's files, in place — the folder path must not change, placed
// instances resolve their resources through it. Files the copy added locally
// survive; files the master ships win.
export function overwriteProjectCopy(
  dirs: LibraryDirs,
  ref: string,
  projectDir: string
): string | null {
  const src = refDir(dirs, ref)
  if (src === null) return null
  const data = readJson(path.join(src, 'data.json'))
  const existing = projectFolderForId(projectDir, data?.id)
  if (existing === null) return null
  copyTree(src, path.join(projectDir, existing))
  return existing
}

// Provenance is a fact about where the prefab came from, so an imported or
// GitHub-pinned prefab keeps its origin when the user files it in their library;
// anything else becomes theirs — keeping the record's other fields (the scene
// that created it) intact.
function libraryOrigin(data: Record<string, unknown> | null): Record<string, unknown> {
  const origin = data?.origin
  if (isRecord(origin) && (origin.source === 'import' || origin.source === 'github')) return origin
  return { ...(isRecord(origin) ? origin : {}), source: 'user' }
}

// Copy a prefab tree into the user library and stamp its data.json: a library
// entry always has an id and an origin, whichever way it got here.
function installIntoLibrary(
  src: string,
  dest: string,
  data: Record<string, unknown>,
  origin: unknown
): PrefabLibraryEntry {
  copyTree(src, dest)
  const stamped = { ...data, id: typeof data.id === 'string' ? data.id : randomUUID(), origin }
  const text = `${JSON.stringify(stamped, null, 2)}\n`
  fs.writeFileSync(path.join(dest, 'data.json'), text)
  return { ref: `user:${path.basename(dest)}`, scope: 'user', data: text }
}

export function copyOutToLibrary(
  dirs: LibraryDirs,
  projectDir: string,
  folder: string
): PrefabLibraryEntry {
  const [root, name] = folder.split('/')
  if (root !== PROJECT_PREFAB_DIR || name === undefined || !safeSegment(name)) {
    throw new Error(`not a prefab folder: ${folder}`)
  }
  const src = path.join(projectDir, root, name)
  const data = readJson(path.join(src, 'data.json'))
  if (data === null) throw new Error(`${folder} has no readable data.json`)

  fs.mkdirSync(dirs.user, { recursive: true })
  const dest = freeFolder(dirs.user, prefabSlug(prefabName(data, name)))
  return installIntoLibrary(src, dest, data, libraryOrigin(data))
}

export function deleteLibraryPrefab(dirs: LibraryDirs, ref: string): boolean {
  const parsed = parseRef(ref)
  if (parsed === null || parsed.scope !== 'user') return false
  const dir = path.join(dirs.user, parsed.name)
  if (!fs.existsSync(dir)) return false
  discard(dir)
  return true
}

// ---- imports ----

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (e) => reject(new Error(`${bin} failed to spawn: ${e.message}`)))
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${stderr.trim()}`))))
  })
}

// bsdtar (macOS, Windows 10+) reads zip; GNU tar does not, so fall back to unzip.
async function extractZip(archive: string, dest: string): Promise<void> {
  try {
    await run('tar', ['-xf', archive, '-C', dest])
  } catch (e) {
    try {
      await run('unzip', ['-q', archive, '-d', dest])
    } catch {
      throw e
    }
  }
}

// The prefab root inside an extracted/copied tree: the tree itself, or the single
// subfolder that holds the prefab (what you get when a zip wraps its folder).
function locatePrefabRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, 'data.json'))) return dir
  let subdirs: string[]
  try {
    subdirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('__'))
      .map((e) => e.name)
  } catch {
    return null
  }
  const hits = subdirs.filter((name) => fs.existsSync(path.join(dir, name, 'data.json')))
  return hits.length === 1 ? path.join(dir, hits[0]) : null
}

function scriptFile(root: string, rel: string): PrefabScriptFile {
  let text = ''
  let size = 0
  try {
    size = fs.statSync(path.join(root, rel)).size
    text = fs.readFileSync(path.join(root, rel), 'utf8')
  } catch {
    text = '(unreadable)'
  }
  const truncated = text.length > SCRIPT_PREVIEW_CHARS
  return {
    path: rel,
    size,
    text: truncated ? text.slice(0, SCRIPT_PREVIEW_CHARS) : text,
    truncated,
    kind: GUIDE_FILE.test(rel) ? 'guide' : 'script'
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

// Everything the confirm step shows, plus the structural validation that decides
// whether this is a prefab at all. Component names are reported, not judged —
// only the renderer holds the component registry.
function inspectStaged(root: string, token: string, origin: PrefabImportOrigin): PrefabImportInspect {
  const data = readJson(path.join(root, 'data.json'))
  if (data === null || typeof data.name !== 'string') {
    return { ok: false, reason: 'no readable data.json — this folder is not a prefab' }
  }
  const composite = readJson(path.join(root, 'composite.json'))
  const rawComponents = composite?.components
  if (!Array.isArray(rawComponents)) {
    return { ok: false, reason: 'no readable composite.json — this folder is not a prefab' }
  }

  const components: string[] = []
  const entities = new Set<string>()
  for (const component of rawComponents) {
    if (!isRecord(component)) continue
    if (typeof component.name === 'string' && !components.includes(component.name)) {
      components.push(component.name)
    }
    if (isRecord(component.data)) for (const localId of Object.keys(component.data)) entities.add(localId)
  }
  if (entities.size === 0) return { ok: false, reason: 'the composite has no entities' }

  const files = walk(root)
  const scripts = files
    .filter((rel) => SCRIPT_EXT.test(rel) || GUIDE_FILE.test(rel))
    .map((rel) => scriptFile(root, rel))
  return {
    ok: true,
    preview: {
      token,
      name: data.name,
      origin,
      entities: entities.size,
      components,
      scripts,
      files: files.slice(0, MAX_LISTED_FILES),
      requiredPermissions: stringList(data.requiredPermissions)
    }
  }
}

interface StagedMeta {
  root: string
  origin: PrefabImportOrigin
}

function stagingDir(stagingRoot: string, token: string): string | null {
  if (!/^[A-Za-z0-9-]+$/.test(token)) return null
  const dir = path.join(stagingRoot, token)
  return fs.existsSync(dir) ? dir : null
}

function finishStaging(token: string, dir: string, origin: PrefabImportOrigin): PrefabImportInspect {
  const root = locatePrefabRoot(path.join(dir, 'content'))
  if (root === null) {
    discard(dir)
    return { ok: false, reason: 'no data.json found — pick the prefab folder itself' }
  }
  const files = walk(root)
  if (files.length > MAX_FILES || treeBytes(root, files) > MAX_BYTES) {
    discard(dir)
    return { ok: false, reason: 'that prefab is too large to import' }
  }
  const result = inspectStaged(root, token, origin)
  if (!result.ok) {
    discard(dir)
    return result
  }
  const meta: StagedMeta = { root, origin }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta))
  return result
}

export async function stageFromPath(stagingRoot: string, sourcePath: string): Promise<PrefabImportInspect> {
  const token = randomUUID()
  const dir = path.join(stagingRoot, token)
  const content = path.join(dir, 'content')
  fs.mkdirSync(content, { recursive: true })
  try {
    const stat = fs.statSync(sourcePath)
    if (stat.isDirectory()) {
      // measure before copying: the caps below would otherwise only stop a huge
      // folder AFTER duplicating it into the staging dir
      const source = walk(sourcePath)
      if (source.length > MAX_FILES || treeBytes(sourcePath, source) > MAX_BYTES) {
        discard(dir)
        return { ok: false, reason: 'that folder is too large to import' }
      }
      copyTree(sourcePath, content)
    } else if (stat.size > MAX_BYTES) {
      discard(dir)
      return { ok: false, reason: 'that archive is too large to import' }
    } else {
      await extractZip(sourcePath, content)
    }
  } catch (e) {
    discard(dir)
    return { ok: false, reason: `could not read that ${sourcePath.endsWith('.zip') ? 'zip' : 'folder'}: ${String(e)}` }
  }
  // the basename, not the full path: data.json travels with the prefab and a
  // home directory is nobody else's business
  return finishStaging(token, dir, {
    source: 'import',
    url: path.basename(sourcePath),
    importedAt: new Date().toISOString()
  })
}

// github.com/<owner>/<repo>[/tree|blob/<ref>[/<subpath>]]. A branch name with a
// slash in it is read as ref + subpath — resolve those by SHA or tag instead.
export function parseGithubPrefabUrl(
  url: string
): { owner: string; repo: string; ref: string; subpath: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com')) {
    return null
  }
  const parts = parsed.pathname.split('/').filter((p) => p !== '')
  const owner = parts[0]
  const repo = parts[1]?.replace(/\.git$/, '')
  if (owner === undefined || repo === undefined) return null
  if (parts[2] !== undefined && parts[2] !== 'tree' && parts[2] !== 'blob') return null
  return {
    owner,
    repo,
    ref: parts[3] ?? 'HEAD',
    subpath: parts.slice(4).join('/')
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number, accept?: string): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: accept !== undefined ? { Accept: accept } : undefined
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return res
}

export async function stageFromGithub(stagingRoot: string, url: string): Promise<PrefabImportInspect> {
  const target = parseGithubPrefabUrl(url)
  if (target === null) return { ok: false, reason: 'that is not a github.com repository URL' }

  const token = randomUUID()
  const dir = path.join(stagingRoot, token)
  const content = path.join(dir, 'content')
  const work = path.join(dir, 'download')
  fs.mkdirSync(content, { recursive: true })
  fs.mkdirSync(work, { recursive: true })

  let commit: string
  try {
    const shaRes = await fetchWithTimeout(
      `https://api.github.com/repos/${target.owner}/${target.repo}/commits/${target.ref}`,
      SHA_TIMEOUT_MS,
      'application/vnd.github.sha'
    )
    commit = (await shaRes.text()).trim()
    const tarRes = await fetchWithTimeout(
      `https://codeload.github.com/${target.owner}/${target.repo}/tar.gz/${commit}`,
      TARBALL_TIMEOUT_MS
    )
    const archive = path.join(work, 'repo.tar.gz')
    fs.writeFileSync(archive, Buffer.from(await tarRes.arrayBuffer()))
    const extracted = path.join(work, 'repo')
    fs.mkdirSync(extracted)
    await run('tar', ['-xzf', archive, '-C', extracted, '--strip-components', '1'])
    const from = target.subpath === '' ? extracted : path.join(extracted, target.subpath)
    if (!fs.existsSync(from)) throw new Error(`${target.subpath} is not in that repository`)
    copyTree(from, content)
  } catch (e) {
    discard(dir)
    return { ok: false, reason: `could not download that repository: ${String(e)}` }
  }
  discard(work)

  const pinned = `https://github.com/${target.owner}/${target.repo}${
    target.subpath === '' ? '' : `/tree/${commit}/${target.subpath}`
  }`
  return finishStaging(token, dir, {
    source: 'github',
    url: pinned,
    commit,
    importedAt: new Date().toISOString()
  })
}

export function commitStagedImport(
  dirs: LibraryDirs,
  stagingRoot: string,
  token: string
): PrefabLibraryEntry {
  const dir = stagingDir(stagingRoot, token)
  if (dir === null) throw new Error('that import is no longer staged — start it again')
  const meta = readJson(path.join(dir, 'meta.json'))
  const root = typeof meta?.root === 'string' ? meta.root : null
  if (root === null || !root.startsWith(dir) || !fs.existsSync(root)) {
    throw new Error('that import is no longer staged — start it again')
  }
  const data = readJson(path.join(root, 'data.json'))
  if (data === null) throw new Error('the staged prefab lost its data.json')

  fs.mkdirSync(dirs.user, { recursive: true })
  const dest = freeFolder(dirs.user, prefabSlug(prefabName(data, 'prefab')))
  const entry = installIntoLibrary(root, dest, data, meta?.origin ?? { source: 'import' })
  discard(dir)
  return entry
}

export function cancelStagedImport(stagingRoot: string, token: string): void {
  const dir = stagingDir(stagingRoot, token)
  if (dir !== null) discard(dir)
}

// Staged imports are scratch: anything left by a crash (or a dialog the user
// never answered) is dead weight, so the tree starts empty each launch.
export function resetStaging(stagingRoot: string): void {
  discard(stagingRoot)
  fs.mkdirSync(stagingRoot, { recursive: true })
}
