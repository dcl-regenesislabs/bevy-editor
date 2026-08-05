// Regenerating `src/scripts/spawnables.ts` from the project's prefab folders.
//
// The one impure module of the spawnable set: it reads the data layer, renders
// the file in memory through codegen.ts, and only then writes. Three properties
// it must keep, because autosave calls it after every composite write:
//
//   - transactional — a blocking lint problem writes nothing, so the last good
//     registry stays on disk instead of being replaced by a broken one;
//   - write-if-changed — the entity-0 Script row it installs dirties the
//     composite, which triggers autosave, which calls back in here. Comparing
//     before writing is what stops that loop on the first iteration;
//   - never reload — a frozen scene must not refetch /crdt_snapshot after a
//     write (instantiate.ts learned that the hard way).
import { writeComponent } from '@scene/inspector'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { state } from '@scene/state'
import {
  dataLayerAvailable,
  dataLayerListFiles,
  dataLayerReadFile,
  dataLayerRealm,
  dataLayerSaveFile
} from '../engine/datalayer'
import { log } from '../log'
import {
  REGISTRY_LAYOUT,
  REGISTRY_PRIORITY,
  SPAWNABLES_PATH,
  SPAWNER_COMPONENTS_CONTRACT,
  SPAWNER_MODULE_PATH,
  renderSpawnables,
  type SpawnableSource
} from './codegen'
import { GAME_CONFIG_PATH } from '../gameconfig/generate'
import { isRecord, substituteAssetPath, type PrefabComposite } from './format'
import { prefabFoldersIn, readPrefabFolder } from './storage'
import { RUNTIME_MODULE_MARKER, runtimeImportsOf, transitiveModules } from './vendoring'

const REGISTRY_RUNTIME_DIR = 'src/scripts/runtime'
// where a prefab folder carries its runtime copies
const CARRIED = '/scripts/runtime/'
// the registry's only runtime dependency, expressed as the text the closure walk reads
const SPAWNER_ENTRY = "import { registerSpawnables } from './runtime/spawner'"
// …and as its path inside runtime-modules/, which is how the shell names it
const SPAWNER_MODULE_REL = 'spawner.ts'
const ROOT_ENTITY = '0'

export interface GenerateResult {
  /** the registry file was written this run */
  written: boolean
  /** the entity-0 Script row was installed or corrected */
  attached: boolean
  /** runtime modules copied into src/scripts/runtime/ this run */
  vendored: string[]
  problems: string[]
  /** a blocking problem stopped the write; the previous registry is untouched */
  blocked: boolean
}

function nothing(): GenerateResult {
  return { written: false, attached: false, vendored: [], problems: [], blocked: false }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await dataLayerReadFile(path)
  } catch {
    return null
  }
}

// Every script a prefab's composite points at, `{assetPath}` resolved to the
// folder. The lint needs the text, an empty Script layout is filled from it, and
// the Spawnable toggle vendors the runtime modules it imports.
export function prefabScriptPaths(folder: string, composite: PrefabComposite): string[] {
  const paths: string[] = []
  for (const component of composite.components) {
    if (component.name !== SCRIPT_COMPONENT) continue
    for (const entry of Object.values(component.data)) {
      const rows = isRecord(entry.json) ? entry.json.value : undefined
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (!isRecord(row) || typeof row.path !== 'string') continue
        const holder = { path: row.path }
        substituteAssetPath(holder, folder)
        if (!paths.includes(holder.path)) paths.push(holder.path)
      }
    }
  }
  return paths
}

async function readProject(
  files: string[]
): Promise<{ prefabs: SpawnableSource[]; scripts: Record<string, string> }> {
  const prefabs: SpawnableSource[] = []
  for (const folder of prefabFoldersIn(files)) {
    try {
      const read = await readPrefabFolder(folder)
      prefabs.push({ folder, data: read.data, composite: read.composite })
    } catch (e) {
      log.warn('spawnables: prefab folder unreadable', folder, e)
    }
  }
  const scripts: Record<string, string> = {}
  for (const source of prefabs) {
    for (const path of prefabScriptPaths(source.folder, source.composite)) {
      if (path in scripts) continue
      const text = await readOrNull(path)
      if (text !== null) scripts[path] = text
    }
  }
  return { prefabs, scripts }
}

