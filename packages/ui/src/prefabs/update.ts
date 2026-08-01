// Update a project's copy of a built-in prefab to the shipped master: overwrite
// the copy's files (main does the fs work, the folder path never changes), write
// a fresh origin-hash manifest, then re-merge the Script layouts of every placed
// instance so new params appear while edited values survive.
import { writeComponent } from '../../../scene/src/inspector'
import { state } from '../../../scene/src/state'
import { dataLayerReadFile } from '../datalayer'
import { getScriptParams } from '../script/parser'
import { log } from '../log'
import { hashPrefabFolder, readOriginHashes, writeOriginHashes } from './hashes'
import { listLibrary, projectDir } from './library'
import { listPrefabFolders, readPrefabFolder } from './storage'
import { diffAgainstManifest, mergedLayoutJson, scriptFilesOf } from './versioning'
import { CUSTOM_ASSET_COMPONENT, SCRIPT_COMPONENT, clone, isRecord } from './format'

export interface UpdatePrefabResult {
  updated: boolean
  // files the copy changed (or, with no manifest to compare against, every
  // script it carries) — reported either way, written over only with `force`
  modified: string[]
  // false when the copy has no origin-hash manifest (placed before version
  // tracking): `modified` is then "everything we cannot vouch for", not proof
  // of an edit, and the UI must say so instead of claiming they changed
  verified: boolean
}

async function findProjectCopy(id: string): Promise<string | null> {
  for (const folder of await listPrefabFolders()) {
    try {
      const { data } = await readPrefabFolder(folder)
      if (data.id === id) return folder
    } catch (e) {
      log.warn('prefab update: unreadable folder skipped', folder, e)
    }
  }
  return null
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
  const folder = await findProjectCopy(id)
  if (folder === null) throw new Error('this project has no copy of that prefab')
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

  await writeOriginHashes(updated, await hashPrefabFolder(updated))

  await remergePlacedLayouts(id)

  return { updated: true, modified, verified }
}
