// Attach a script file to an entity's Script component from outside the
// inspector. The AI assistant writes src/scripts/*.ts straight to disk, which
// leaves the file orphaned — nothing runs it until it is listed on an entity.
// The CLI can't do that itself: the attachment lives in the live CRDT (the
// editor autosaves it to main.composite and never re-reads that file), so a
// disk edit would be clobbered. The renderer closes the loop instead.
import { SCRIPT_COMPONENT } from '../../../scene/src/allowed-components'
import { componentKey, state } from '../../../scene/src/state'
import { uiAddComponent, uiSetComponentValue } from '../actions'
import { dataLayerReadFile } from '../datalayer'
import { freshLayout } from './parser'

type ScriptItem = { path: string; priority: number; layout?: string }

function itemsOf(entityId: string): ScriptItem[] {
  const comp = state.snapshot[entityId]?.[SCRIPT_COMPONENT] as { value?: ScriptItem[] } | undefined
  return Array.isArray(comp?.value) ? comp.value : []
}

export function hasScript(entityId: string, path: string): boolean {
  return itemsOf(entityId).some((it) => it.path === path)
}

// Append `path` to the entity's script list. No-op when it's already there.
// Returns whether an attachment happened.
export async function attachScript(entityId: string, path: string): Promise<boolean> {
  if (state.snapshot[entityId] === undefined || hasScript(entityId, path)) return false

  let layout: string | undefined
  try {
    layout = freshLayout(await dataLayerReadFile(path))
  } catch {
    // No data layer, or the file vanished between the write and here — attach
    // anyway; the inspector's ↻ re-parses params on demand.
  }

  if (state.snapshot[entityId]?.[SCRIPT_COMPONENT] === undefined) {
    await uiAddComponent(entityId, SCRIPT_COMPONENT)
  }
  if (hasScript(entityId, path)) return false // raced with another attach

  const next = [...itemsOf(entityId), { path, priority: 0, layout }]
  await uiSetComponentValue(
    componentKey(entityId, SCRIPT_COMPONENT),
    entityId,
    SCRIPT_COMPONENT,
    JSON.stringify({ value: next })
  )
  return true
}