// The app's own masters, walked from `spawner.ts` one module at a time because
// the read is an IPC round trip. Only reached when the project holds no copy —
// a scene where Spawnable is turned on before any Multiplayer Server prefab is
// placed. Absent on the web build, where the shell method does not exist.
async function readShippedMasters(): Promise<Record<string, string>> {
  const read = window.editorShell?.runtimeModuleRead
  if (read === undefined) return {}
  const masters: Record<string, string> = {}
  const queue = [SPAWNER_MODULE_REL]
  while (queue.length > 0) {
    const rel = queue.shift() as string
    if (rel in masters) continue
    let text: string | null = null
    try {
      text = await read(rel)
    } catch (e) {
      log.warn('runtime module unreadable', rel, e)
    }
    if (text === null) continue
    masters[rel] = text
    queue.push(...runtimeImportsOf(text))
  }
  return masters
}

// Every runtime module the project holds a copy of, keyed by its path inside
// `runtime/`. Precedence, weakest first: the app's shipped masters, then a copy
// already vendored into src/scripts/runtime/, then a placed prefab's carried
// copy — prefab copies are written from `packages/desktop/runtime-modules` and
// byte-identity tested against it, so a project that holds one holds the truth.
export async function readRuntimeMasters(
  files: string[],
  options: { preferShipped?: boolean } = {}
): Promise<Record<string, string>> {
  const sources = new Map<string, string>()
  for (const path of files.filter((p) => p.startsWith(`${REGISTRY_RUNTIME_DIR}/`)).sort()) {
    sources.set(path.slice(REGISTRY_RUNTIME_DIR.length + 1), path)
  }
  // a carried copy overwrites the already-vendored one: prefab folders are
  // written from the masters this repo byte-identity tests, ours is a copy of a copy
  for (const path of files.filter((p) => p.startsWith('custom/') && p.includes(CARRIED)).sort()) {
    sources.set(path.slice(path.indexOf(CARRIED) + CARRIED.length), path)
  }
  // …except when the project's copies are what we are replacing. Then this app
  // is the newest thing in the room and its own masters outrank every copy,
  // including a prefab folder placed by an older build.
  const preferShipped = options.preferShipped === true
  const shipped = preferShipped || !sources.has(SPAWNER_MODULE_REL) ? await readShippedMasters() : {}
  const masters: Record<string, string> = preferShipped ? {} : { ...shipped }
  for (const [rel, path] of sources) {
    const text = await readOrNull(path)
    if (text !== null) masters[rel] = text
  }
  return preferShipped ? { ...masters, ...shipped } : masters
}

// Vendoring is skipped once spawner.ts is in place: the pass writes the whole
// closure at once, so a partial set can only come from a hand-deletion, and
// autosave must not re-read the module set on every keystroke. `force` is the
// Spawnable toggle's explicit refresh.
//
// The one thing that is re-read is the vendored spawner itself, because the
// registry rendered above CALLS it: a copy older than the component table takes
// one argument, and writing a two-argument call against it breaks the creator's
// build in generated code they never wrote.
// A creator cannot fix a bug in a file the editor generated: once a runtime
// module is vendored into a project, only the editor can update it. So the
// first regeneration pass a project sees from this build compares every vendored
// copy — src/scripts/runtime/ and each prefab folder's carried scripts/runtime/ —
// against the shipped masters and silently rewrites the ones that differ.
// Silent is right here: these are machine-owned artifacts (same as
// spawnables.ts), and the alternative is a creator staring at a compile error
// in code they never wrote. Once per project connection: masters cannot change
// mid-session, and autosave calls in after every composite write.
const refreshedRealms = new Set<string>()

export function resetRuntimeRefreshForTests(): void {
  refreshedRealms.clear()
}

