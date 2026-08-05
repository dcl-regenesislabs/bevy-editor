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

export function createdHead(c: PrefabCreated): string {
  return c.max === null ? 'is in your prefabs.' : 'is a spawnable prefab.'
}

export function createdDetail(c: PrefabCreated): string {
  if (c.max === null) return 'Drag it into the viewport to place another copy.'
  if (c.instancing === 'perPlayer') {
    return `Every player gets a copy of it when they join. Room for ${c.max} players.`
  }
  const cap = `Your game can make up to ${c.max} copies of it while it runs.`
  if (c.placement === 'editorAndPlay') return `${cap} The one you built stays in the scene.`
  if (c.placement === 'editingOnly') {
    return `${cap} The one you built stays dimmed for editing — the running game never sees it.`
  }
  return `${cap} It is not in the scene — that is normal; copies come from the prefab.`
}
