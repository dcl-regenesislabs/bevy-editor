// Shared kernel of the action layer.
import { state } from '@scene/state'
import { sendToScene } from '../engine/bus'

// Await an async logic call, then (for a running scene) ask it to re-sync. The
// optimistic local-state writes inside `task` re-render the UI on their own (the
// reactive store auto-notifies). Mutations reach the scene via the
// component-written/entity-deleted bus observers (set in boot); 'refresh'
// additionally re-syncs running scenes.
export async function run(task: Promise<unknown>, notifyScene = true): Promise<void> {
  try {
    await task
  } finally {
    if (notifyScene && !state.frozen) void sendToScene({ type: 'refresh' })
  }
}
