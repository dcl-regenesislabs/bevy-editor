// The two coarse verbs behind the instance drift chip.
//
// Both work on the WHOLE subtree — there is no per-property apply in v1, so
// each one overwrites the other side wholesale. PrefabDriftDialog says so before
// either runs; nothing here should be reachable without that confirm.
//
//   Save over prefab      the instance becomes the prefab: recapture the subtree,
//                         carry every file it references into the folder (with
//                         the runtime modules those files import), rewrite
//                         composite.json, regenerate the spawnable registry.
//   Update from prefab    the prefab replaces the instance: delete the subtree,
//                         place the folder again, restore the placement transform,
//                         the name the creator gave it, and whether it was placed
//                         editing-only.
import { writeComponent } from '@scene/inspector'
import { NAME_COMPONENT } from '@scene/custom-components'
import { isRuntimeEntity, provenanceBaseline, state } from '@scene/state'
import {
  dataLayerReadFile,
  dataLayerReadFileBytes,
  dataLayerSaveFile,
  dataLayerSaveFileBytes
} from '../engine/datalayer'
import { gltfExternalUris } from '../gltf-refs'
import { log } from '../log'
import { authoredOnly, captureSelectionAsPrefab } from '../prefabs/capture'
import { instanceDrift, realignCapturedResources, type DriftResult } from '../prefabs/drift'
import { instantiatePrefab } from '../prefabs/instantiate'
import { readPrefabFolder, writeJsonFile } from '../prefabs/storage'
import { regenerateSpawnables } from '../prefabs/generate'
import {
  importSpecifiers,
  rewriteRuntimeImports,
  runtimeImportsOf,
  runtimeModuleOf,
  strandedImports
} from '../prefabs/vendoring'
import {
  INERT_COMPONENT,
  TRANSFORM_COMPONENT,
  dirOf,
  isRecord,
  type PrefabResource,
  type Vector3
} from '../prefabs/format'
import { refreshPrefabs } from '../panels/prefab-store'
import { flushPendingSave } from '../core/autosave'
import { uiDeleteEntityRecursive } from './entities'
import { uiSetSpawnedOnly } from './spawned-only'

export interface DriftVerbResult {
  ok: boolean
  warnings: string[]
}

const SCRIPT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i
const MODEL_EXT = /\.(glb|gltf)$/i
const RUNTIME_DIR = 'runtime'

// The live drift of one placed instance against the folder it came from — the
// chip's status, and what the dialog shows before either verb runs.
export async function instanceDriftFor(folder: string, rootId: string): Promise<DriftResult> {
  const { composite } = await readPrefabFolder(folder)
  const baseline = provenanceBaseline()
  return instanceDrift(state.snapshot, rootId, composite, {
    folder,
    isRuntime: (id) => isRuntimeEntity(id, baseline)
  })
}

// --- carrying files into the folder ---

