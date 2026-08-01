// Pure half of prefab versioning: the origin-hash manifest shape, the
// modified-file diff, and the layout merge an update applies to placed
// entities. No data-layer, no engine — unit-testable as-is; the IO lives in
// hashes.ts and update.ts.
import { mergeLayout, parseLayout, type ScriptLayout, type ScriptParseResult } from '../script/parser'
import { isRecord } from './format'

// Written next to a copied prefab's files: { [pathRelativeToFolder]: sha256hex }
// of every file as it arrived from the library master.
export const ORIGIN_HASHES_FILE = '.origin-hashes.json'

const SCRIPT_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i

export function parseOriginHashes(raw: string): Record<string, string> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const hashes: Record<string, string> = {}
  for (const [rel, hash] of Object.entries(parsed)) {
    if (typeof hash === 'string') hashes[rel] = hash
  }
  return hashes
}

// Files the copy no longer matches the manifest on — edited or deleted locally.
// Locally added files are not the master's, so they don't count.
export function diffAgainstManifest(
  manifest: Record<string, string>,
  current: Record<string, string>
): string[] {
  const modified: string[] = []
  for (const [rel, hash] of Object.entries(manifest)) {
    if (current[rel] !== hash) modified.push(rel)
  }
  return modified.sort()
}

// With no manifest there is nothing to compare against, so every script the copy
// carries is reported as potentially modified.
export function scriptFilesOf(paths: string[]): string[] {
  return paths.filter((rel) => SCRIPT_FILE.test(rel)).sort()
}

function freshLayout(fresh: ScriptParseResult): ScriptLayout {
  return { params: fresh.params, actions: fresh.actions, error: fresh.error }
}

// The layout a just-parsed script gets when nothing is there to preserve — what
// instantiation writes onto a prefab's Script entries.
export function freshLayoutJson(fresh: ScriptParseResult): string {
  return JSON.stringify(freshLayout(fresh))
}

// Layout an updated script leaves on a placed entity: the fresh parse supplies
// params/types/defaults, the entity's edited values survive by name (the same
// mergeLayout the Script inspector's refresh uses). An entity with no layout yet
// adopts the fresh one.
export function mergedLayoutJson(
  fresh: ScriptParseResult,
  existingLayout: string | undefined
): string {
  const existing = parseLayout(existingLayout)
  if (existing === undefined) return freshLayoutJson(fresh)
  return JSON.stringify(mergeLayout(freshLayout(fresh), existing))
}
