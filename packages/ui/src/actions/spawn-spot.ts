// The 'custom spot' where-mode is authored by positioning a real marker: when
// the creator picks it, a "Spawn Spot" child appears under the Spawner carrying
// the spawned prefab's own model, so they aim the actual bed — not a blind disc
// — with the ordinary gizmos. The Spawner script reads the marker's world
// transform at spawn time and hides it in EVERY mode the moment the game runs;
// its collision masks are zeroed at creation so the ghost never blocks a player.
//
// The marker is an ordinary authored entity on purpose: selection, gizmos, undo
// and the composite all work on it for free, and switching `where` away from
// custom leaves it in the tree — deleting something the creator positioned
// because a dropdown changed would be hostile. It is simply ignored (and hidden
// at runtime) until the setting comes back.
//
// Placement uniquifies entity names, so the marker is found by name PREFIX on
// both sides — a second spawner's "Spawn Spot 2" still counts as a marker, and
// only children of the one spawner are ever scanned.
import { state, setSelected } from '@scene/state'
import { createEntities, writeComponent } from '@scene/inspector'
import { NAME_COMPONENT } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { uniqueEntityName } from '../assets'
import { prefabStore } from '../panels/prefab-store'
import { readPrefabFolder } from '../prefabs/storage'
import { revealInTree } from '../panels/reveal'
import { ensureTransformTool, syncSelectionToScene } from './selection'
import { parseLayout, type ScriptParam } from '../script/parser'
import type { ScriptItem } from '../script/attach'

export const SPAWN_SPOT_NAME = 'Spawn Spot'
const WHERE_CUSTOM = 'custom spot'
const GLTF = 'GltfContainer'

function isSpawnerScript(path: string): boolean {
  return /(^|\/)spawner\.ts$/.test(path) && !path.includes('/runtime/')
}

// A second sync for the same spawner before the first one's entity echoes into
// the snapshot would create a twin marker; the guard makes the flip idempotent.
const inFlight = new Set<string>()

/**
 * Called after every spawner param write, from every path that writes one — the
 * inspector dropdown and the assistant's request executor alike. Two changes
 * matter: `where` flipping to 'custom spot' materializes (or re-adopts) the
 * marker, and a `spawn` change while custom swaps the marker's model. `aim`
 * moves the selection onto the marker so the gizmos land on it — right for the
 * inspector gesture, wrong mid-assistant-turn.
 */
export const uiSyncSpawnSpot = async (
  entityId: string,
  scriptPath: string,
  changed: readonly string[],
  params: Record<string, ScriptParam | undefined>,
  opts: { aim?: boolean } = {}
): Promise<void> => {
  if (!isSpawnerScript(scriptPath)) return
  if (stringOf(params.where?.value) !== WHERE_CUSTOM) return
  if (!changed.includes('where') && !changed.includes('spawn')) return
  if (inFlight.has(entityId)) return
  inFlight.add(entityId)
  try {
    await ensureSpawnSpot(entityId, stringOf(params.spawn?.value), opts.aim === true, changed.includes('where'))
  } finally {
    inFlight.delete(entityId)
  }
}

/**
 * The executor's entry: after setScriptParams lands, read the spawner row back
 * out of the snapshot instead of asking the caller to thread path and layout.
 */
export const uiSyncSpawnSpotFromSnapshot = async (entityId: string, changed: readonly string[]): Promise<void> => {
  const row = spawnerRowOf(entityId)
  if (row === null) return
  await uiSyncSpawnSpot(entityId, row.path, changed, row.params)
}

function spawnerRowOf(entityId: string): { path: string; params: Record<string, ScriptParam | undefined> } | null {
  const rows = (state.snapshot[entityId]?.[SCRIPT_COMPONENT] as { value?: ScriptItem[] } | undefined)?.value ?? []
  const row = rows.find((item) => isSpawnerScript(item.path))
  if (row === undefined) return null
  return { path: row.path, params: parseLayout(row.layout)?.params ?? {} }
}

async function ensureSpawnSpot(entityId: string, spawn: string, aim: boolean, whereChanged: boolean): Promise<void> {
  const existing = spawnSpotChildOf(entityId)
  if (existing !== null) {
    // model follows the spawn param; re-picking custom re-aims the gizmos
    await writeComponent(existing, GLTF, JSON.stringify(await previewModel(spawn)))
    if (aim && whereChanged) aimAt(existing)
    return
  }
  const ids = await createEntities([
    {
      Transform: {
        // In front of the spawner, not on it — a marker born inside the disc
        // reads as nothing having happened.
        position: { x: 0, y: 0, z: 1 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        parent: Number(entityId)
      },
      [NAME_COMPONENT]: { value: uniqueEntityName(SPAWN_SPOT_NAME) },
      [GLTF]: await previewModel(spawn)
    }
  ])
  if (ids.length > 0 && aim) aimAt(String(ids[0]))
}

function aimAt(spotId: string): void {
  setSelected([spotId])
  state.activeEntity = spotId
  revealInTree(spotId)
  syncSelectionToScene()
  ensureTransformTool()
  state.saveStatus = 'position the Spawn Spot — copies appear where you leave it'
}

function spawnSpotChildOf(entityId: string): string | null {
  const parent = Number(entityId)
  const prefix = SPAWN_SPOT_NAME.toLowerCase()
  for (const [id, comps] of Object.entries(state.snapshot)) {
    if ((comps?.Transform as { parent?: number } | undefined)?.parent !== parent) continue
    const name = (comps?.[NAME_COMPONENT] as { value?: string } | undefined)?.value ?? ''
    if (name.trim().toLowerCase().startsWith(prefix)) return id
  }
  return null
}

/**
 * The marker's GltfContainer: the picked prefab's own model with both collision
 * masks zeroed, so the ghost is visible in the editor but never collides. A
 * prefab with no model (or nothing picked yet) leaves an empty src — the marker
 * still exists and positions; it just shows nothing.
 */
async function previewModel(prefabId: string): Promise<Record<string, unknown>> {
  const src = prefabId === '' ? null : await modelSrcOf(prefabId)
  return { src: src ?? '', visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 }
}

async function modelSrcOf(prefabId: string): Promise<string | null> {
  const entry = prefabStore.items.find((item) => item.data.id === prefabId)
  if (entry === undefined) return null
  try {
    const { composite } = await readPrefabFolder(entry.folder)
    const gltf = composite.components.find((c) => c.name === 'core::GltfContainer')
    if (gltf === undefined) return null
    // the root's model when it has one, else the first — a preview, not a clone
    const rows = Object.keys(gltf.data).sort((a, b) => Number(a) - Number(b))
    for (const key of rows) {
      const src = (gltf.data[key]?.json as { src?: unknown } | undefined)?.src
      if (typeof src === 'string' && src !== '') return src.replace('{assetPath}', entry.folder)
    }
    return null
  } catch {
    return null
  }
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
