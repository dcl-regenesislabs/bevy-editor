// Turning a prefab Spawnable, and regenerating the registry on demand.
//
// The toggle is one gesture with three consequences, and all three have to land
// together or the scene compiles but does nothing: the flag in `data.json`, the
// runtime modules the prefab's scripts import (installing operations carry
// modules — a placed prefab is a folder, and nothing in it resolves back to this
// repo), and the regenerated `src/scripts/spawnables.ts`.
import { state } from '@scene/state'
import { dataLayerListFiles, dataLayerReadFile, dataLayerSaveFile } from '../engine/datalayer'
import { refreshPrefabs } from '../panels/prefab-store'
import { readPrefabFolder } from '../prefabs/storage'
import { aliasFor, withSpawnable } from '../prefabs/spawnable'
import { dirOf, type PrefabComposite, type PrefabSpawnable } from '../prefabs/format'
import {
  prefabScriptPaths,
  readRuntimeMasters,
  regenerateSpawnables,
  vendorRegistryRuntime
} from '../prefabs/generate'
import {
  claimedGlobals,
  rewriteRuntimeImports,
  transitiveModules
} from '../prefabs/vendoring'
import { log } from '../log'

const GUIDE_FILE = 'ai.md'

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await dataLayerReadFile(path)
  } catch {
    return null
  }
}

async function saveIfChanged(path: string, text: string): Promise<boolean> {
  if ((await readOrNull(path)) === text) return false
  await dataLayerSaveFile(path, text)
  return true
}

interface VendorResult {
  modules: string[]
  texts: string[]
  problems: string[]
}

// Copy the runtime modules this folder's scripts import in next to them, and
// normalise the copies' import specifiers to point at what just landed. A script
// captured out of `src/scripts/ai/` reaches its modules with `../runtime/…`; the
// copy sits flat in the prefab folder, so that specifier has to become `./runtime/…`.
async function vendorFolderModules(
  folder: string,
  composite: PrefabComposite,
  files: string[]
): Promise<VendorResult> {
  const masters = await readRuntimeMasters(files)
  const modules: string[] = []
  const texts: string[] = []
  const problems: string[] = []

  for (const scriptPath of prefabScriptPaths(folder, composite)) {
    if (!scriptPath.startsWith(`${folder}/`)) continue
    const text = await readOrNull(scriptPath)
    if (text === null) continue
    const dir = dirOf(scriptPath)
    let wanted: string[]
    try {
      wanted = transitiveModules(text, (rel) => masters[rel] ?? null)
    } catch (e) {
      problems.push(`${scriptPath}: ${String(e)} — place the prefab that ships it first.`)
      continue
    }
    for (const rel of wanted) {
      const target = `${dir}/runtime/${rel}`
      await saveIfChanged(target, masters[rel])
      if (!modules.includes(target)) {
        modules.push(target)
        texts.push(masters[rel])
      }
    }
    await saveIfChanged(scriptPath, rewriteRuntimeImports(text, dir, dir))
  }
  return { modules, texts, problems }
}

function stubGuide(name: string, folder: string, globals: string[]): string {
  const alias = aliasFor(name)
  return [
    '---',
    `prefab: ${folder}`,
    ...(globals.length === 0 ? [] : [`claims-globals: ${globals.join(', ')}`]),
    '---',
    `# ${name} — AI guide`,
    '',
    `${name} is Spawnable: runtime code clones it through \`Spawnables.${alias}\` in \`src/scripts/spawnables.ts\`.`,
    '',
    '## When to use',
    '',
    `Reach for ${name} when the scene needs copies of it at runtime rather than one placed copy.`,
    'Open a pool with `spawner.pool`, `spawner.plan` or `spawner.perPlayer` from the script that owns the behaviour — the sync mode belongs to the consumer, never to this folder.',
    '',
    '## API',
    '',
    'This prefab exposes no API of its own. Its scripts document their params in their own headers, and the runtime modules it carries document theirs in `scripts/runtime/`.',
    '',
    "## Do / Don't",
    '',
    '- DO read the params off the prefab card before setting them.',
    '- DO keep the cap (`max`) honest: the pool refuses to exceed it, it does not grow.',
    "- DON'T edit anything under `scripts/runtime/` — those copies are generated and drift-tested.",
    '',
    '## Example',
    '',
    '```ts',
    "import { pool } from './runtime/spawner'",
    "import { Spawnables } from './spawnables'",
    '',
    `const p = pool(Spawnables.${alias}, 'seeded')`,
    'const clone = p.acquire()',
    '```',
    ''
  ].join('\n')
}

// The tested invariant is a biconditional: a folder with `scripts/runtime/` has a
// guide and vice versa. Never overwrite a real one — a stub replacing a written
// guide is worse than no guide at all.
async function writeStubGuide(folder: string, name: string, vendored: VendorResult): Promise<boolean> {
  if (vendored.modules.length === 0) return false
  const path = `${folder}/${GUIDE_FILE}`
  if ((await readOrNull(path)) !== null) return false
  await dataLayerSaveFile(path, stubGuide(name, folder, claimedGlobals(vendored.texts)))
  return true
}

export const uiSetSpawnable = async (
  folder: string,
  spawnable: PrefabSpawnable | null
): Promise<void> => {
  state.assetBusy = true
  try {
    const { data, composite } = await readPrefabFolder(folder)
    const next = withSpawnable(data, spawnable)
    await dataLayerSaveFile(`${folder}/data.json`, `${JSON.stringify(next, null, 2)}\n`)

    const notes: string[] = []
    if (spawnable !== null) {
      const vendored = await vendorFolderModules(folder, composite, await dataLayerListFiles())
      notes.push(...vendored.problems)
      if (await writeStubGuide(folder, next.name, vendored)) notes.push('added a stub ai.md')
      // re-listed on purpose: the copies just written into this folder are the
      // freshest masters the registry's own copy can be refreshed from
      const registry = await vendorRegistryRuntime(await dataLayerListFiles(), { force: true })
      notes.push(...registry.problems)
    }

    const result = await regenerateSpawnables()
    notes.push(...result.problems)
    await refreshPrefabs()

    const headline =
      spawnable === null
        ? `${next.name} is no longer spawnable`
        : `${next.name} is spawnable — up to ${spawnable.max} at once`
    state.saveStatus = result.blocked
      ? `${headline}, but the registry was not regenerated — ${notes.join('; ')}`
      : notes.length === 0
        ? headline
        : `${headline} — ${notes.join('; ')}`
  } catch (e) {
    log.warn('spawnable toggle failed', folder, e)
    state.saveStatus = `could not change the Spawnable setting: ${String(e)}`
  } finally {
    state.assetBusy = false
  }
}

export const uiRegenerateSpawnables = async (): Promise<void> => {
  try {
    const result = await regenerateSpawnables()
    if (result.blocked) {
      state.saveStatus = `the spawn registry was left as it was — ${result.problems.join('; ')}`
      return
    }
    if (!result.written && !result.attached && result.vendored.length === 0) {
      state.saveStatus =
        result.problems.length === 0
          ? 'The spawn registry is up to date'
          : `The spawn registry is up to date — ${result.problems.join('; ')}`
      return
    }
    state.saveStatus =
      result.problems.length === 0
        ? 'Regenerated the spawn registry'
        : `Regenerated the spawn registry — ${result.problems.join('; ')}`
  } catch (e) {
    state.saveStatus = `could not regenerate the spawn registry: ${String(e)}`
  }
}
