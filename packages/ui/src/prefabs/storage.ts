// Prefab folders on disk, through the dev server's data-layer RPC (the same path
// autosave and the script editor use). Everything here is project-relative:
// `custom/<slug>/…`, deduped `_2`, `_3`, … so a second "Door" never overwrites the
// first.
import {
  dataLayerAvailable,
  dataLayerListFiles,
  dataLayerReadFile,
  dataLayerReadFileBytes,
  dataLayerRemoveFiles,
  dataLayerSaveFile,
  dataLayerSaveFileBytes
} from '../engine/datalayer'
import { gltfExternalUris } from '../gltf-refs'
import { log } from '../log'
import {
  isRuntimeEntity,
  provenanceBaseline,
  state,
  topLevelSelected
} from '@scene/state'
import { assignLocalIds, authoredOnly, captureSelectionAsPrefab } from './capture'
import {
  PREFAB_ROOT_DIR,
  dirOf,
  isRecord,
  parsePrefabComposite,
  parsePrefabData,
  uniquePrefabFolder,
  type PrefabComposite,
  type PrefabData,
  type PrefabOrigin,
  type PrefabResource
} from './format'
import { strandedImports } from './vendoring'

export interface PrefabFolder {
  folder: string
  data: PrefabData
  composite: PrefabComposite
}

export interface WritePrefabInput {
  name: string
  composite: PrefabComposite
  resources: PrefabResource[]
  origin?: PrefabOrigin
  tags?: string[]
  requiredPermissions?: string[]
  thumbnail?: Uint8Array
}

export interface WritePrefabResult {
  folder: string
  data: PrefabData
  warnings: string[]
}

const MODEL_EXT = /\.(glb|gltf)$/i
const SCRIPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i

// Every JSON the editor writes ends in a newline — the shipped built-in
// `data.json` files do, and so do scene.json and a re-captured composite.json.
// Writing one form here and another there flips a creator's git diff on the
// file's last byte every time the two gestures alternate.
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await dataLayerSaveFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function requireDataLayer(): void {
  if (dataLayerAvailable() !== true) {
    throw new Error('prefabs need the scene server running with --data-layer')
  }
}

