// Prefabs: placing them into the scene, saving a selection as one, and managing
// the cross-scene library (save/delete/import/rename).
import { state, topLevelSelected } from '@scene/state'
import { writeComponent } from '@scene/inspector'
import { NAME_COMPONENT } from '@scene/custom-components'
import { TRIGGER_AREA } from '@scene/allowed-components'
import { rootLocalForWorld } from '@scene/world-pos'
import { sendToScene } from '../engine/bus'
import { dropPosition, uniqueEntityName } from '../assets'
import { CUSTOM_ASSET_COMPONENT, TRANSFORM_COMPONENT, isRecord } from '../prefabs/format'
import { instantiatePrefab } from '../prefabs/instantiate'
import { updatePrefabCopy } from '../prefabs/update'
import { blockedBySdk } from '../prefabs/sdk-gate'
import {
  createPrefabFromSelection,
  deletePrefabFolder,
  renamePrefabFolder
} from '../prefabs/storage'
import {
  commitPrefabImport,
  copyLibraryPrefabIntoProject,
  deleteLibraryPrefab,
  libraryAvailable,
  savePrefabToLibrary
} from '../prefabs/library'
import {
  refreshLibrary,
  refreshPrefabs,
  revealLibraryPrefab,
  revealPrefab
} from '../panels/prefab-store'
import { flushPendingSave } from '../core/autosave'
import { log } from '../log'
import { run } from './run'
import { syncSelectionToScene, ensureTransformTool, focusPlaced } from './selection'

function withNotes(headline: string, notes: string[]): string {
  return notes.length === 0 ? headline : `${headline} — ${notes.join('; ')}`
}

// An explicit placement, for callers that already know where the prefab goes —
// today the assistant's turn-end request executor (ai/requests.ts). Position is
// WORLD metres, the frame the AI scene roster reports; anything omitted keeps
// the ordinary behaviour (camera drop point, the prefab's own size and name).
export interface PrefabPlacement {
  position?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  name?: string
}

// Size and name overrides land as ordinary component writes on the placed root,
// so they undo, autosave and mirror exactly like a gizmo drag or an inline
// rename would. A prefab root is parented to 0, so its local scale IS its world
// size — no conversion, unlike the position.
async function applyPlacement(rootId: string, placement: PrefabPlacement): Promise<void> {
  if (placement.scale !== undefined) {
    const transform = state.snapshot[rootId]?.[TRANSFORM_COMPONENT]
    const base = typeof transform === 'object' && transform !== null ? transform : {}
    await writeComponent(rootId, TRANSFORM_COMPONENT, JSON.stringify({ ...base, scale: placement.scale }))
  }
  // The prefab already named it, and that name is in the snapshot — asking for
  // the name it just got would otherwise collide with itself and land as "… 2".
  const named = (state.snapshot[rootId]?.[NAME_COMPONENT] as { value?: string } | undefined)?.value
  if (placement.name !== undefined && placement.name !== named) {
    await writeComponent(rootId, NAME_COMPONENT, JSON.stringify({ value: uniqueEntityName(placement.name) }))
  }
}

