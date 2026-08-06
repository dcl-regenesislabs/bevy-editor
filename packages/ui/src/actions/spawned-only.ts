// Moving an entity between the two moments it can appear.
//
// `inspector::Inert` is presence-based and editor-owned: an entity carrying it
// is left out of the built game, so a copy of it only shows up when something
// spawns the prefab it came from. Both directions go through one history entry,
// so a single undo puts the entity back where it was.
import { state, type Snapshot } from '@scene/state'
import { deleteComponent, writeComponent } from '@scene/inspector'
import { sendToScene } from '../engine/bus'
import { pushHistory, snapshotValue, withHistorySuppressed, type HistoryEntry } from '../core/history'
import { FOLDER_COMPONENT, INERT_COMPONENT } from '../prefabs/format'

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

// A folder's placement gesture speaks for its contents: the members carry their
// own markers (a spawned group is spawned member by member), so flipping only
// the folder would move the group in the TREE while the save-time projection
// kept honouring the markers underneath — "From the start" showing entities the
// built game does not contain. Walking the subtree keeps tree and game agreeing.
const subtreeOf = (snapshot: Snapshot, rootId: string): string[] => {
  const seen = new Set([rootId])
  const out = [rootId]
  for (let i = 0; i < out.length; i++) {
    const parent = Number(out[i])
    for (const id of Object.keys(snapshot)) {
      if (seen.has(id)) continue
      if ((snapshot[id]?.Transform as { parent?: number } | undefined)?.parent === parent) {
        seen.add(id)
        out.push(id)
      }
    }
  }
  return out
}

export const uiSetSpawnedOnly = async (entityId: string, on: boolean): Promise<void> => {
  const snapshot = state.snapshot
  const targets =
    snapshot[entityId]?.[FOLDER_COMPONENT] !== undefined ? subtreeOf(snapshot, entityId) : [entityId]
  const batch: HistoryEntry[] = []
  await withHistorySuppressed(async () => {
    for (const id of targets) await applySpawnedOnly(id, on, batch)
  })
  if (batch.length === 0) return
  pushHistory(batch)
  if (!state.frozen) void sendToScene({ type: 'refresh' })
}