function newPrefabId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    // non-secure contexts have no randomUUID; the id only has to be unique per project
    return `prefab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

// Every `custom/<slug>` that already holds a prefab, out of a project file
// listing. Split from the fetch so a caller that already has the listing (the
// prefab store, which also reads thumbnails and guides out of it) doesn't ask
// the data layer twice.
export function prefabFoldersIn(files: string[]): string[] {
  const folders: string[] = []
  for (const path of files) {
    const parts = path.split('/')
    if (parts.length !== 3 || parts[0] !== PREFAB_ROOT_DIR || parts[2] !== 'data.json') continue
    folders.push(`${parts[0]}/${parts[1]}`)
  }
  return folders.sort()
}

export async function listPrefabFolders(): Promise<string[]> {
  return prefabFoldersIn(await dataLayerListFiles())
}

// A prefab folder written elsewhere (the Hub, a zip, the library) is parsed
// defensively — the shared parsers live in format.ts so the library client reads
// the same shapes the same way.
export function readPrefabData(raw: string, label: string): PrefabData {
  return parsePrefabData(raw, label, newPrefabId())
}

export async function readPrefabFolder(folder: string): Promise<PrefabFolder> {
  requireDataLayer()
  const [dataRaw, compositeRaw] = await Promise.all([
    dataLayerReadFile(`${folder}/data.json`),
    dataLayerReadFile(`${folder}/composite.json`)
  ])
  return {
    folder,
    data: readPrefabData(dataRaw, `${folder}/data.json`),
    composite: parsePrefabComposite(compositeRaw, `${folder}/composite.json`)
  }
}

// A captured script is copied byte-for-byte; only `runtime/` specifiers are ever
// re-pointed. Anything else relative it imports stays behind in src/, so say so
// here rather than letting the creator meet it as a build error in the folder.
function noteStrandedImports(
  resource: PrefabResource,
  targetDir: string,
  bytes: Uint8Array,
  warnings: string[]
): void {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return // not text after all; nothing to scan
  }
  for (const spec of strandedImports(text, dirOf(resource.source), targetDir)) {
    warnings.push(
      `${resource.rel} imports '${spec}', which does not travel with it — a prefab folder has to be self-contained`
    )
  }
}

// Copy one captured resource into the prefab folder. Models drag their external
// images/buffers along (relative structure preserved) or they 404 at load time.
async function copyResource(
  folder: string,
  resource: PrefabResource,
  warnings: string[]
): Promise<void> {
  let bytes: Uint8Array
  try {
    bytes = await dataLayerReadFileBytes(resource.source)
  } catch (e) {
    warnings.push(`could not bundle ${resource.source}: ${String(e)}`)
    log.warn('prefab resource unreadable', resource.source, e)
    return
  }
  await dataLayerSaveFileBytes(`${folder}/${resource.rel}`, bytes)
  if (SCRIPT_EXT.test(resource.source)) {
    noteStrandedImports(resource, dirOf(`${folder}/${resource.rel}`), bytes, warnings)
    return
  }
  if (!MODEL_EXT.test(resource.source)) return

  const sourceDir = dirOf(resource.source)
  const targetDir = dirOf(resource.rel)
  for (const uri of gltfExternalUris(resource.source, bytes)) {
    const from = sourceDir === '' ? uri : `${sourceDir}/${uri}`
    const to = targetDir === '' ? uri : `${targetDir}/${uri}`
    try {
      await dataLayerSaveFileBytes(`${folder}/${to}`, await dataLayerReadFileBytes(from))
    } catch (e) {
      warnings.push(`${resource.rel} references ${uri}, which could not be bundled`)
      log.warn('prefab model reference unreadable', from, e)
    }
  }
}

export async function writePrefabFolder(input: WritePrefabInput): Promise<WritePrefabResult> {
  requireDataLayer()
  const folder = uniquePrefabFolder(input.name, await listPrefabFolders())
  const data: PrefabData = {
    id: newPrefabId(),
    name: input.name,
    category: 'custom',
    tags: input.tags ?? [],
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    ...(input.requiredPermissions === undefined
      ? {}
      : { requiredPermissions: input.requiredPermissions })
  }

  const warnings: string[] = []
  await writeJsonFile(`${folder}/data.json`, data)
  await writeJsonFile(`${folder}/composite.json`, input.composite)
  if (input.thumbnail !== undefined) {
    await dataLayerSaveFileBytes(`${folder}/thumbnail.png`, input.thumbnail)
  }
  for (const resource of input.resources) await copyResource(folder, resource, warnings)

  return { folder, data, warnings }
}

// Rename the prefab, not its folder: instances point at `data.id`, and moving the
// folder would break the `{assetPath}` resources of anything already placed.
export async function renamePrefabFolder(folder: string, name: string): Promise<PrefabData> {
  requireDataLayer()
  const trimmed = name.trim()
  if (trimmed === '') throw new Error('a prefab needs a name')
  const { data } = await readPrefabFolder(folder)
  const renamed: PrefabData = { ...data, name: trimmed }
  await writeJsonFile(`${folder}/data.json`, renamed)
  return renamed
}

// Remove the whole prefab folder. Instances placed from it keep their entities but
// lose their files: instantiation points them at `custom/<slug>/…`, it doesn't copy
// the resources a second time. Callers must say so before deleting.
export async function deletePrefabFolder(folder: string): Promise<void> {
  requireDataLayer()
  const files = (await dataLayerListFiles()).filter((p) => p.startsWith(`${folder}/`))
  if (files.length === 0) return
  const failed = await dataLayerRemoveFiles(files)
  if (failed.length > 0) throw new Error(`could not delete ${failed.join(', ')}`)
}

export interface CreatePrefabOptions {
  origin?: PrefabOrigin
  tags?: string[]
  requiredPermissions?: string[]
  thumbnail?: Uint8Array
}

// The scene's display title (scene.json), so a prefab can say where it was made.
async function sceneDisplayName(): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await dataLayerReadFile('scene.json'))
    if (!isRecord(parsed) || !isRecord(parsed.display)) return undefined
    return typeof parsed.display.title === 'string' ? parsed.display.title : undefined
  } catch {
    return undefined
  }
}

// Capture the current selection (top-level roots + their subtrees) and write it as a
// prefab folder. Warnings — dropped refs, unbundled files — are returned, never thrown.
export async function createPrefabFromSelection(
  name: string,
  options: CreatePrefabOptions = {}
): Promise<WritePrefabResult & { entityCount: number }> {
  const roots = topLevelSelected(state.snapshot)
  if (roots.length === 0) throw new Error('select at least one entity to save as a prefab')
  const baseline = provenanceBaseline()
  const authored = authoredOnly(state.snapshot, (id) => isRuntimeEntity(id, baseline))
  const authoredRoots = roots.filter((id) => authored[id] !== undefined)
  if (authoredRoots.length === 0) {
    throw new Error(
      "the selection was spawned by the scene's code — the code recreates it on every run, so there is nothing to save"
    )
  }
  const captured = captureSelectionAsPrefab(authored, authoredRoots)
  const fullCount = assignLocalIds(state.snapshot, roots).entities.length
  const dropped = fullCount - captured.ids.entities.length
  if (dropped > 0) {
    captured.warnings.push(
      `${dropped} code-spawned ${dropped === 1 ? 'entity was' : 'entities were'} left out — the scene's code recreates them when it runs`
    )
  }
  const written = await writePrefabFolder({
    name,
    composite: captured.composite,
    resources: captured.resources,
    origin: options.origin ?? { source: 'user', project: await sceneDisplayName() },
    tags: options.tags,
    requiredPermissions: options.requiredPermissions,
    thumbnail: options.thumbnail
  })
  return {
    ...written,
    warnings: [...captured.warnings, ...written.warnings],
    entityCount: captured.ids.entities.length
  }
}

// Merge a prefab's declared scene permissions into the project's scene.json. Returns
// the ones actually added (empty when nothing changed), so the caller can say so.
export async function mergeRequiredPermissions(permissions: string[]): Promise<string[]> {
  if (permissions.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(await dataLayerReadFile('scene.json'))
  } catch (e) {
    log.warn('prefab permissions: scene.json unreadable', e)
    return []
  }
  if (!isRecord(parsed)) return []
  const current = Array.isArray(parsed.requiredPermissions)
    ? parsed.requiredPermissions.filter((p): p is string => typeof p === 'string')
    : []
  const added = permissions.filter((p) => !current.includes(p))
  if (added.length === 0) return []
  parsed.requiredPermissions = [...current, ...added]
  await writeJsonFile('scene.json', parsed)
  return added
}
