// Filesystem side of the UI builder's TS-AST round-trip: enumerate the
// project's authorable UI source files, parse one component into the builder
// tree, and write a re-spliced source back. `dir` is the project the window has
// open (main.ts owns that state); every path is confined to it.
import path from 'node:path'
import fs from 'node:fs'
import { parseUiComponent } from './ui-ast'

const UI_SKIP_DIRS = new Set(['node_modules', 'dist', 'bin', '.git'])

// List the project's authorable UI source files (.tsx/.jsx) for the import picker.
export function listUiFiles(dir: string | null): string[] {
  if (dir === null) return []
  const out: string[] = []
  const walk = (d: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) {
        if (!UI_SKIP_DIRS.has(ent.name) && !ent.name.startsWith('.')) walk(full)
      } else if (/\.(tsx|jsx)$/.test(ent.name)) {
        out.push(path.relative(dir, full).split(path.sep).join('/'))
      }
    }
  }
  walk(dir)
  return out.sort()
}

// Resolve a project-relative path, refusing anything that escapes the project dir.
function resolveInProject(dir: string | null, relPath: string): string | null {
  if (dir === null) return null
  const abs = path.resolve(dir, relPath)
  return abs === dir || abs.startsWith(dir + path.sep) ? abs : null
}

// Resolve a custom component (e.g. <HealthBar/>) to its source file, for inline
// preview — find its relative import, resolve next to `fromAbs`, return the source.
const COMPONENT_EXTS = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts']
function makeResolver(fromAbs: string): (name: string, importLines: string[]) => string | null {
  const dir = path.dirname(fromAbs)
  return (name, importLines) => {
    const line = importLines.find((l) => new RegExp(`\\b${name}\\b`).test(l) && /from\s+['"]\.\.?\//.test(l))
    const spec = line?.match(/from\s+['"]([^'"]+)['"]/)?.[1]
    if (spec === undefined || !spec.startsWith('.')) return null
    const base = path.resolve(dir, spec)
    for (const ext of COMPONENT_EXTS) {
      const p = /\.[jt]sx?$/.test(base) ? base : base + ext
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        try { return fs.readFileSync(p, 'utf8') } catch { return null }
      }
    }
    return null
  }
}

// TS-AST round-trip: parse a component's JSX into the builder tree (resolving
// child components for inline preview).
export function parseUiFile(
  dir: string | null,
  relPath: string
): ReturnType<typeof parseUiComponent> | { ok: false; error: string } {
  const abs = resolveInProject(dir, relPath)
  if (abs === null) return { ok: false, error: 'No project open / path escapes project' }
  if (!fs.existsSync(abs)) return { ok: false, error: `File not found: ${relPath}` }
  try {
    return parseUiComponent(fs.readFileSync(abs, 'utf8'), { resolve: makeResolver(abs) })
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// Write a (re-spliced) source back to a project UI file.
export function writeUiFile(dir: string | null, relPath: string, content: string): { ok: boolean; error?: string } {
  const abs = resolveInProject(dir, relPath)
  if (abs === null) return { ok: false, error: 'No project open / path escapes project' }
  if (!fs.existsSync(abs)) return { ok: false, error: `File not found: ${relPath}` }
  try {
    fs.writeFileSync(abs, content, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