function joinPosix(dir: string, relative: string): string {
  const out: string[] = dir === '' ? [] : dir.split('/')
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

// Where the script's own `runtime/` directory sits: `./runtime/x` and a nested
// script's `../runtime/x` name the same modules from different depths.
function runtimeDirOf(text: string, fromDir: string): string | null {
  for (const specifier of importSpecifiers(text)) {
    if (runtimeModuleOf(specifier) === null) continue
    const i = specifier.lastIndexOf(`${RUNTIME_DIR}/`)
    return joinPosix(fromDir, specifier.slice(0, i + RUNTIME_DIR.length + 1))
  }
  return null
}

function siblingModule(fromRel: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const joined = joinPosix(dirOf(fromRel), specifier)
  if (joined === '') return null
  return /\.tsx?$/.test(joined) ? joined : `${joined}.ts`
}

// A script only works in its new home if the modules it imports travel with it —
// the same "installing operations carry modules" invariant prefab drop and the
// Spawnable toggle follow. Walked transitively over the data layer: a runtime
// module imports its own pure/ half, which the entry script never names.
// (vendoring.ts's transitiveModules does this over a synchronous reader; file
// reads here are promises, so the same walk runs against the data layer.)
async function carryModules(
  entryText: string,
  fromDir: string,
  toDir: string,
  warnings: string[]
): Promise<void> {
  const queue = runtimeImportsOf(entryText)
  if (queue.length === 0) return
  const sourceDir = runtimeDirOf(entryText, fromDir)
  if (sourceDir === null) return
  const done = new Set<string>()
  while (queue.length > 0) {
    const rel = queue.shift() as string
    if (done.has(rel)) continue
    done.add(rel)
    let text: string
    try {
      text = await dataLayerReadFile(`${sourceDir}/${rel}`)
    } catch (e) {
      warnings.push(`the script needs ${RUNTIME_DIR}/${rel}, which could not be carried over`)
      log.warn('save over prefab: runtime module unreadable', `${sourceDir}/${rel}`, e)
      continue
    }
    await dataLayerSaveFile(`${toDir}/${RUNTIME_DIR}/${rel}`, text)
    for (const specifier of importSpecifiers(text)) {
      const dep = siblingModule(rel, specifier)
      if (dep !== null && !done.has(dep)) queue.push(dep)
    }
  }
}

async function copyScript(folder: string, resource: PrefabResource, warnings: string[]): Promise<void> {
  const target = `${folder}/${resource.rel}`
  const fromDir = dirOf(resource.source)
  const toDir = dirOf(target)
  const text = await dataLayerReadFile(resource.source)
  await dataLayerSaveFile(target, rewriteRuntimeImports(text, fromDir, toDir))
  // only runtime/ specifiers are re-pointed; anything else relative stays behind
  for (const spec of strandedImports(text, fromDir, toDir)) {
    warnings.push(
      `${resource.rel} imports '${spec}', which does not travel with it — a prefab folder has to be self-contained`
    )
  }
  await carryModules(text, fromDir, toDir, warnings)
}

async function copyBinary(folder: string, resource: PrefabResource, warnings: string[]): Promise<void> {
  const bytes = await dataLayerReadFileBytes(resource.source)
  await dataLayerSaveFileBytes(`${folder}/${resource.rel}`, bytes)
  if (!MODEL_EXT.test(resource.source)) return
  // a model's external images and buffers are resolved relative to it
  const sourceDir = dirOf(resource.source)
  const targetDir = dirOf(resource.rel)
  for (const uri of gltfExternalUris(resource.source, bytes)) {
    const from = sourceDir === '' ? uri : `${sourceDir}/${uri}`
    const to = targetDir === '' ? uri : `${targetDir}/${uri}`
    try {
      await dataLayerSaveFileBytes(`${folder}/${to}`, await dataLayerReadFileBytes(from))
    } catch (e) {
      warnings.push(`${resource.rel} references ${uri}, which could not be bundled`)
      log.warn('save over prefab: model reference unreadable', from, e)
    }
  }
}

async function carryResources(
  folder: string,
  resources: PrefabResource[],
  warnings: string[]
): Promise<void> {
  for (const resource of resources) {
    // already the folder's own file: realignCapturedResources kept its path, so
    // copying would only file a second copy somewhere shallower
    if (resource.source === `${folder}/${resource.rel}`) continue
    try {
      if (SCRIPT_EXT.test(resource.source)) await copyScript(folder, resource, warnings)
      else await copyBinary(folder, resource, warnings)
    } catch (e) {
      warnings.push(`could not bundle ${resource.source}: ${String(e)}`)
      log.warn('save over prefab: resource unreadable', resource.source, e)
    }
  }
}

// --- the verbs ---

export const uiSaveOverPrefab = async (
  folder: string,
  rootId: string
): Promise<DriftVerbResult> => {
  state.assetBusy = true
  const warnings: string[] = []
  try {
    const { data } = await readPrefabFolder(folder)
    const baseline = provenanceBaseline()
    const authored = authoredOnly(state.snapshot, (id) => isRuntimeEntity(id, baseline))
    if (authored[rootId] === undefined) {
      throw new Error('that instance is not in the scene any more')
    }
    const captured = captureSelectionAsPrefab(authored, [rootId])
    warnings.push(...captured.warnings)
    const realigned = realignCapturedResources(captured.composite, captured.resources, folder)

    // files first: a composite.json pointing at files that never arrived is a
    // prefab that places broken
    await carryResources(folder, realigned.resources, warnings)
    await writeJsonFile(`${folder}/composite.json`, realigned.composite)

    await refreshPrefabs()
    await regenerate(warnings)
    state.saveStatus = withNotes(`${data.name} now matches this instance`, warnings)
    return { ok: true, warnings }
  } catch (e) {
    state.saveStatus = `could not save over the prefab: ${String(e)}`
    return { ok: false, warnings }
  } finally {
    state.assetBusy = false
  }
}

function positionOf(transform: unknown): Vector3 {
  const position = isRecord(transform) ? transform.position : undefined
  if (!isRecord(position)) return { x: 0, y: 0, z: 0 }
  return {
    x: typeof position.x === 'number' ? position.x : 0,
    y: typeof position.y === 'number' ? position.y : 0,
    z: typeof position.z === 'number' ? position.z : 0
  }
}

export const uiUpdateInstanceFromPrefab = async (
  folder: string,
  rootId: string
): Promise<DriftVerbResult> => {
  state.assetBusy = true
  const warnings: string[] = []
  try {
    const components = state.snapshot[rootId]
    if (components === undefined) throw new Error('that instance is not in the scene any more')
    // the placement is the instance's, not the prefab's: a single-root prefab
    // carries no root Transform at all, so where it sits could not come back
    // from the folder
    const transform = components[TRANSFORM_COMPONENT]
    const named = components[NAME_COMPONENT]
    const name = isRecord(named) && typeof named.value === 'string' ? named.value : undefined
    // Placement is the instance's too, and it is stored nowhere else: the ghost
    // markers are excluded from the folder on purpose, so a re-placed anchor
    // comes back "In the game" and starts running its scripts in the built
    // scene unless the state is carried across by hand.
    const ghosted = components[INERT_COMPONENT] !== undefined

    await uiDeleteEntityRecursive(rootId)
    const placed = await instantiatePrefab(folder, positionOf(transform))
    warnings.push(...placed.warnings)
    if (placed.rootId === null) throw new Error('the prefab could not be placed again')

    if (isRecord(transform)) {
      await writeComponent(placed.rootId, TRANSFORM_COMPONENT, JSON.stringify(transform))
    }
    // the old entity is gone, so its name is free again — the instance keeps the
    // one the creator gave it instead of collecting a " 2"
    if (name !== undefined) {
      await writeComponent(placed.rootId, NAME_COMPONENT, JSON.stringify({ value: name }))
    }
    if (ghosted) await uiSetSpawnedOnly(placed.rootId, true)
    if (placed.hasScripts) await flushPendingSave()

    await regenerate(warnings)
    state.saveStatus = withNotes(`${placed.data.name} is back to the prefab`, warnings)
    return { ok: true, warnings }
  } catch (e) {
    state.saveStatus = `could not update from the prefab: ${String(e)}`
    return { ok: false, warnings }
  } finally {
    state.assetBusy = false
  }
}

// The registry compiles its snapshots out of the folders, so both verbs invalidate
// it — but a scene with no spawnable prefabs has nothing to regenerate, and a
// generation problem must not fail the save that already landed.
async function regenerate(warnings: string[]): Promise<void> {
  try {
    await regenerateSpawnables()
  } catch (e) {
    warnings.push('the spawnable registry could not be regenerated')
    log.warn('drift verb: regenerateSpawnables failed', e)
  }
}

function withNotes(headline: string, notes: string[]): string {
  return notes.length === 0 ? headline : `${headline} — ${notes.join('; ')}`
}
