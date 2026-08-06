// Where a prefab's own copy of itself sits in the project.
//
// Placement is never stored. It is read back out of the scene — does the project
// hold an instance of this prefab, and does that instance carry
// `inspector::Inert`? — so the property sheet, the card chip, the hierarchy badge
// and the scene check cannot drift apart: there is one closed set of states and
// one derivation of it.
//
// Pure: snapshot in, states out. Everything that writes lives in actions/spawned-only.ts.
import type { PrefabData } from './format'
import { prefabAssetId } from './provenance'

export interface PlacementInstance {
  entityId: string
  prefabId: string
}

/** Every prefab instance root in the scene, scanned once for all cards. */
export function sceneInstances(snapshot: Record<string, Record<string, unknown>>): PlacementInstance[] {
  const out: PlacementInstance[] = []
  for (const [entityId, components] of Object.entries(snapshot)) {
    const prefabId = prefabAssetId(components)
    if (prefabId === null) continue
    out.push({ entityId, prefabId })
  }
  return out
}

export function instancesOf(data: PrefabData, instances: PlacementInstance[]): PlacementInstance[] {
  return instances.filter((i) => i.prefabId === data.id)
}


// A script branching on isServer() has a half that only ever runs on the placed
// entity: the clone runner reproduces the client side of a prefab, and the
// Multiplayer Server only sees what the built composite contains. That is what
// makes "hide while playing" a real mistake on such a prefab, and the scene
// check imports this rather than writing the regex a second time.
export const SERVER_BRANCH = /\bisServer\s*\(/

export function keepsServerHalf(data: PrefabData, scriptTexts: string[]): boolean {
  if (data.requiresSdk === 'auth-server') return true
  return scriptTexts.some((text) => SERVER_BRANCH.test(text))
}