async function refreshVendoredCopies(files: string[]): Promise<string[]> {
  const read = window.editorShell?.runtimeModuleRead
  if (read === undefined) return []
  const copies: Array<{ path: string; rel: string }> = []
  for (const path of files) {
    if (path.startsWith(`${REGISTRY_RUNTIME_DIR}/`)) {
      copies.push({ path, rel: path.slice(REGISTRY_RUNTIME_DIR.length + 1) })
    } else if (path.startsWith('custom/') && path.includes(CARRIED)) {
      copies.push({ path, rel: path.slice(path.indexOf(CARRIED) + CARRIED.length) })
    }
  }
  const masters = new Map<string, string | null>()
  const refreshed: string[] = []
  for (const { path, rel } of copies) {
    if (!masters.has(rel)) {
      let text: string | null = null
      try {
        text = await read(rel)
      } catch {
        text = null
      }
      masters.set(rel, text)
    }
    const master = masters.get(rel) ?? null
    if (master === null) continue
    const current = await readOrNull(path)
    if (current === null || current === master) continue
    // the marker is the ownership proof: a creator's own file that happens to
    // sit in a runtime/ folder under a master's name is never overwritten
    if (!current.includes(RUNTIME_MODULE_MARKER)) continue
    await dataLayerSaveFile(path, master)
    refreshed.push(path)
  }
  return refreshed
}

export async function maybeRefreshVendoredCopies(files: string[]): Promise<string[]> {
  const realm = dataLayerRealm() ?? ''
  if (refreshedRealms.has(realm)) return []
  refreshedRealms.add(realm)
  const refreshed = await refreshVendoredCopies(files)
  if (refreshed.length > 0) log.warn('runtime modules updated from this build', refreshed)
  return refreshed
}

export async function vendorRegistryRuntime(
  files: string[],
  options: { force?: boolean } = {}
): Promise<{ vendored: string[]; problems: string[] }> {
  let stale = false
  if (options.force !== true && files.includes(SPAWNER_MODULE_PATH)) {
    const current = await readOrNull(SPAWNER_MODULE_PATH)
    if (current !== null && current.includes(SPAWNER_COMPONENTS_CONTRACT)) {
      return { vendored: [], problems: [] }
    }
    stale = true
  }
  const masters = await readRuntimeMasters(files, { preferShipped: stale })
  let wanted: string[]
  try {
    wanted = transitiveModules(SPAWNER_ENTRY, (rel) => masters[rel] ?? null)
  } catch {
    return {
      vendored: [],
      problems: [
        'the spawner runtime module is not in this project — place one of the Multiplayer Server prefabs, or turn Spawnable off, so the generated registry has a runtime to import.'
      ]
    }
  }
  const vendored: string[] = []
  for (const rel of wanted) {
    const path = `${REGISTRY_RUNTIME_DIR}/${rel}`
    if ((await readOrNull(path)) === masters[rel]) continue
    await dataLayerSaveFile(path, masters[rel])
    vendored.push(path)
  }
  return { vendored, problems: [] }
}

interface ScriptRow {
  path: string
  priority: number
  layout?: string
}

// Prefab UUIDs picked in prefab-typed params across every Script row in the
// scene. Picking a prefab in a dropdown is the whole declaration — these refs
// are what the registry ships.
export function referencedPrefabIds(snapshot: Record<string, Record<string, unknown>>): string[] {
  const ids = new Set<string>()
  for (const components of Object.values(snapshot)) {
    const value = components[SCRIPT_COMPONENT]
    const rows = isRecord(value) ? value.value : undefined
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!isRecord(row) || typeof row.layout !== 'string') continue
      let layout: unknown
      try {
        layout = JSON.parse(row.layout)
      } catch {
        continue
      }
      const params = isRecord(layout) && isRecord(layout.params) ? layout.params : undefined
      if (params === undefined) continue
      for (const param of Object.values(params)) {
        if (!isRecord(param) || (param.type !== 'prefab' && param.type !== 'prefabList')) continue
        const value = param.value
        const refs =
          typeof value === 'string'
            ? value.split(',')
            : Array.isArray(value)
              ? value
              : []
        for (const ref of refs) {
          if (typeof ref === 'string' && ref.trim() !== '') ids.add(ref.trim())
        }
      }
    }
  }
  return [...ids].sort()
}

function registryRow(): ScriptRow {
  return { path: SPAWNABLES_PATH, priority: REGISTRY_PRIORITY, layout: REGISTRY_LAYOUT }
}

function currentRows(): ScriptRow[] {
  const value = state.snapshot[ROOT_ENTITY]?.[SCRIPT_COMPONENT]
  const rows = isRecord(value) ? value.value : undefined
  if (!Array.isArray(rows)) return []
  return rows.filter(isRecord).map((row) => ({
    path: typeof row.path === 'string' ? row.path : '',
    priority: typeof row.priority === 'number' ? row.priority : 0,
    ...(typeof row.layout === 'string' ? { layout: row.layout } : {})
  }))
}

