// Update a project's copy of a built-in prefab to the shipped master: overwrite
// the copy's files (main does the fs work, the folder path never changes), write
// a fresh origin-hash manifest, then re-merge the Script layouts of every placed
// instance so new params appear while edited values survive.
import { deleteEntityRecursive, writeComponent } from '@scene/inspector'
import { state } from '@scene/state'
import { worldTransformOf } from '@scene/world-pos'
import { dataLayerReadFile } from '../engine/datalayer'
import { dragOffset } from '../actions/record-math'
import {
  getScriptParams,
  parseLayout,
  positionOf,
  type PositionValue,
  type ScriptParam,
  type ScriptParseResult
} from '../script/parser'
import { log } from '../log'
import { regenerateSpawnables } from './generate'
import { hashPrefabFolder, readOriginHashes, writeOriginHashes } from './hashes'
import { listLibrary, projectDir } from './library'
import { listPrefabFolders, readPrefabFolder, writeJsonFile, type PrefabFolder } from './storage'
import { hasSpawnOverrides, readSpawnable, withSpawnable } from './spawnable'
import { diffAgainstManifest, mergedLayoutJson, scriptFilesOf } from './versioning'
import {
  CUSTOM_ASSET_COMPONENT,
  SCRIPT_COMPONENT,
  TRANSFORM_COMPONENT,
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
  if (before === null || hasSpawnOverrides(after.data)) return
  await writeJsonFile(`${folder}/data.json`, withSpawnable(after.data, before))
}

// A prefab's scripts are not all on its root — player-rig ships gun-hitscan on
// a child entity — so the re-merge walks the placed subtree. It stops at nested
// instance roots: an entity marked as another prefab's instance belongs to THAT
// prefab's update, and the walk not descending is what keeps two prefabs from
// rewriting each other's layouts.
function placedSubtree(rootId: string): string[] {
  const children = new Map<string, string[]>()
  for (const [entityId, components] of Object.entries(state.snapshot)) {
    const transform = components[TRANSFORM_COMPONENT]
    if (!isRecord(transform) || typeof transform.parent !== 'number') continue
    const parent = String(transform.parent)
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [entityId])
    else siblings.push(entityId)
  }
  const out: string[] = []
  const seen = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length > 0) {
    const entityId = queue.shift() as string
    out.push(entityId)
    for (const child of children.get(entityId) ?? []) {
      if (seen.has(child)) continue
      if (isRecord(state.snapshot[child]?.[CUSTOM_ASSET_COMPONENT])) continue
      seen.add(child)
      queue.push(child)
    }
  }
  return out
}

// A param the master changed from `entity` to `position` (the Moving Platform's
// destination made this move) would lose the creator's tuned marker to a fresh
// default: mergeLayout drops a value whose type stopped matching. Carry it
// instead — the referenced entity's pose relative to the script's owner IS the
// offset the new param means — and retire the marker, but only when it lives
// inside this instance's own subtree: a param retargeted at the creator's own
// scenery keeps that entity untouched.
function carryEntityParamsToPositions(
  entityId: string,
  fresh: ScriptParseResult,
  oldLayoutJson: string | undefined,
  subtree: ReadonlySet<string>,
  retire: Set<string>
): string | undefined {
  const old = parseLayout(oldLayoutJson)
  if (old === undefined) return oldLayoutJson
  let touched = false
  for (const [name, freshParam] of Object.entries(fresh.params)) {
    if (freshParam.type !== 'position') continue
    const oldParam: ScriptParam | undefined = old.params[name]
    if (oldParam?.type !== 'entity' || typeof oldParam.value !== 'number' || oldParam.value === 0) continue
    const markerId = String(oldParam.value)
    const offset = offsetForMarker(entityId, markerId)
    if (offset === null) continue
    old.params[name] = { ...freshParam, value: offset }
    if (subtree.has(markerId)) retire.add(markerId)
    touched = true
  }
  return touched ? JSON.stringify(old) : oldLayoutJson
}

// What the `position` param must hold to still mean where `markerId` sits.
// Null when the marker is gone or has no placeable pose.
function offsetForMarker(entityId: string, markerId: string): PositionValue | null {
  const marker = state.snapshot[markerId]
  if (marker === undefined) return null
  const local = marker[TRANSFORM_COMPONENT]
  if (isRecord(local) && local.parent === Number(entityId) && isRecord(local.position)) {
    // still the authored child: its local position IS the offset, verbatim
    return positionOf(local.position)
  }
  const markerWorld = worldTransformOf(state.snapshot, markerId)
  const ownerWorld = worldTransformOf(state.snapshot, entityId)
  if (markerWorld === null || ownerWorld === null) return null
  // world-metre delta, expressed in the owner's oriented frame — the same
  // "metres, never scaled" semantics the position param renders and drives
  return dragOffset({ position: ownerWorld.position, rotation: ownerWorld.rotation }, markerWorld.position)
}

async function remergeEntityLayouts(
  entityId: string,
  subtree: ReadonlySet<string>,
  retire: Set<string>
): Promise<void> {
  const script = state.snapshot[entityId]?.[SCRIPT_COMPONENT]
  if (!isRecord(script) || !Array.isArray(script.value)) return
  const next = clone(script)
  let changed = false
  for (const item of next.value as unknown[]) {
    if (!isRecord(item) || typeof item.path !== 'string') continue
    try {
      const fresh = getScriptParams(await dataLayerReadFile(item.path))
      const carried = carryEntityParamsToPositions(
        entityId,
        fresh,
        typeof item.layout === 'string' ? item.layout : undefined,
        subtree,
        retire
      )
      const layout = mergedLayoutJson(fresh, carried)
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

async function remergePlacedLayouts(id: string): Promise<void> {
  for (const [entityId, components] of Object.entries(state.snapshot)) {
    const marker = components[CUSTOM_ASSET_COMPONENT]
    if (!isRecord(marker) || marker.assetId !== id) continue
    const members = placedSubtree(entityId)
    const subtree = new Set(members)
    const retire = new Set<string>()
    for (const memberId of members) await remergeEntityLayouts(memberId, subtree, retire)
    for (const markerId of retire) {
      try {
        await deleteEntityRecursive(markerId)
      } catch (e) {
        log.warn('prefab update: could not retire the old marker', markerId, e)
      }
    }
  }
}

export async function updatePrefabCopy(
  id: string,
  opts: { force?: boolean } = {}
): Promise<UpdatePrefabResult> {
  // A running scene's snapshot holds runtime state — tween-driven transforms,
  // script-unparented helpers — and the layout migration below reads poses from
  // it. Updating is an authoring operation; do it on the authored scene only.
  if (!state.frozen) throw new Error('stop the scene before updating a prefab')
  const copy = await findProjectCopy(id)
  if (copy === null) throw new Error('this project has no copy of that prefab')
  const folder = copy.folder
  const spawnable = readSpawnable(copy.data)
  const master = (await listLibrary()).find((e) => e.scope === 'builtin' && e.data.id === id)
  if (master === undefined) throw new Error('that prefab has no built-in master to update from')

  // Both sides of this compare are the folder as it sits in the project, never
  // the master's own bytes: a placed copy's scripts import the project's shared
  // runtime, and the manifest recorded them that way when the copy landed.
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
  if (spawnable !== null || hasSpawnOverrides(after.data)) {
    try {
      await regenerateSpawnables()
    } catch (e) {
      log.warn('prefab update: regenerateSpawnables failed', e)
    }
  }

  return { updated: true, modified, verified }
}
