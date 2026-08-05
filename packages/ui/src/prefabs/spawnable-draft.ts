// The numbers behind "how many copies, and where does the one you built live" —
// shared by the create dialog, which asks before the prefab folder exists, and
// the property sheet, which asks after. Two surfaces asking one question have to
// answer it the same way, and both used to carry their own copy of this.
import { defaultPlacement, type PlacementMode } from './placement'
import type { PrefabData, PrefabSpawnable } from './format'

export const DEFAULT_MAX = 64
export const MIN_MAX = 1
export const MAX_MAX = 1024

// A cleared field stays cleared (NaN) instead of snapping to 0 under the cursor,
// so it must never reach data.json: `JSON.stringify(NaN)` is `null`, and a null
// max is a pool that opens with no cap at all. `fallback` is what the prefab
// already had — the default only for one that has nothing yet.
export function clampMax(value: number, fallback: number = DEFAULT_MAX): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(MAX_MAX, Math.max(MIN_MAX, Math.round(value)))
}

// "Keep this one in the scene" has to resolve to a real placement, and which one
// depends on whether the prefab has a server half: "Editing only" projects the
// placed copy out of the built game and would take that half with it.
//
// Until the project's scripts are read, `keepsServerHalf` cannot see an
// isServer() branch, and guessing wrong ghosts a copy the server needs. "In the
// game" is the safe side of that coin, so an unread project takes it.
export function keptPlacement(
  data: PrefabData,
  spawnable: PrefabSpawnable | undefined,
  scriptsRead: boolean,
  scriptTexts: string[]
): PlacementMode {
  if (!scriptsRead) return 'editorAndPlay'
  const target = defaultPlacement(spawnable === undefined ? data : { ...data, spawnable }, scriptTexts)
  return target === 'unplaced' ? 'editorAndPlay' : target
}
