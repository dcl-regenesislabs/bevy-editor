// Moving an entity between the two moments it can appear.
//
// `inspector::Inert` is presence-based and editor-owned: an entity carrying it
// is left out of the built game, so a copy of it only shows up when something
// spawns the prefab it came from. Both directions go through one history entry,
// so a single undo puts the entity back where it was.
import { state } from '@scene/state'
import { deleteComponent, writeComponent } from '@scene/inspector'
import { sendToScene } from '../engine/bus'
import { pushHistory, snapshotValue, withHistorySuppressed, type HistoryEntry } from '../core/history'
import { INERT_COMPONENT } from '../prefabs/format'

export const uiSetSpawnedOnly = async (entityId: string, on: boolean): Promise<void> => {
  const before = snapshotValue(entityId, INERT_COMPONENT)
  if (on === (before !== undefined)) return
  const batch: HistoryEntry[] = [
    { entityId, name: INERT_COMPONENT, before, after: on ? {} : undefined }
  ]
  await withHistorySuppressed(async () => {
    if (on) await writeComponent(entityId, INERT_COMPONENT, JSON.stringify({}))
    else deleteComponent(entityId, INERT_COMPONENT)
  })
  pushHistory(batch)
  if (!state.frozen) void sendToScene({ type: 'refresh' })
}
