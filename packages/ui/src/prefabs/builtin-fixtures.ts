// Test-only readers for the prefabs shipped in packages/desktop/prefabs: plain
// folders no app code imports, so the suites that guard them read them off disk.
// Shared by builtin.test.ts and guides.test.ts so "a prefab folder" and "carries
// runtime modules" each have ONE definition — the guide biconditional and the
// carried-copy byte-identity check must agree on the second one.
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

// A carried copy of packages/desktop/runtime-modules/* is what makes a prefab
// something another script imports — and therefore something to document.
export function hasRuntimeModules(folder: string): boolean {
  return existsSync(fileURLToPath(new URL(`${folder}/scripts/runtime/`, PREFABS_ROOT)))
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
