// What the Studio's file rail shows, and what it lets you open.
//
// The rail lists the whole project so a creator can see what their scene
// actually is — scene.json and package.json sitting there is how you learn the
// shape of a project. But only TypeScript opens: the editor is wired to TS (its
// linter, autocomplete and hover all come from the ts environment) and it
// rebuilds + restarts the scene on every save, so opening scene.json there
// would produce a wall of false errors and race the Scene Settings dialog,
// which owns that file.

/** Directories never worth showing. The server already drops .git/node_modules. */
export const IGNORED_DIRS = ['bin', 'vendor', 'dist', 'cache']

/** The scene's entry point — what the topbar's Code button opens by default. */
export const ENTRY_FILE = 'src/index.ts'

const EDITABLE = ['.ts', '.tsx']
const IMAGE = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif']
const MODEL = ['.glb', '.gltf']
// Formats that are definitely not text. Everything NOT listed here falls through
// to a text preview — a project is full of one-off config files (.config,
// .toml, .lock, Dockerfile, extensionless) and listing every readable extension
// is a losing game. FilePreview sniffs the bytes before rendering, so a wrong
// guess here shows "binary file", never a screen of mojibake.
const BINARY = [
  '.wasm', '.zip', '.gz', '.tar', '.7z', '.rar',
  '.mp3', '.ogg', '.wav', '.m4a', '.flac',
  '.mp4', '.webm', '.mov', '.avi',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.pdf', '.bin', '.dat', '.exe', '.dll', '.dylib', '.so',
  '.ico', '.icns', '.psd', '.blend', '.fbx', '.obj'
]

export type FileKind = 'code' | 'text' | 'image' | 'model' | 'binary'

function has(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase()
  return exts.some((ext) => lower.endsWith(ext))
}

export function fileKind(path: string): FileKind {
  if (has(path, EDITABLE)) return 'code'
  if (has(path, IMAGE)) return 'image'
  if (has(path, MODEL)) return 'model'
  if (has(path, BINARY)) return 'binary'
  return 'text'
}

/** Bigger than this and we don't try — the preview is a look, not an editor. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

/**
 * Does this look like binary content? A NUL byte in the first few KB is the
 * classic test (git uses it) — no text encoding produces one, every compiled
 * format does.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 8000)
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true
  return false
}

export function isEditable(path: string): boolean {
  return fileKind(path) === 'code'
}

// Everything we can put on screen. Only `code` is editable — the rest open
// read-only, which sidesteps the reason they were excluded before: saving a
// .json would restart the scene and race the Scene Settings dialog that owns it.
export function isViewable(path: string): boolean {
  const kind = fileKind(path)
  return kind === 'code' || kind === 'text' || kind === 'image'
}

export function mimeFor(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  const ext = lower.slice(lower.lastIndexOf('.') + 1)
  return `image/${ext}`
}

export function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

// Tooling directories (.claude, .agents, .github, .editor, .vscode…) are not
// scene content. Enumerating them is a losing game — every tool adds one — so
// any dot-segment is hidden.
export function isHidden(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.') || IGNORED_DIRS.includes(seg))
}

// Score a path against a quick-open query: null = no match, higher = better.
// Filename hits beat path hits beat scattered subsequences, so "index" surfaces
// src/index.ts before assets/index-map.json before some i…n…d…e…x scatter.
function quickOpenScore(path: string, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const p = path.toLowerCase()
  const name = baseName(p)
  let score: number
  if (name.startsWith(q)) score = 100
  else if (name.includes(q)) score = 80
  else if (p.includes(q)) score = 60
  else {
    let i = 0
    for (const ch of p) if (ch === q[i]) i++
    if (i < q.length) return null
    score = 30
  }
  return score - p.length / 100
}

export function rankQuickOpen(paths: string[], query: string): string[] {
  const matches: Array<{ path: string; score: number }> = []
  for (const path of paths) {
    const score = quickOpenScore(path, query)
    if (score !== null) matches.push({ path, score })
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return matches.map((m) => m.path)
}

export interface TreeNode {
  name: string
  /** full project-relative path */
  path: string
  dir: boolean
  children: TreeNode[]
  kind: FileKind
  /** can be opened at all (editable or read-only preview) */
  viewable: boolean
}

function dirNode(name: string, path: string): TreeNode {
  return { name, path, dir: true, children: [], kind: 'binary', viewable: false }
}

// Folders before files, then alphabetical — but `src` always leads, because
// that's the code, which is the only reason this panel exists.
function order(a: TreeNode, b: TreeNode): number {
  if (a.dir !== b.dir) return a.dir ? -1 : 1
  if (a.path === 'src') return -1
  if (b.path === 'src') return 1
  return a.name.localeCompare(b.name)
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  nodes.sort(order)
  for (const n of nodes) if (n.dir) sortTree(n.children)
  return nodes
}

/** Build a real nested tree from flat project-relative paths. */
export function buildTree(paths: string[]): TreeNode[] {
  const roots: TreeNode[] = []
  const dirs = new Map<string, TreeNode>()

  const ensureDir = (path: string): TreeNode => {
    const found = dirs.get(path)
    if (found !== undefined) return found
    const name = baseName(path)
    const node = dirNode(name, path)
    dirs.set(path, node)
    const parent = dirName(path)
    if (parent === '') roots.push(node)
    else ensureDir(parent).children.push(node)
    return node
  }

  for (const path of paths) {
    if (path === '' || isHidden(path)) continue
    const file: TreeNode = {
      name: baseName(path),
      path,
      dir: false,
      children: [],
      kind: fileKind(path),
      viewable: isViewable(path)
    }
    const parent = dirName(path)
    if (parent === '') roots.push(file)
    else ensureDir(parent).children.push(file)
  }
  return sortTree(roots)
}

/** Prune the tree to branches containing a match. Folders match on their name too. */
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase()
  if (q === '') return nodes
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = []
    for (const n of list) {
      if (!n.dir) {
        if (n.path.toLowerCase().includes(q)) out.push(n)
        continue
      }
      const kids = walk(n.children)
      if (kids.length > 0 || n.name.toLowerCase().includes(q)) out.push({ ...n, children: kids })
    }
    return out
  }
  return walk(nodes)
}

/** Every folder path in the tree — what a search expands so hits are visible. */
export function allDirPaths(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      if (n.dir) {
        out.push(n.path)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}
