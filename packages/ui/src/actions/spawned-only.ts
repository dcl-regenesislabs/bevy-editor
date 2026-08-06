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

const HIDE_COMPONENT = 'inspector::Hide'

/** The write alone, batched by the caller — create+mark must be ONE undo. */
export const applySpawnedOnly = async (entityId: string, on: boolean, batch: HistoryEntry[]): Promise<void> => {
  const before = snapshotValue(entityId, INERT_COMPONENT)
  if (on === (before !== undefined)) return
  batch.push({ entityId, name: INERT_COMPONENT, before, after: on ? {} : undefined })
  if (on) await writeComponent(entityId, INERT_COMPONENT, JSON.stringify({}))
  else deleteComponent(entityId, INERT_COMPONENT)
  // spawn-only starts hidden in the editor too, and moving back shows it again:
  // the built game hides these regardless, so an eye that said "visible" while
  // the viewport showed nothing was lying from the first frame. The flag is the
  // eye's source of truth, so writing it here keeps them in agreement, and it
  // rides the same batch — one undo restores both.
  const hide = { value: on }
  const hideBefore = snapshotValue(entityId, HIDE_COMPONENT)
  batch.push({ entityId, name: HIDE_COMPONENT, before: hideBefore, after: hide })
  await writeComponent(entityId, HIDE_COMPONENT, JSON.stringify(hide))
}

export const uiSetSpawnedOnly = async (entityId: string, on: boolean): Promise<void> => {
  const batch: HistoryEntry[] = []
  await withHistorySuppressed(async () => {
    await applySpawnedOnly(entityId, on, batch)
  })
  if (batch.length === 0) return
  pushHistory(batch)
  if (!state.frozen) void sendToScene({ type: 'refresh' })
}