// One Script row on entity 0 installs the registry — no src/index.ts edit, ever.
// Written only when it differs, or the write dirties the composite and autosave
// calls straight back in here.
async function ensureAttached(): Promise<boolean> {
  const rows = currentRows()
  const wanted = registryRow()
  const existing = rows.find((row) => row.path === SPAWNABLES_PATH)
  if (
    existing !== undefined &&
    existing.priority === wanted.priority &&
    existing.layout === wanted.layout
  ) {
    return false
  }
  const next = existing === undefined ? [...rows, wanted] : rows.map((row) => (row.path === SPAWNABLES_PATH ? wanted : row))
  await writeComponent(ROOT_ENTITY, SCRIPT_COMPONENT, JSON.stringify({ value: next }))
  return true
}

async function run(): Promise<GenerateResult> {
  if (dataLayerAvailable() !== true) return nothing()
  const files = await dataLayerListFiles()
  // after the pass, not before: refresh must not add reads ahead of the
  // pass's own snapshot of the project (coalescing counts on that ordering),
  // and it still completes inside the same awaited flush, so a fixed module
  // reaches the scene before Play builds it
  const result = await runInner(files)
  await maybeRefreshVendoredCopies(files)
  return result
}

async function runInner(files: string[]): Promise<GenerateResult> {
  const installed = files.includes(SPAWNABLES_PATH)
  // a scene with no prefabs at all cannot have a spawnable one; skip the folder
  // reads entirely, since autosave calls this after every composite write
  if (!installed && prefabFoldersIn(files).length === 0) return nothing()

  const { prefabs, scripts } = await readProject(files)
  const referenced = referencedPrefabIds(state.snapshot as Record<string, Record<string, unknown>>)
  // nothing to install and nothing installed: a scene that never used spawnables
  // must not grow a generated file it does not need
  if (!installed && referenced.length === 0 && !prefabs.some((p) => p.data.spawnable !== undefined)) {
    return nothing()
  }

  const rendered = renderSpawnables({
    prefabs,
    scripts,
    gameConfig: files.includes(GAME_CONFIG_PATH),
    referenced
  })
  if (rendered.blocking) {
    return { ...nothing(), problems: rendered.problems, blocked: true }
  }

  const vendor = await vendorRegistryRuntime(files)
  // The registry's first line imports `./runtime/spawner`. With no module to
  // vendor there, writing it swaps a working registry for one that fails the
  // creator's build in generated code they never wrote — the same reason a
  // blocking lint writes nothing.
  if (vendor.problems.length > 0) {
    return { ...nothing(), problems: [...rendered.problems, ...vendor.problems], blocked: true }
  }
  const problems = [...rendered.problems]

  let written = false
  if ((await readOrNull(SPAWNABLES_PATH)) !== rendered.text) {
    await dataLayerSaveFile(SPAWNABLES_PATH, rendered.text)
    written = true
  }
  const attached = await ensureAttached()
  return { written, attached, vendored: vendor.vendored, problems, blocked: false }
}

let inFlight: Promise<GenerateResult> | null = null
let trailing: Promise<GenerateResult> | null = null

function start(): Promise<GenerateResult> {
  const started = run()
    .catch((e: unknown) => {
      log.warn('spawnables regeneration failed', e)
      return { ...nothing(), problems: [String(e)] }
    })
    .finally(() => {
      inFlight = null
    })
  inFlight = started
  return started
}

// Coalesced, with a trailing pass. Joining the run already going is only sound
// for a caller whose writes it had already read: `run()` lists and reads the
// whole project up front, so a caller that turned Spawnable on 200ms into that
// read would otherwise get "done" back for a registry compiled without its flag,
// with nothing scheduled to correct it. Such a caller waits for a pass that
// STARTS after it instead — one trailing run is enough, since every pass re-reads
// the project from scratch.
export function regenerateSpawnables(): Promise<GenerateResult> {
  if (inFlight === null) return start()
  if (trailing === null) {
    trailing = inFlight.then(() => {
      trailing = null
      return start()
    })
  }
  return trailing
}
