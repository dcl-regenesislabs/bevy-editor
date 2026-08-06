// The two sentences the Prefabs tab says about a prefab that was just created.
//
// It exists as a notice rather than a toast because a toast and the card flash
// both expire before a creator's eyes have finished crossing a tab switch, and
// "where did it go?" is the question the create gesture leaves behind.
//
// The first sentence names what the prefab now IS, the second what that means
// for the running game: a creator who has just made their first spawnable prefab
// has been told a noun, never a consequence — and the consequence is the whole
// reason an empty scene is the correct outcome here.
import type { PrefabCreated } from './prefab-store'

export function createdHead(_c: PrefabCreated): string {
  return 'is in your prefabs.'
}

export function createdDetail(c: PrefabCreated): string {
  const spawn = 'Your game can spawn copies of it too — pick it in a spawner, or spawn it from a script.'
  if (c.placement === 'unplaced') {
    return `It is not in the scene — that is normal; copies come from the prefab. ${spawn}`
  }
  return `Drag it into the viewport to place another copy. ${spawn}`
}
