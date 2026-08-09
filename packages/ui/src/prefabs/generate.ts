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
import { setOnSnapshotReady, writeComponent } from '@scene/inspector'
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
import { readServerPresence } from '../features/play/server-presence'
import { isRecord, substituteAssetPath, type PrefabComposite } from './format'
import { prefabFoldersIn, readPrefabFolder } from './storage'
import { healInertArtifacts } from './heal-inert'
import { readOriginHashes, sha256Hex, writeOriginHashes } from './hashes'
import { runtimeMaster } from './runtime-masters'
import {
  GAME_MODULE_REL,
  importSpecifiers,
  isVendoredCopy,
  resolveSibling,
  runtimeImportsOf,
  transitiveModules
} from './vendoring'

const REGISTRY_RUNTIME_DIR = 'src/scripts/runtime'
// where the creator's own scripts live — everything the editor scaffolds, the
// assistant writes, and the Script rows point at
const SCRIPTS_DIR = 'src/scripts/'
// a placed prefab's own scripts, which import the project's shared copy by
// climbing out of the folder
const PREFAB_SCRIPT = /^custom\/[^/]+\/scripts\/.+\.tsx?$/
// a project with more scripts than this is not one the editor scaffolded
const MAX_CREATOR_SCRIPTS = 200
// where a prefab folder placed by an older build carries its runtime copies
const CARRIED = '/scripts/runtime/'
// the registry's only runtime dependency, expressed as the text the closure walk
// reads, and — read off that same text — as its path inside runtime-modules/
const SPAWNER_ENTRY = "import { registerSpawnables } from './runtime/spawner'"
const SPAWNER_ENTRY_REL = runtimeImportsOf(SPAWNER_ENTRY)[0]
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

