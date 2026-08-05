// The create-prefab dialog's pure half: the copy it shows and the two questions
// it has to answer before the prefab folder exists.
//
// Both create gestures (plain and spawnable) submit once, so the dialog is where
// "keep this one in the scene?" gets asked — the sheet's two-step version only
// survives for the toggle-on-an-existing-prefab path, which has no dialog to
// fold it into.
import { entityName } from '@scene/custom-components'
import { SCRIPT_COMPONENT } from '@scene/allowed-components'
import type { Snapshot } from '@scene/state'
import { isRecord } from '../prefabs/format'

export const CREATE_LEAD =
  'A spawnable prefab is one your game copies while it runs — enemies, pickups, one rig per player. It lives in your Prefabs tab, not in the scene.'

export const NO_SELECTION =
  'Select an entity in the scene first — a prefab is a copy of what you have selected.'

export const CAPTURE_TAIL =
  'are copied into a prefab folder — models, scripts and textures included — so you can drop it in again here or in another project.'

export const STAYS_PUT =
  'What you selected stays exactly where it is, and becomes a copy of the new prefab.'

// Nothing stamps inspector::CustomAsset on a multi-root capture, so there is no
// instance to remove or dim — the question would have no answer to write.
export const MULTI_ROOT_NOTE =
  'This selection has more than one top-level entity, so it stays in the scene as it is.'

export const KEEP_NOTE =
  'From the start: your selection stays right where it is — now a placed copy of the prefab, in the game from the moment it starts.'

export const KEEP_SERVER_NOTE =
  'From the start: your selection stays right where it is, now a placed copy of the prefab. Part of it runs on the Multiplayer Server, and only a placed copy runs there — this prefab needs one in the scene.'

export const KEEP_EDITING_NOTE =
  'From the start of editing, not the game: it stays where it is, dimmed, so you can keep working on it in place. Players never see this one — the game brings in copies from the prefab.'

// Deliberately promises undo: with 'unplaced' the create runs exactly one
// uiDeleteEntityRecursive, which pushes exactly one history entry.
export const PREFAB_ONLY_NOTE =
  'When spawned: it moves into your Prefabs tab, and the game brings copies in while playing — like zombies in a wave. Nothing is deleted: the prefab holds all of it, and Undo puts it back.'

export function defaultPrefabName(snapshot: Snapshot, roots: string[]): string {
  if (roots.length !== 1) return 'Prefab'
  return entityName(snapshot, roots[0]) ?? 'Prefab'
}

export function selectionLead(snapshot: Snapshot, roots: string[]): string {
  return roots.length === 1
    ? `“${entityName(snapshot, roots[0]) ?? roots[0]}” and everything under it`
    : `${roots.length} selected entities and everything under them`
}

function inSelection(snapshot: Snapshot, roots: string[], id: string): boolean {
  const seen = new Set<string>()
  let cursor = id
  while (!seen.has(cursor)) {
    if (roots.includes(cursor)) return true
    seen.add(cursor)
    const transform: unknown = snapshot[cursor]?.Transform
    const parent = isRecord(transform) ? transform.parent : undefined
    if (typeof parent !== 'number' || parent === 0) return false
    cursor = String(parent)
  }
  return false
}

// The prefab folder does not exist yet, so "the scripts this prefab will carry"
// has to be read off the selection — the pre-capture twin of the sheet's
// folderScriptTexts(). It feeds keepsServerHalf(), which is what decides whether
// keeping this one in the scene means "in the game" or "editing only".
export function selectionScriptTexts(
  snapshot: Snapshot,
  roots: string[],
  scripts: Record<string, string>
): string[] {
  const texts: string[] = []
  for (const [id, components] of Object.entries(snapshot)) {
    if (!inSelection(snapshot, roots, id)) continue
    const value = components[SCRIPT_COMPONENT]
    const rows = isRecord(value) ? value.value : undefined
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const path = isRecord(row) ? row.path : undefined
      if (typeof path !== 'string') continue
      const text = scripts[path]
      if (typeof text === 'string' && !texts.includes(text)) texts.push(text)
    }
  }
  return texts
}
