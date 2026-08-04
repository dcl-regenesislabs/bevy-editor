// Attach a script file to an entity's Script component from outside the
// inspector. The AI assistant writes src/scripts/*.ts straight to disk, which
// leaves the file orphaned — nothing runs it until it is listed on an entity.
// The CLI can't do that itself: the attachment lives in the live CRDT (the
// editor autosaves it to main.composite and never re-reads that file), so a
// disk edit would be clobbered. The renderer closes the loop instead.
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import { componentKey, state } from '@scene/state'
import { uiAddComponent, uiSetComponentValue } from '../actions/components'
import { dataLayerReadFile } from '../engine/datalayer'
import { freshLayout } from './parser'

export type ScriptItem = { path: string; priority: number; layout?: string }

/** The entity's attached scripts, in priority order as authored. Empty when it has none. */
export function scriptItems(entityId: string): ScriptItem[] {
  const comp = state.snapshot[entityId]?.[SCRIPT_COMPONENT] as { value?: ScriptItem[] } | undefined
  return Array.isArray(comp?.value) ? comp.value : []
}

export function hasScript(entityId: string, path: string): boolean {
  return scriptItems(entityId).some((it) => it.path === path)
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

  const next = [...scriptItems(entityId), { path, priority: 0, layout }]
  await uiSetComponentValue(
    componentKey(entityId, SCRIPT_COMPONENT),
    entityId,
    SCRIPT_COMPONENT,
    JSON.stringify({ value: next })
  )
  return true
}