// The masters for `entries` and everything they import. Masters name their
// siblings by plain relative path, so the walk resolves against the module's own
// place in runtime-modules/ — `./runtime/x` never appears inside one.
//
// The bundled masters are the only source, in every build: a copy already on
// disk is a copy of these, and this app is always the newest thing in the room.
function shippedMasters(entries: string[]): Record<string, string> {
  const masters: Record<string, string> = {}
  const queue = [...entries]
  while (queue.length > 0) {
    const rel = queue.shift() as string
    if (rel in masters) continue
    const text = runtimeMaster(rel)
    if (text === null) continue
    masters[rel] = text
    for (const spec of importSpecifiers(text)) {
      const dep = resolveSibling(rel, spec)
      if (dep !== null && !(dep in masters)) queue.push(dep)
    }
  }
  return masters
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
// copy against the shipped masters and silently rewrites the ones that differ.
// That includes the carried scripts/runtime/ a folder placed by an older build
// still holds: nothing deletes those until their owner accepts the prefab
// update, and dropping them from this pass would turn a duplicate that stays
// correct into one that silently drifts.
// Silent is right here: these are machine-owned artifacts (same as
// spawnables.ts), and the alternative is a creator staring at a compile error
// in code they never wrote. Once per project connection: masters cannot change
// mid-session, and autosave calls in after every composite write.
const refreshedRealms = new Set<string>()

export function resetRuntimeRefreshForTests(): void {
  refreshedRealms.clear()
  warnedShadows.clear()
}

// A prefab folder's origin-hash manifest records the bytes its files arrived
// with, and updatePrefabCopy refuses when a file no longer matches — "N files you
// edited would be overwritten". The refresh below rewrites files inside that
// folder, so without re-stamping, the editor's own rewrite reads as the
// creator's edit and their next prefab update is blocked by it.
async function restampManifest(folder: string, written: Map<string, string>): Promise<void> {
  const hashes = await readOriginHashes(folder)
  if (hashes === null) return
  let changed = false
  for (const [path, text] of written) {
    const rel = path.slice(folder.length + 1)
    if (!(rel in hashes)) continue
    hashes[rel] = await sha256Hex(new TextEncoder().encode(text))
    changed = true
  }
  if (changed) await writeOriginHashes(folder, hashes)
}

async function refreshVendoredCopies(files: string[]): Promise<string[]> {
  const copies: Array<{ path: string; rel: string }> = []
  for (const path of files) {
    if (path.startsWith(`${REGISTRY_RUNTIME_DIR}/`)) {
      copies.push({ path, rel: path.slice(REGISTRY_RUNTIME_DIR.length + 1) })
    } else if (path.startsWith('custom/') && path.includes(CARRIED)) {
      copies.push({ path, rel: path.slice(path.indexOf(CARRIED) + CARRIED.length) })
    }
  }
  const refreshed: string[] = []
  const byFolder = new Map<string, Map<string, string>>()
  for (const { path, rel } of copies) {
    const master = runtimeMaster(rel)
    if (master === null) continue
    const current = await readOrNull(path)
    if (current === null || current === master) continue
    // the marker is the ownership proof: a creator's own file that happens to
    // sit in a runtime/ folder under a master's name is never overwritten
    if (!isVendoredCopy(current)) continue
    await dataLayerSaveFile(path, master)
    refreshed.push(path)
    if (!path.startsWith('custom/')) continue
    const folder = path.slice(0, path.indexOf(CARRIED))
    const written = byFolder.get(folder) ?? new Map<string, string>()
    written.set(path, master)
    byFolder.set(folder, written)
  }
  for (const [folder, written] of byFolder) await restampManifest(folder, written)
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
): Promise<string[]> {
  if (options.force !== true && files.includes(SPAWNER_MODULE_PATH)) {
    const current = await readOrNull(SPAWNER_MODULE_PATH)
    if (current !== null && current.includes(SPAWNER_COMPONENTS_CONTRACT)) return []
  }
  // The masters are a static glob over this build's own tree, so the walk has
  // every module the spawner reaches — no "this build is missing one" branch,
  // because that would be a build that failed its own byte-identity tests.
  const masters = shippedMasters([SPAWNER_ENTRY_REL])
  const vendored: string[] = []
  for (const rel of transitiveModules(SPAWNER_ENTRY, (rel) => masters[rel] ?? null)) {
    const path = `${REGISTRY_RUNTIME_DIR}/${rel}`
    if ((await readOrNull(path)) === masters[rel]) continue
    await dataLayerSaveFile(path, masters[rel])
    vendored.push(path)
  }
  return vendored
}

// Every script whose imports decide what the project's shared runtime holds: the
// creator's own, and a placed prefab's. Prefab scripts are scanned as FILES, not
// through the composite's Script rows — a prefab's helper module (health-respawn's
// health.ts) is imported by a Script row rather than being one, and a row-based
// scan would miss the modules it needs.
//
// A folder placed by an older build sits the whole scan out, not just its
// carried runtime/ files. Its scripts say `./runtime/x` and resolve INSIDE the
// folder, so reading those imports as the project's would vendor a second copy
// of a module the folder already holds — one project, two copies of one module,
// which is the state this whole design exists to make impossible. The folder
// rejoins the scan when its update lands: that deletes the carried copies and
// re-points the scripts at the shared one in the same swap.
function scannedScripts(files: string[]): string[] {
  const legacy = new Set(
    files.filter((p) => p.startsWith('custom/') && p.includes(CARRIED)).map((p) => p.slice(0, p.indexOf(CARRIED)))
  )
  return files.filter((p) => {
    if (!/\.tsx?$/.test(p)) return false
    if (p.startsWith(SCRIPTS_DIR)) return !p.startsWith(`${REGISTRY_RUNTIME_DIR}/`)
    if (!PREFAB_SCRIPT.test(p)) return false
    return !legacy.has(p.slice(0, p.indexOf('/scripts/')))
  })
}

/** The runtime modules the project's scripts import, as paths inside `runtime/`. */
export async function creatorRuntimeEntries(files: string[]): Promise<string[]> {
  const scripts = scannedScripts(files)
  if (scripts.length > MAX_CREATOR_SCRIPTS) return []
  const entries: string[] = []
  for (const path of scripts) {
    const text = await readOrNull(path)
    if (text === null) continue
    for (const rel of runtimeImportsOf(text)) if (!entries.includes(rel)) entries.push(rel)
  }
  return entries
}

// A runtime module the project's scripts import, and the module is on disk. One
// copy per project, under src/scripts/runtime/: a creator's script imports it as
// `./runtime/x`, a placed prefab's script climbs out of its folder to the same
// file, and this pass is the only thing between either import and a build error.
//
// The game module is the exception that needs no import (vendoring.ts): on a
// scene with a Multiplayer Server it goes in unasked, and the presence probe is
// only asked while it is missing — a shell round trip this pass would otherwise
// make after every composite write.
//
// Write-if-changed like every other pass here, and additive: a module already
// vendored for the registry is left exactly where it is. Anything the app cannot
// read is skipped rather than blocking — an unresolvable import fails the
// creator's build at the specifier they typed, which is where they can fix it.
//
// Ownership-checked like every other pass too (isVendoredCopy): the shipped tree
// has generic names — rng.ts, schedule.ts, outcomes.ts, pure/normalize.ts — so a
// creator who writes src/scripts/runtime/rng.ts is one save away from having it
// replaced by ours. Skipping is the only safe move; what the creator is TOLD is
// the second half of the problem, and `shadowed` carries it out of here.
export interface ScriptRuntimeResult {
  /** runtime modules written into src/scripts/runtime/ this pass */
  vendored: string[]
  /** paths where the creator's own file stands in a module's place, untouched */
  shadowed: string[]
}

// One sentence: the rule, then the exact next gesture. A creator who reads this
// has a file that compiles and an import that resolves again.
export function shadowedRuntimeProblem(path: string): string {
  const scripts = SCRIPTS_DIR.replace(/\/$/, '')
  return `Everything in ${REGISTRY_RUNTIME_DIR}/ is written by the editor, so your own ${path} blocks the runtime module of that name — move your file into ${scripts} and update the imports that point at it.`
}

// A pass runs after every composite write, so the same shadowed file must not
// warn on every entity drag.
const warnedShadows = new Set<string>()

export async function vendorScriptRuntime(files: string[]): Promise<ScriptRuntimeResult> {
  const entries = await creatorRuntimeEntries(files)
  const has = (rel: string): boolean => entries.includes(rel) || files.includes(`${REGISTRY_RUNTIME_DIR}/${rel}`)
  if (!has(GAME_MODULE_REL) && (await readServerPresence()) === 'present') entries.push(GAME_MODULE_REL)
  if (entries.length === 0) return { vendored: [], shadowed: [] }
  const masters = shippedMasters(entries)
  const vendored: string[] = []
  const shadowed: string[] = []
  for (const rel of Object.keys(masters).sort()) {
    const path = `${REGISTRY_RUNTIME_DIR}/${rel}`
    const current = await readOrNull(path)
    if (current === masters[rel]) continue
    if (current !== null && !isVendoredCopy(current)) {
      shadowed.push(path)
      continue
    }
    await dataLayerSaveFile(path, masters[rel])
    vendored.push(path)
  }
  for (const path of shadowed) {
    if (warnedShadows.has(path)) continue
    warnedShadows.add(path)
    log.warn(shadowedRuntimeProblem(path))
  }
  return { vendored, shadowed }
}

// The generate pass runs on composite edits and at open — neither of which a
// creator triggers by writing a script. Without this, a script that reaches for
// a runtime module has none beside it until something unrelated moves, and the
// file a creator just made opens with a red import.
export async function ensureScriptRuntime(): Promise<ScriptRuntimeResult> {
  if (dataLayerAvailable() !== true) return { vendored: [], shadowed: [] }
  try {
    return await vendorScriptRuntime(await dataLayerListFiles())
  } catch (e) {
    log.warn('vendoring the script runtime failed', e)
    return { vendored: [], shadowed: [] }
  }
}

interface ScriptRow {
  path: string
  priority: number
  layout?: string
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
  // outside runInner on purpose: a scene with no prefabs at all skips the
  // registry entirely, and the creator's first `game` script is exactly that scene
  const carried = await vendorScriptRuntime(files)
  await maybeRefreshVendoredCopies(files)
  if (carried.vendored.length === 0 && carried.shadowed.length === 0) return result
  // never `blocked`: a shadowed module is one import that will not resolve, not a
  // reason to withhold a registry compiled from folders that are perfectly fine.
  //
  // TODO(surface): these problems reach no creator today. `GenerateResult.problems`
  // is only read when `blocked` is set (core/autosave.ts logs it), and the scene
  // checks cannot see the file either — features/editor/scene-check-context.ts
  // drops every path containing `/runtime/` from `isCheckedScript`, by design.
  // A real surface means a rule in features/editor/scene-check-rules.ts fed by a
  // context that carries the shadowed path; both are outside this module.
  return {
    ...result,
    vendored: [...result.vendored, ...carried.vendored],
    problems: [...result.problems, ...carried.shadowed.map(shadowedRuntimeProblem)]
  }
}

async function runInner(files: string[]): Promise<GenerateResult> {
  const installed = files.includes(SPAWNABLES_PATH)
  // a scene with no prefabs at all cannot have a spawnable one; skip the folder
  // reads entirely, since autosave calls this after every composite write
  if (!installed && prefabFoldersIn(files).length === 0) return nothing()

  const { prefabs, scripts } = await readProject(files)
  // artifacts an older session saved as authored keep an entity invisible with
  // no recourse; the folder still has the clean capture, so repair from it
  await healInertArtifacts(prefabs, files)
  // a scene with no prefabs must not grow a generated file it does not need;
  // one prefab is enough — every prefab is spawnable, so every prefab ships
  if (!installed && prefabs.length === 0) return nothing()

  const rendered = renderSpawnables({ prefabs, scripts, gameConfig: files.includes(GAME_CONFIG_PATH) })
  if (rendered.blocking) {
    return { ...nothing(), problems: rendered.problems, blocked: true }
  }

  // The registry's first line imports `./runtime/spawner`, so the module lands
  // before the file that calls it.
  const vendored = await vendorRegistryRuntime(files)

  let written = false
  if ((await readOrNull(SPAWNABLES_PATH)) !== rendered.text) {
    await dataLayerSaveFile(SPAWNABLES_PATH, rendered.text)
    written = true
  }
  const attached = await ensureAttached()
  return { written, attached, vendored, problems: [...rendered.problems], blocked: false }
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

// The regenerate pass only runs when something changes, but a scene can be
// OPENED already damaged — an older session's projection artifacts saved as
// authored. Healing right after the snapshot lands is what gets the entity
// visible again without asking the creator to touch anything first.
//
// Same reasoning carries the module pass: a project can arrive holding a script
// that imports the game module with no module beside it (copied in, restored from
// a repo that ignores generated files). Waiting for the next composite edit would
// mean the scene fails to build until the creator happens to move something.
setOnSnapshotReady(() => {
  void (async () => {
    try {
      const files = await dataLayerListFiles()
      const { prefabs } = await readProject(files)
      if (prefabs.length > 0) await healInertArtifacts(prefabs, files)
      await vendorScriptRuntime(files)
    } catch (e) {
      log.warn('open-time heal failed', e)
    }
  })()
})
