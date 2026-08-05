// Update a project's copy of a built-in prefab to the shipped master: overwrite
// the copy's files (main does the fs work, the folder path never changes), write
// a fresh origin-hash manifest, then re-merge the Script layouts of every placed
// instance so new params appear while edited values survive.
import { writeComponent } from '@scene/inspector'
import { state } from '@scene/state'
import { dataLayerReadFile } from '../engine/datalayer'
import { getScriptParams } from '../script/parser'
import { log } from '../log'
import { regenerateSpawnables } from './generate'
import { hashPrefabFolder, readOriginHashes, writeOriginHashes } from './hashes'
import { listLibrary, projectDir } from './library'
import { listPrefabFolders, readPrefabFolder, writeJsonFile, type PrefabFolder } from './storage'
import { isSpawnable, readSpawnable, withSpawnable } from './spawnable'
import { diffAgainstManifest, mergedLayoutJson, scriptFilesOf } from './versioning'
import {
  CUSTOM_ASSET_COMPONENT,
  SCRIPT_COMPONENT,
  clone,
  isRecord,
  type PrefabSpawnable
} from './format'

export interface UpdatePrefabResult {
  updated: boolean
  // files the copy changed (or, with no manifest to compare against, every
  // script it carries) — reported either way, written over only with `force`
  modified: string[]
  // false when the copy has no origin-hash manifest (placed before version
  // tracking): `modified` is then "everything we cannot vouch for", not proof
  // of an edit, so the dialog finishes the update instead of warning about
  // changes it cannot substantiate
  verified: boolean
}

async function findProjectCopy(id: string): Promise<PrefabFolder | null> {
  for (const folder of await listPrefabFolders()) {
    try {
      const read = await readPrefabFolder(folder)
      if (read.data.id === id) return read
    } catch (e) {
      log.warn('prefab update: unreadable folder skipped', folder, e)
    }
  }
  return null
}

// data.json has two owners. The master owns version/name/changelog and the
// overwrite is the point of the update; `spawnable` is the editor's, written by
// the Spawnable toggle and shipped by almost no master — so a plain overwrite
// un-spawnables the copy, the next regeneration drops its alias out of
// src/scripts/spawnables.ts, and every `Spawnables.<Alias>` the creator wrote
// stops compiling with nothing tying it to the update they accepted.
async function restoreSpawnable(
  folder: string,
  after: PrefabFolder,
  before: PrefabSpawnable | null
): Promise<void> {
  if (before === null || isSpawnable(after.data)) return
  await writeJsonFile(`${folder}/data.json`, withSpawnable(after.data, before))
}

async function remergePlacedLayouts(id: string): Promise<void> {
  for (const [entityId, components] of Object.entries(state.snapshot)) {
    const marker = components[CUSTOM_ASSET_COMPONENT]
    if (!isRecord(marker) || marker.assetId !== id) continue
    const script = components[SCRIPT_COMPONENT]
    if (!isRecord(script) || !Array.isArray(script.value)) continue
    const next = clone(script)
    let changed = false
    for (const item of next.value as unknown[]) {
      if (!isRecord(item) || typeof item.path !== 'string') continue
      try {
        const fresh = getScriptParams(await dataLayerReadFile(item.path))
        const layout = mergedLayoutJson(fresh, typeof item.layout === 'string' ? item.layout : undefined)
        if (layout !== item.layout) {
          item.layout = layout
          changed = true
        }
      } catch (e) {
        log.warn('prefab update: could not re-parse', item.path, e)
      }
    }
    if (changed) await writeComponent(entityId, SCRIPT_COMPONENT, JSON.stringify(next))
  }
}

export async function updatePrefabCopy(
  id: string,
  opts: { force?: boolean } = {}
): Promise<UpdatePrefabResult> {
  const copy = await findProjectCopy(id)
  if (copy === null) throw new Error('this project has no copy of that prefab')
  const folder = copy.folder
  const spawnable = readSpawnable(copy.data)
  const master = (await listLibrary()).find((e) => e.scope === 'builtin' && e.data.id === id)
  if (master === undefined) throw new Error('that prefab has no built-in master to update from')

  const manifest = await readOriginHashes(folder)
  const verified = manifest !== null
  const current = await hashPrefabFolder(folder)
  const modified =
    manifest === null ? scriptFilesOf(Object.keys(current)) : diffAgainstManifest(manifest, current)
  if (modified.length > 0 && opts.force !== true) return { updated: false, modified, verified }

  const updateCopy = window.editorShell?.prefabLibraryUpdateCopy
  if (updateCopy === undefined) throw new Error('updating prefabs needs the desktop app')
  const project = projectDir()
  if (project === null) throw new Error('no project is open')
  const updated = await updateCopy(master.ref, project)
  if (updated === null) throw new Error('the project copy disappeared while updating')

  const after = await readPrefabFolder(updated)
  await restoreSpawnable(updated, after, spawnable)

  // hashed after the restore on purpose: `spawnable` is the editor's field, it
  // never conflicts with the master, so a copy carrying it still reads pristine
  await writeOriginHashes(updated, await hashPrefabFolder(updated))

  await remergePlacedLayouts(id)

  // the registry compiles its snapshots out of the folders, and this one just
  // changed underneath it
  if (spawnable !== null || isSpawnable(after.data)) {
    try {
      await regenerateSpawnables()
    } catch (e) {
      log.warn('prefab update: regenerateSpawnables failed', e)
    }
  }

  return { updated: true, modified, verified }
}
