// A project holds ONE shared `src/scripts/runtime/`, written from this build's
// masters. A prefab that came from somewhere else — exported to a library, sent
// as a zip, pulled from GitHub — may have been authored against a newer runtime
// than this build ships. Placing it then fails the creator's build in generated
// code they never wrote, naming a module or an export that does not exist here.
//
// So refuse once, at the drop, and name the gesture that fixes it.
//
// Two cases this deliberately does NOT check, because something already decides
// them exactly:
//   - "the project's shared copy is older than the prefab" — every vendored copy
//     is byte-refreshed from this build's masters once per project connection,
//     from the pass that runs before any placement, so that state never exists;
//   - "a built-in needs a newer runtime than the build" — built-ins ship inside
//     the build, and the digest guard fails it if they disagree with the masters.
import { compareVersions, type PrefabData } from './format'
import { dataLayerListFiles, dataLayerReadFile } from '../engine/datalayer'
import { log } from '../log'
import { runtimeMaster } from './runtime-masters'
import { holdPrefab } from './sdk-gate'
import { readPrefabFolder } from './storage'
import { transitiveModules } from './vendoring'

const VERSION_MODULE_REL = 'version.ts'
// where a folder authored against an older build carries runtime modules of its own
const CARRIED = '/scripts/runtime/'
const SCRIPT_EXT = /\.tsx?$/

/**
 * The one sentence both refusals show: the rule, then the exact next gesture
 * (Home › Account › Check for updates, which every non-dev build shows whether
 * or not an update is pending).
 */
export function needsNewerStudio(prefabName: string): string {
  return `${prefabName} needs a newer Decentraland Studio than this one — run Check for updates in Home › Account, then drag it in again.`
}

/** This build's runtime version, read off the master the scenes are written from. */
export function buildRuntimeVersion(): string | null {
  const text = runtimeMaster(VERSION_MODULE_REL)
  if (text === null) return null
  const found = /RUNTIME_VERSION\s*=\s*'([^']+)'/.exec(text)
  return found === null ? null : found[1]
}

// Minor is the breaking axis while the runtime is 0.x, and `minRuntime` is
// stamped with the version a prefab was BUILT against — an upper bound on what it
// actually needs. Comparing patches would refuse prefabs that work fine.
function majorMinor(version: string): string {
  const parts = version.split('.')
  return `${parts[0] ?? '0'}.${parts[1] ?? '0'}`
}

/**
 * The refusal for a prefab that declares a runtime newer than this build, or
 * null when it can be placed. Absent `minRuntime` means no requirement — never
 * '0.0.0'-and-compare, which would refuse every prefab authored before the field
 * existed.
 */
export function runtimeRefusal(data: PrefabData, buildRuntime: string): string | null {
  if (data.minRuntime === undefined) return null
  if (data.origin?.source === 'builtin') return null
  if (compareVersions(majorMinor(data.minRuntime), majorMinor(buildRuntime)) <= 0) return null
  return needsNewerStudio(data.name)
}

/**
 * The same refusal for a prefab whose script imports a runtime module this build
 * does not ship. The closure walk already throws for that case, with no metadata
 * a creator could act on — catching it here is what turns it into the sentence.
 * Catches prefabs too old to carry `minRuntime` at all.
 *
 * `carried` answers for the modules the folder brought with it. A prefab that
 * ships its own `runtime/` module is not asking this build for anything, so it
 * is not the build's business — refusing it would turn every folder authored
 * against the old carry-your-own shape into a prefab nobody can place.
 */
export function closureRefusal(
  data: PrefabData,
  scriptText: string,
  carried: (rel: string) => string | null = () => null
): string | null {
  try {
    transitiveModules(scriptText, (rel) => runtimeMaster(rel) ?? carried(rel))
    return null
  } catch {
    return needsNewerStudio(data.name)
  }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await dataLayerReadFile(path)
  } catch {
    return null
  }
}

/**
 * The folder's own TypeScript, split into the scripts whose imports decide the
 * closure and the runtime modules the folder carries.
 *
 * Files, never the composite's Script rows: a prefab's helper module
 * (health-respawn's health.ts) is imported BY a row rather than being one, so a
 * row walk reads none of the imports that actually decide what the prefab needs.
 */
export function prefabSources(folder: string, files: string[]): { scripts: string[]; carried: string[] } {
  const own = files.filter((path) => path.startsWith(`${folder}/`) && SCRIPT_EXT.test(path))
  return {
    scripts: own.filter((path) => !path.includes(CARRIED)),
    carried: own.filter((path) => path.includes(CARRIED))
  }
}

async function refusalFor(data: PrefabData, folder: string): Promise<string | null> {
  const build = buildRuntimeVersion()
  const declared = build === null ? null : runtimeRefusal(data, build)
  if (declared !== null) return declared
  const { scripts, carried } = prefabSources(folder, await dataLayerListFiles())
  const own: Record<string, string> = {}
  for (const path of carried) {
    const text = await readOrNull(path)
    if (text !== null) own[path.slice(path.indexOf(CARRIED) + CARRIED.length)] = text
  }
  for (const path of scripts) {
    const text = await readOrNull(path)
    if (text === null) continue
    const missing = closureRefusal(data, text, (rel) => own[rel] ?? null)
    if (missing !== null) return missing
  }
  return null
}

/**
 * True when the prefab needs a newer build than this one — the caller must not
 * instantiate. Fails open: a gate that cannot read the folder must not stand
 * between a creator and a prefab that would have worked.
 */
export async function blockedByRuntime(folder: string): Promise<boolean> {
  try {
    const { data } = await readPrefabFolder(folder)
    const refusal = await refusalFor(data, folder)
    if (refusal === null) return false
    holdPrefab(folder, data.name, { kind: 'runtime', message: refusal })
    return true
  } catch (e) {
    log.warn('runtime gate skipped', folder, e)
    return false
  }
}
