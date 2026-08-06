// Splitting the scene's own entities into the two moments they can appear.
//
// Both folders hold ORDINARY ENTITIES — same rows, same context menu, same
// inspector, same editing. The only difference is whether the built game gets
// them: an entity marked `inspector::Inert` is left out, so it shows up only
// when your game spawns a copy of the prefab it came from. That is all the
// folder means, which is why nothing in it is a special kind of row — a prefab
// behaves the same whether it is spawned or standing in the scene.
import type { Snapshot } from '@scene/state'
import { INERT_COMPONENT, SCRIPT_COMPONENT, type PrefabData } from '../prefabs/format'
import { prefabAssetId } from '../prefabs/provenance'
import { effectiveSpawnable } from '../prefabs/spawnable'
import { refsOf } from './views/prefab-options'

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

// The prefab ids something in the scene actually brings into the game: a
// prefab-typed script setting naming them, or per-player instancing (where the
// generated registry spawns them without anything naming them).
export function usedPrefabIds(
  snapshot: Snapshot,
  prefabs: ReadonlyArray<{ data: PrefabData }>
): Set<string> {
  const used = new Set<string>()
  for (const components of Object.values(snapshot)) {
    const value = components[SCRIPT_COMPONENT] as { value?: unknown } | undefined
    const rows = Array.isArray(value?.value) ? value.value : []
    for (const row of rows) {
      const layout = (row as { layout?: unknown }).layout
      if (typeof layout !== 'string') continue
      let parsed: unknown
      try {
        parsed = JSON.parse(layout)
      } catch {
        continue
      }
      const params = (parsed as { params?: Record<string, { type?: string; value?: unknown }> }).params ?? {}
      for (const param of Object.values(params)) {
        if (param.type !== 'prefab' && param.type !== 'prefabList') continue
        for (const ref of refsOf(param.value)) used.add(ref)
      }
    }
  }
  for (const prefab of prefabs) {
    if (effectiveSpawnable(prefab.data).instancing === 'perPlayer') used.add(prefab.data.id)
  }
  return used
}

/** Entity ids in the When-spawned folder whose prefab nothing uses yet. */
export function unusedSpawnRoots(
  snapshot: Snapshot,
  spawned: string[],
  prefabs: ReadonlyArray<{ data: PrefabData }>
): Set<string> {
  const used = usedPrefabIds(snapshot, prefabs)
  const out = new Set<string>()
  for (const id of spawned) {
    const assetId = prefabAssetId(snapshot[id])
    if (assetId === null || !used.has(assetId)) out.add(id)
  }
  return out
}

export const UNUSED_SPAWN_TIP =
  'Tip: nothing brings this into the game yet. Pick it in a spawner — the Wave Director’s enemy setting, for example — and it appears while you play.'
