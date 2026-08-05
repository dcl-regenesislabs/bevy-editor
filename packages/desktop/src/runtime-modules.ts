// Reading a runtime-module master out of the app's resources.
//
// Prefab folders carry byte-identical copies of the modules their scripts
// import, so the renderer usually vendors from a placed prefab. It cannot when
// the project holds none — turning Spawnable on in a scene with no Multiplayer
// Server prefab still has to write `src/scripts/runtime/spawner.ts`. This is
// that fallback, and the only path by which packages/desktop/runtime-modules
// reaches a renderer.
//
// The argument comes from the renderer, so it is a path to distrust: only a
// relative `.ts` under the tree is readable, and the RESOLVED path is checked
// against the root — sanitising the string instead is how traversal guards get
// bypassed. Takes its root as an argument (main passes runtimeModulesDir()) so
// this module stays free of electron and testable.
import fs from 'node:fs'
import path from 'node:path'

export function resolveRuntimeModule(root: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel === '' || !rel.endsWith('.ts')) return null
  if (path.isAbsolute(rel) || rel.includes('\0')) return null
  const full = path.resolve(root, rel)
  const inside = path.relative(root, full)
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return null
  return full
}

export function readRuntimeModule(root: string, rel: string): string | null {
  const full = resolveRuntimeModule(root, rel)
  if (full === null) return null
  try {
    return fs.readFileSync(full, 'utf8')
  } catch {
    return null
  }
}
