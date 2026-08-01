// Which entities the creator authored, read straight from the project's
// main.composite. This is the ground truth the hierarchy panel groups on.
//
// Everything else we tried is derived from the RUNNING scene and each failed on a
// real project: /crdt_initial came back empty, and entity 0's inspector::Nodes
// never reached the snapshot. The file on disk cannot be wrong about its own
// contents, so it wins.
import fs from 'node:fs'
import path from 'node:path'

interface CompositeDoc {
  components?: Array<{ name?: string; data?: Record<string, unknown> }>
}

// Hub layout first, then the flat layouts older/hand-made scenes use.
const CANDIDATES = ['assets/scene/main.composite', 'main.composite', 'assets/main.composite']

function findComposite(dir: string): string | null {
  for (const rel of CANDIDATES) {
    const full = path.join(dir, rel)
    if (fs.existsSync(full)) return full
  }
  return null
}

export function compositeEntityIds(dir: string): number[] {
  const file = findComposite(dir)
  if (file === null) return []
  let doc: CompositeDoc
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8')) as CompositeDoc
  } catch {
    return []
  }
  const ids = new Set<number>()
  for (const c of doc.components ?? []) {
    // composite::root is the container itself, not scene content
    if (c?.name === 'composite::root') continue
    for (const key of Object.keys(c?.data ?? {})) {
      const n = Number(key)
      // entity 0 is the scene root and carries only editor metadata
      if (Number.isFinite(n) && n > 0) ids.add(n)
    }
  }
  return [...ids].sort((a, b) => a - b)
}
