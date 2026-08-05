// Splitting the scene's own entities into the two moments they can appear.
//
// Both folders hold ORDINARY ENTITIES — same rows, same context menu, same
// inspector, same editing. The only difference is whether the built game gets
// them: an entity marked `inspector::Inert` is left out, so it shows up only
// when your game spawns a copy of the prefab it came from. That is all the
// folder means, which is why nothing in it is a special kind of row — a prefab
// behaves the same whether it is spawned or standing in the scene.
import type { Snapshot } from '@scene/state'
import { INERT_COMPONENT } from '../prefabs/format'

export interface RootSplit {
  /** there from the moment the game starts */
  placed: string[]
  /** left out of the built game; a copy appears when something spawns it */
  spawned: string[]
}

export function splitRoots(snapshot: Snapshot, roots: string[]): RootSplit {
  const placed: string[] = []
  const spawned: string[] = []
  for (const id of roots) {
    if (snapshot[id]?.[INERT_COMPONENT] === undefined) placed.push(id)
    else spawned.push(id)
  }
  return { placed, spawned }
}

export const PLACED_TIP = 'In the scene the moment the game starts, exactly as you placed them.'

export const SPAWNED_TIP =
  'Left out when the game starts — your game spawns copies of these while it plays. Everything else about them works the same: edit them here like any other entity.'

export const SPAWNED_HIDE_TIP =
  'Hide these while you build, so the viewport shows only what the game starts with. They still spawn when it runs.'

export const SPAWNED_SHOW_TIP = 'Show these in the viewport again.'
