// The runtime-module masters, bundled into the ui build.
//
// `packages/desktop/runtime-modules` is the single source every scene's
// `src/scripts/runtime/` is written from. It used to reach the renderer over IPC,
// which meant the web build and vitest had no masters at all — and a project
// opened there could not be given the runtime its scripts import. A static glob
// puts the same bytes in every build, reads them synchronously, and keeps this
// module the only place in app code that names the masters' folder.
//
// Static, not dynamic import(): the identical pattern types the in-app editor's
// TypeScript libs (script/ts-env.ts).
const SOURCES = import.meta.glob('../../../desktop/runtime-modules/**/*.ts', {
  eager: true,
  query: '?raw',
  import: 'default'
}) as Record<string, string>

// Glob keys are relative to this file; `rel` is the path inside runtime-modules/
// ('game.ts', 'pure/rng.ts') that every other module already speaks.
const ROOT = 'runtime-modules/'

const MASTERS: Record<string, string> = {}
for (const [key, text] of Object.entries(SOURCES)) {
  const i = key.lastIndexOf(ROOT)
  if (i < 0) continue
  MASTERS[key.slice(i + ROOT.length)] = text
}

export function runtimeMaster(rel: string): string | null {
  return MASTERS[rel] ?? null
}

export function runtimeMasterRels(): string[] {
  return Object.keys(MASTERS).sort()
}
