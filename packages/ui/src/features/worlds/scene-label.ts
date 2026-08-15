// Scene identity inside a world: the key, the name, the colour, the order.
//
// A scene has no name of its own. Titles collide in practice — one world holds
// two scenes both titled "Tower of Madness", another holds four titled "Tarot" —
// and entityId rotates on every republish, so neither can key a section, a map
// region or a metrics row. The base coordinate can: Places and comms-gatekeeper
// both resolve a scene by (world, parcel), the gatekeeper takes a parcel, logs
// take a --position and removal takes a coordinate. Publishing
// replaces whatever stands on the same ground, so one coordinate is one scene
// for as long as that scene exists.
import { formatAgo, plural, sceneTitle } from '../../lib/format'
import type { WorldEntry, WorldScene } from './inventory'

// THE id for a scene, everywhere: section list, map region, open set, and the
// key into WorldSnapshot.byScene. Byte-identical to `sceneKey` in analytics.ts —
// scene-label.test.ts pins the two against each other, because a section that
// spells the id differently from the metrics client silently shows no numbers.
export function sceneKeyOf(w: WorldEntry, s: WorldScene): string {
  return `world:${w.name}@${s.x},${s.y}`
}

// How many scenes this world HOLDS, which is not always how many we could
// locate: the server counts a scene with no readable coordinate, and mapScene
// drops it, so `scenes.length` can sit one short of the truth. Everything that
// asks "does this world hold more than one scene" — the coordinate in a label,
// the "other scenes are unaffected" reassurance, the scene count in a sentence —
// has to ask the world, not the list. Counting the list instead is how a
// two-scene world tells a creator it holds one and then drops the warnings that
// only matter when it holds two. An unknown count is a floor, never a ceiling.
export function sceneTotalOf(w: WorldEntry): number {
  return w.sceneCount.known ? Math.max(w.sceneCount.total, w.scenes.length) : w.scenes.length
}

// True when the world holds scenes this app could not place: a page of
// /world/{name}/scenes that failed to read, or a row the server counted and
// mapScene could not give a coordinate. What is on screen is then a subset, and
// no surface may say "there is none of this here" from a subset — it says the
// list read short and stops.
export function sceneListShort(w: WorldEntry): boolean {
  return !w.sceneCount.known || w.sceneCount.total > w.scenes.length
}

// Short display name. The coordinate rides along whenever the world holds more
// than one scene — not only when two titles happen to collide, because a creator
// cannot know a collision exists until they have already acted on the wrong one.
// At a single scene the coordinate is noise: there is nothing to tell apart.
export function sceneLabel(s: WorldScene, sceneCount: number): string {
  if (sceneCount <= 1) return sceneTitle(s.title)
  if (s.title === null) return `Scene at ${s.x},${s.y}`
  return `${s.title} (${s.x},${s.y})`
}

// The same identity inside a sentence: “Tower of Madness” at 0,0. Reads as an
// object, not a heading, so destructive copy can name exactly what it will hit.
// An untitled scene has only its ground to be named by, and the phrase starts
// lowercase — callers put it mid-sentence, never at the front.
export function sceneLabelProse(s: WorldScene, sceneCount: number): string {
  if (s.title === null) return `the scene at ${s.x},${s.y}`
  return sceneCount <= 1 ? `“${s.title}”` : `“${s.title}” at ${s.x},${s.y}`
}

// Tone index for parcelTone(), derived from the coordinate rather than from the
// scene's position in an array: removing one scene must not repaint every
// survivor, and the map region and its section have to agree on a colour without
// passing an index between them. The multiplier pair is the standard spatial
// hash; `^` coerces to int32, which is what keeps the result stable.
export function sceneToneOf(s: WorldScene): number {
  return Math.abs((s.x * 73856093) ^ (s.y * 19349663)) % 6
}

// One order for the sections, the map and anything else that lists scenes: by
// coordinate, x then y. Server order is created_at ASC, so it leads with the
// world's oldest scene and reorders the whole list on a republish; ground does
// not move, so this order only changes when a scene is added or removed.
export function orderScenesByCoordinate(scenes: WorldScene[]): WorldScene[] {
  return [...scenes].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
}

// The scene a world card and a world cover borrow their face from.
//
// A world has no face of its own beyond the thumbnail set in Settings, so the
// card falls back to a scene's. The one to borrow from is the scene the creator
// touched LAST: server order is created_at ASC, and the world's oldest scene is
// the one they are least likely to recognise. A scene with no timestamp cannot
// win, but is returned when it is all there is — an unstamped scene is still a
// picture. This is the only sanctioned "one scene stands for the world", and it
// stands only for a picture and a name, never for data or a control.
export function newestScene(scenes: WorldScene[]): WorldScene | null {
  return scenes.reduce<WorldScene | null>((best, s) => {
    if (best === null) return s
    if (s.timestamp === null) return best
    return best.timestamp === null || s.timestamp > best.timestamp ? s : best
  }, null)
}

// Null unless every scene here came from the same wallet: the oldest scene's
// deployer is not the world's, and printing it as one is how a collaborator's
// world reads as the owner's.
export function commonDeployer(scenes: WorldScene[]): string | null {
  const first = scenes[0]?.deployer ?? null
  if (first === null) return null
  return scenes.every((s) => s.deployer === first) ? first : null
}

// What's live here, in one line. A world holding several scenes is not described
// by any one of them — a card that names a scene reads as "this is what the world
// is", which was only ever true of a world holding exactly one. Where a scene IS
// named it is the newest, never the head of the list: the server sends scenes
// created_at ASC, so the head is the world's oldest.
export function worldCardStatus(w: WorldEntry, total: number): string {
  const newest = newestScene(w.scenes)
  const ago = formatAgo(newest?.timestamp ?? null)
  if (total === 1 && newest !== null) {
    return ago === '' ? sceneTitle(newest.title) : `${sceneTitle(newest.title)} · ${ago}`
  }
  // formatAgo(null) is the empty string, and "3 scenes · updated " reads as a
  // sentence someone forgot to finish.
  return ago === '' ? plural(total, 'scene') : `${plural(total, 'scene')} · updated ${ago}`
}

// The same phrase at the FRONT of a sentence. `sceneLabelProse` is documented as
// mid-sentence and starts lowercase for an untitled scene, so a panel that opens
// with it has to lift the first letter rather than print "the scene at 0,0 …".
export function sceneLabelSentence(scene: WorldScene, total: number): string {
  const prose = sceneLabelProse(scene, total)
  return prose.charAt(0).toUpperCase() + prose.slice(1)
}
