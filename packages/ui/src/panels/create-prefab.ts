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

export const MULTI_ROOT_NOTE =
  'This selection has more than one top-level entity, so it stays in the scene as it is.'

export const KEEP_NOTE =
  'From the start: your selection stays right where it is — now a placed copy of the prefab, in the game from the moment it starts.'

export const PREFAB_ONLY_NOTE =
  'When spawned: what you built stays right here to keep editing, in the “When spawned” folder — the game leaves it out at the start and brings in copies while it plays, like zombies in a wave.'

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