// Place a project prefab folder at the camera drop point. Same flow as importing
// a model: the new root ends up selected, focused and under the move gizmo.
// `resolve` names the folder to place, so a library prefab can copy itself into
// the project first without repeating any of this.
// Answers with the placed root's entity id (null if nothing was placed), so a
// caller can follow the placement up without re-deriving what landed.
const placePrefab = async (
  resolve: () => Promise<{ folder: string; notes: string[] }>,
  placement?: PrefabPlacement
): Promise<string | null> => {
  state.assetBusy = true
  let rootId: string | null = null
  try {
    const { folder, notes } = await resolve()
    // a server-aware prefab in a scene without the auth-server SDK bundles fine
    // and throws at runtime — offer the install instead (prefabs/sdk-gate.ts)
    if (await blockedBySdk(folder)) return null
    const asked = placement?.position
    const drop =
      asked === undefined ? await dropPosition() : (rootLocalForWorld(state.snapshot, asked) ?? asked)
    const placed = await instantiatePrefab(folder, drop)
    rootId = placed.rootId
    if (rootId !== null && placement !== undefined) await applyPlacement(rootId, placement)
    // Only for camera drops: an explicit position is the caller's (the assistant is
    // instructed to set y so the volume reaches the ground — lifting again would
    // double it).
    if (rootId !== null && asked === undefined) await liftOntoGround(rootId)
    focusPlaced()
    notes.push(...placed.warnings)
    if (placed.permissionsAdded.length > 0) {
      notes.push(`added scene permissions: ${placed.permissionsAdded.join(', ')}`)
    }
    state.saveStatus = withNotes(`Placed ${placed.data.name}`, notes)
    // A script's server half only exists once the dev server rebuilds the
    // bundle — flushing the composite save starts that cycle right away
    // instead of at the next autosave tick (Play's waitForFreshBuild covers
    // the gap if the creator gets there first).
    if (placed.hasScripts) {
      await flushPendingSave()
      state.saveStatus = withNotes(`Placed ${placed.data.name}`, [...notes, 'rebuilding in the background — ready on next Play'])
    }
  } catch (e) {
    state.saveStatus = `place failed: ${String(e)}`
  } finally {
    state.assetBusy = false
    void sendToScene({ type: 'resync' })
    syncSelectionToScene()
    ensureTransformTool()
  }
  return rootId
}

export const uiPlacePrefab = async (
  folder: string,
  placement?: PrefabPlacement
): Promise<string | null> => placePrefab(async () => ({ folder, notes: [] }), placement)

// Save the selection as a prefab and turn the selected root into an instance of it
// (inspector::CustomAsset). The entities stay exactly where they are — nothing is
// deleted and re-created, so undo keeps working.
export const uiCreatePrefabFromSelection = async (name: string): Promise<void> => {
  const roots = topLevelSelected(state.snapshot)
  if (roots.length === 0) {
    state.saveStatus = 'select an entity to save as a prefab'
    return
  }
  state.assetBusy = true
  try {
    const created = await createPrefabFromSelection(name)
    if (roots.length === 1) {
      await run(
        writeComponent(roots[0], CUSTOM_ASSET_COMPONENT, JSON.stringify({ assetId: created.data.id }))
      )
    }
    await refreshPrefabs()
    revealPrefab(created.folder)
    const notes = [...created.warnings]
    if (roots.length > 1) notes.push('the selection has several roots, so none was marked as an instance')
    // every prefab goes straight to the cross-scene library — a project deleted from
    // the terminal must not take the only copy with it (web build: project-only)
    if (libraryAvailable()) {
      try {
        await savePrefabToLibrary(created.folder)
        await refreshLibrary()
        notes.push('also saved to your library')
      } catch (e) {
        notes.push(`could not add it to your library: ${String(e)}`)
      }
    }
    state.saveStatus = withNotes(
      `Saved ${created.data.name} — ${created.entityCount} entit${created.entityCount === 1 ? 'y' : 'ies'} in ${created.folder}`,
      notes
    )
  } catch (e) {
    state.saveStatus = `could not save the prefab: ${String(e)}`
  } finally {
    state.assetBusy = false
  }
}

