// Where a prefab's own copy of itself sits in the project.
//
// Placement is never stored. It is read back out of the scene — does the project
// hold an instance of this prefab, and does that instance carry
// `inspector::Inert`? — so the property sheet, the card chip, the hierarchy badge
// and the scene check cannot drift apart: there is one closed set of states and
// one derivation of it.
//
// Pure: snapshot in, states out. Everything that writes lives in actions/ghost.ts.
import { INERT_COMPONENT, type PrefabData } from './format'
import { prefabAssetId } from './provenance'

export type PlacementMode = 'unplaced' | 'editorAndPlay' | 'editingOnly'

export const PLACEMENT_MODES: readonly PlacementMode[] = ['unplaced', 'editorAndPlay', 'editingOnly']

// "Editor & Play" named the editor's own modes, which is the one thing a creator
// reading this control is not asking about. The question is what the running game
// sees, so the label answers that.
export const PLACEMENT_LABEL: Record<PlacementMode, string> = {
  unplaced: 'Unplaced',
  editorAndPlay: 'In the game',
  editingOnly: 'Editing only'
}

// Each tip is a whole sentence that survives having a count appended to it (the
// sheet adds "One copy is placed right now.", the card chip adds "(2 instances)"),
// so none of them may end in a clause the count would contradict.
export const PLACEMENT_TIP: Record<PlacementMode, string> = {
  unplaced:
    'No copy of this sits in the scene. Your game makes its own while it runs, straight from the prefab — the usual state for a spawnable prefab.',
  editorAndPlay:
    'A copy you placed sits in the scene and the running game sees it, so it is there from the moment the game starts.',
  editingOnly:
    'A copy you placed sits in the scene for you to edit in place. The running game never sees it — players only get the copies made from the prefab.'
}

export interface PlacementInstance {
  entityId: string
  prefabId: string
  inert: boolean
}

/** Every prefab instance root in the scene, scanned once for all cards. */
export function sceneInstances(snapshot: Record<string, Record<string, unknown>>): PlacementInstance[] {
  const out: PlacementInstance[] = []
  for (const [entityId, components] of Object.entries(snapshot)) {
    const prefabId = prefabAssetId(components)
    if (prefabId === null) continue
    out.push({ entityId, prefabId, inert: components[INERT_COMPONENT] !== undefined })
  }
  return out
}

export function instancesOf(data: PrefabData, instances: PlacementInstance[]): PlacementInstance[] {
  return instances.filter((i) => i.prefabId === data.id)
}

// A single live instance makes the whole prefab "In the game": what the state
// answers is "does a copy of this exist when the game starts", and one does.
export function placementOf(data: PrefabData, instances: PlacementInstance[]): PlacementMode {
  const mine = instancesOf(data, instances)
  if (mine.length === 0) return 'unplaced'
  return mine.some((i) => !i.inert) ? 'editorAndPlay' : 'editingOnly'
}

export function placementIn(
  data: PrefabData,
  snapshot: Record<string, Record<string, unknown>>
): { placement: PlacementMode; count: number } {
  const mine = instancesOf(data, sceneInstances(snapshot))
  return { placement: placementOf(data, mine), count: mine.length }
}

// A script branching on isServer() has a half that only ever runs on the placed
// entity: the clone runner reproduces the client side of a prefab, and the
// Multiplayer Server only sees what the built composite contains. Kept here, and
// imported by the scene check, so the sheet's default and the lint agree by
// construction rather than by two people writing the same regex.
export const SERVER_BRANCH = /\bisServer\s*\(/

export function keepsServerHalf(data: PrefabData, scriptTexts: string[]): boolean {
  if (data.requiresSdk === 'auth-server') return true
  return scriptTexts.some((text) => SERVER_BRANCH.test(text))
}

// Turning Spawnable on asks "keep a placed copy as an anchor?". A per-player
// prefab always says yes — its placed copy is where the server-side validators
// and the pool guard live (Player Rig), and without it the per-player pool has no
// owner. A big on-demand pool says no: 64 zombies standing in the editor is not
// an anchor, it is a scene nobody can work in.
//
// (The plan's chain reads max>8 first; per-player has to win it, because the one
// prefab that is both is exactly the case the anchor exists for.)
export function defaultKeepAnchor(data: PrefabData): boolean {
  const spawnable = data.spawnable
  if (spawnable === undefined) return false
  if (spawnable.instancing === 'perPlayer') return true
  return spawnable.max <= 8
}

// "Keep the anchor" means In the game whenever the prefab has a server half —
// Editing only projects the instance out of the built composite, which would take
// the server half with it. That is the wave-1 Player Rig bug, closed here and
// checked by `editing-only-server-half`.
export function defaultPlacement(data: PrefabData, scriptTexts: string[]): PlacementMode {
  if (!defaultKeepAnchor(data)) return 'unplaced'
  return keepsServerHalf(data, scriptTexts) ? 'editorAndPlay' : 'editingOnly'
}
