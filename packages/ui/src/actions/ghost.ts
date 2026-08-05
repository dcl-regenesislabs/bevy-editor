// Placement writes: making an instance a ghost, and moving a whole prefab
// between the three placement states.
//
// A ghost is two markers and half a ghost is a bug either way — `inspector::Hide`
// alone leaves an invisible entity whose scripts still run in the built scene,
// `inspector::Inert` alone leaves an object drawn in the editor that the game
// never sees. So both are written together, inside one suppressed block with one
// manual history entry: ⌘Z puts the anchor back the way it was in a single press.
import { state } from '@scene/state'
import { deleteComponent, writeComponent } from '@scene/inspector'
import { sendToScene } from '../engine/bus'
import { pushHistory, snapshotValue, withHistorySuppressed, type HistoryEntry } from '../core/history'
import { INERT_COMPONENT, type PrefabData } from '../prefabs/format'
import { instancesOf, sceneInstances, type PlacementMode } from '../prefabs/placement'
import { uiDeleteEntityRecursive } from './entities'
import { uiPlacePrefab } from './prefabs'

const HIDE_COMPONENT = 'inspector::Hide'

const GHOST_MARKERS: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: HIDE_COMPONENT, value: { value: true } },
  { name: INERT_COMPONENT, value: {} }
]

async function applyGhost(entityId: string, on: boolean, batch: HistoryEntry[]): Promise<void> {
  for (const marker of GHOST_MARKERS) {
    const before = snapshotValue(entityId, marker.name)
    if (on === (before !== undefined)) continue
    batch.push({ entityId, name: marker.name, before, after: on ? marker.value : undefined })
    if (on) await writeComponent(entityId, marker.name, JSON.stringify(marker.value))
    else deleteComponent(entityId, marker.name)
  }
}

function settle(): void {
  if (!state.frozen) void sendToScene({ type: 'refresh' })
}

export const uiSetGhost = async (entityId: string, on: boolean): Promise<void> => {
  const batch: HistoryEntry[] = []
  await withHistorySuppressed(async () => {
    await applyGhost(entityId, on, batch)
  })
  pushHistory(batch)
  settle()
}

// Moving to "Unplaced" deletes the placed copies. That is the honest meaning of
// the state — nothing placed — and it is why the sheet asks first: for a
// spawnable prefab the copies still come from the folder, but any edit made to
// the placed one and never saved over the prefab goes with it.
export const uiSetPlacement = async (
  folder: string,
  data: PrefabData,
  target: PlacementMode
): Promise<void> => {
  const mine = instancesOf(data, sceneInstances(state.snapshot))

  if (target === 'unplaced') {
    for (const instance of mine) await uiDeleteEntityRecursive(instance.entityId)
    state.saveStatus =
      mine.length === 0
        ? `${data.name} is not placed`
        : `${data.name} is unplaced — copies come from the prefab`
    return
  }

  if (mine.length === 0) {
    const rootId = await uiPlacePrefab(folder)
    if (rootId === null) return
    if (target === 'editingOnly') await uiSetGhost(rootId, true)
    return
  }

  const batch: HistoryEntry[] = []
  await withHistorySuppressed(async () => {
    for (const instance of mine) await applyGhost(instance.entityId, target === 'editingOnly', batch)
  })
  pushHistory(batch)
  settle()
  state.saveStatus =
    target === 'editingOnly'
      ? `${data.name} is placed for editing only — the running game never sees it`
      : `${data.name} is in the game`
}