// Place a library (or built-in) prefab: its folder is copied into the project
// first — a scene must carry its own prefabs to stay deployable — and then the
// project copy is instantiated like any other.
export const uiPlaceLibraryPrefab = async (
  ref: string,
  placement?: PrefabPlacement
): Promise<string | null> =>
  placePrefab(async () => {
    const copied = await copyLibraryPrefabIntoProject(ref)
    if (!copied.reused) {
      await refreshPrefabs()
      return { folder: copied.folder, notes: [`copied into ${copied.folder}`] }
    }
    if (!copied.outdatedReuse) return { folder: copied.folder, notes: [] }

    // Clicking BUILT-IN and getting an old copy is a lie: the project already had
    // one, so placement silently reused it however stale. Refresh it first — but
    // never over an edit, so this is the unforced update, which reports the files
    // it would overwrite instead of overwriting them.
    const notes: string[] = []
    if (copied.copyId === undefined) return { folder: copied.folder, notes }
    try {
      const result = await updatePrefabCopy(copied.copyId, { force: false })
      if (result.updated) {
        await refreshPrefabs()
        notes.push('updated your copy to the built-in version first')
      } else if (!result.verified) {
        // no origin manifest: the copy predates hash tracking, so every file
        // "differs" and claiming the creator edited them would be a guess
        notes.push('placed your older copy — update it from the Prefabs tab to take the new version')
      } else {
        const n = result.modified.length
        notes.push(
          `placed your older copy — ${n} file${n === 1 ? '' : 's'} you edited would be overwritten; update it from the Prefabs tab`
        )
      }
    } catch (e) {
      log.warn('could not refresh the reused prefab copy', e)
      notes.push('a newer version of this prefab exists — update it from the Prefabs tab')
    }
    return { folder: copied.folder, notes }
  }, placement)

// A TriggerArea's Transform IS its volume, and the box is centred on the entity —
// so dropping one on the ground buries its bottom half. Lift a placed volume root
// by half its height so the zone the creator sees is the zone they can walk into.
// A no-op for every other prefab.
const liftOntoGround = async (entityId: string): Promise<void> => {
  if (state.snapshot[entityId]?.[TRIGGER_AREA] === undefined) return
  const transform = state.snapshot[entityId]?.[TRANSFORM_COMPONENT]
  if (!isRecord(transform)) return
  const { position, scale } = transform
  if (!isRecord(position) || !isRecord(scale)) return
  if (typeof position.y !== 'number' || typeof scale.y !== 'number') return
  await writeComponent(
    entityId,
    TRANSFORM_COMPONENT,
    JSON.stringify({ ...transform, position: { ...position, y: position.y + scale.y / 2 } })
  )
}

// Copy a project prefab out into the cross-scene library, so the next scene can
// use it. The project keeps its own copy untouched.
export const uiSavePrefabToLibrary = async (folder: string): Promise<void> => {
  try {
    const entry = await savePrefabToLibrary(folder)
    await refreshLibrary()
    revealLibraryPrefab(entry.ref)
    state.saveStatus = `${entry.data.name} is in your library`
  } catch (e) {
    state.saveStatus = `could not add to the library: ${String(e)}`
  }
}

export const uiDeleteLibraryPrefab = async (ref: string): Promise<void> => {
  try {
    await deleteLibraryPrefab(ref)
    await refreshLibrary()
    state.saveStatus = 'Removed from your library'
  } catch (e) {
    state.saveStatus = `could not remove it: ${String(e)}`
  }
}

// Finish a staged import: main moves the downloaded folder into the library and
// we surface it. The user has already seen the scripts it carries.
export const uiCommitPrefabImport = async (token: string): Promise<void> => {
  try {
    const entry = await commitPrefabImport(token)
    await refreshLibrary()
    revealLibraryPrefab(entry.ref)
    state.saveStatus = `Imported ${entry.data.name} into your library`
  } catch (e) {
    state.saveStatus = `import failed: ${String(e)}`
  }
}

export const uiRenamePrefab = async (folder: string, name: string): Promise<void> => {
  try {
    const data = await renamePrefabFolder(folder, name)
    await refreshPrefabs()
    state.saveStatus = `Renamed to ${data.name}`
  } catch (e) {
    state.saveStatus = `rename failed: ${String(e)}`
  }
}

export const uiDeletePrefab = async (folder: string): Promise<void> => {
  try {
    await deletePrefabFolder(folder)
    await refreshPrefabs()
    state.saveStatus = `Deleted ${folder}`
  } catch (e) {
    state.saveStatus = `delete failed: ${String(e)}`
  }
}
