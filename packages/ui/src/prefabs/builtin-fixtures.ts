// Test-only readers for the prefabs shipped in packages/desktop/prefabs: plain
// folders no app code imports, so the suites that guard them read them off disk.
// Shared by builtin.test.ts and guides.test.ts so "a prefab folder" and "uses a
// runtime module" each have ONE definition — the guide biconditional and the
// specifier-resolves check must agree on the second one.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PREFABS_ROOT = new URL('../../../desktop/prefabs/', import.meta.url)

export function readPrefabFile(rel: string, base: URL = PREFABS_ROOT): string {
  return readFileSync(new URL(rel, base), 'utf8')
}

// Every directory under prefabs/, prefab or not — a half-added folder still gets
// checked for drift.
export function prefabDirs(): string[] {
  return readdirSync(fileURLToPath(PREFABS_ROOT), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

// The ones that are a prefab: data.json is the folder's identity.
export function prefabFolders(): string[] {
  return prefabDirs().filter((name) => existsSync(new URL(`${name}/data.json`, PREFABS_ROOT)))
}

// Using a runtime module is what makes a prefab something another script imports
// — and therefore something to document. Prefabs no longer carry a copy of the
// masters, so the proof is the `~runtime/` specifier in their own scripts.
export function hasRuntimeModules(folder: string): boolean {
  return runtimeSpecifiers(folder).length > 0
}

// Every `~runtime/<module>` a folder's scripts import, in source order, with
// duplicates kept — callers that resolve them want each site named.
export function runtimeSpecifiers(folder: string): string[] {
  const dir = new URL(`${folder}/scripts/`, PREFABS_ROOT)
  if (!existsSync(fileURLToPath(dir))) return []
  const out: string[] = []
  for (const rel of filesUnder(dir)) {
    if (!/\.tsx?$/.test(rel)) continue
    for (const [, spec] of readFileSync(new URL(rel, dir), 'utf8').matchAll(/'(~runtime\/[^']+)'/g)) out.push(spec)
  }
  return out
}

// Every file under `root`, as paths relative to it.
export function filesUnder(root: URL, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(fileURLToPath(new URL(base, root)), { withFileTypes: true })) {
    const rel = `${base}${entry.name}`
    if (entry.isDirectory()) out.push(...filesUnder(root, `${rel}/`))
    else out.push(rel)
  }
  return out
}
