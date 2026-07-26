// Hold GLTF animations still while the scene is paused.
//
// Freezing a scene stops its SYSTEMS, not its animations: playback lives on a
// Bevy AnimationPlayer driven by the engine's global animation systems, which
// know nothing about a scene's blocked set. So a paused scene keeps looping —
// distracting while editing, and it makes Stop look like it didn't work.
//
// The engine's own rule is the lever: update_animations stops every clip that
// isn't in the Animator's target state list, so an Animator with no states halts
// everything, including the default clip an animated GLTF auto-plays without one.
// We write that ENGINE-ONLY (same discipline as the pick-collider overlay), and
// put the authored value back on Play.
import { cmd } from '../cmd'
import { state } from '../state'
import { log } from '../log'

const ANIMATOR = 'Animator'
const GLTF = 'GltfContainer'

// The hold names one clip that cannot exist. update_animations builds its target
// set by looking each state's clip up in the GLTF's named clips and DROPPING the
// misses, so an Animator holding only this one resolves to no targets — and every
// clip that was playing gets stopped, including the default clip an animated GLTF
// starts on its own. Same effect as an empty state list, but recognisable: an
// Animator the user just added is `{ states: [] }` (component_default fills every
// repeated field with []), so treating "no states" as ours would have deleted a
// freshly added Animator out of the snapshot the next time we ingested.
const HOLD_CLIP = '__editor_paused__'
const STILL = JSON.stringify({ states: [{ clip: HOLD_CLIP, playing: false }] })

// id -> the Animator the scene authored, captured before we overwrote it
// (undefined when it had none, so release deletes ours instead of restoring one)
const held = new Map<string, unknown>()

export function isAnimationHeld(id: string): boolean {
  return held.has(id)
}

// A reloaded scene is a fresh engine instance with none of our engine-only writes
// on it, so what we believe we applied is no longer true. Called from the resync
// that follows a restart, next to the pick overlay's own reset.
export function resetAnimationHold(): void {
  held.clear()
}

// Drop the override from a freshly ingested snapshot so the tree, the inspector
// and the save never see it — the engine echoes our write back in later
// /crdt_snapshots.
//
// Recognised by the sentinel clip rather than the `held` set: that set belongs to
// whichever build did the writing, and the host page ingests its own snapshots
// without ever writing a hold.
export function stripAnimationHolds(snapshot: Record<string, Record<string, unknown>>): void {
  for (const comps of Object.values(snapshot)) {
    const animator = comps[ANIMATOR] as { states?: Array<{ clip?: string }> } | undefined
    if (animator?.states?.some((s) => s.clip === HOLD_CLIP) === true) delete comps[ANIMATOR]
  }
}

// Called every frame from the viewport sync. Cheap when nothing changed: it only
// writes on the transition, for entities that actually have a model.
export function syncAnimationHold(): void {
  const shouldHold = state.frozen
  for (const [id, comps] of Object.entries(state.snapshot)) {
    if (comps[GLTF] === undefined) continue
    if (shouldHold === held.has(id)) continue
    if (shouldHold) {
      // capture what the scene authored BEFORE overwriting it: our write echoes
      // back through /crdt_snapshot, and the strip above then removes it, so by
      // release time the snapshot no longer remembers the authored value
      held.set(id, comps[ANIMATOR])
      write(id, STILL, 'hold')
    } else {
      release(id, held.get(id))
      held.delete(id)
    }
  }
  // entities that went away (or lost their model) while held
  if (!shouldHold) {
    for (const id of held.keys()) {
      if (state.snapshot[id] === undefined) held.delete(id)
    }
  }
}

function release(id: string, authored: unknown): void {
  if (authored === undefined) {
    cmd.deleteComponent(id, ANIMATOR).catch((e) => log.debug('animator release failed', e))
  } else {
    write(id, JSON.stringify(authored), 'restore')
  }
}

function write(id: string, json: string, label: string): void {
  cmd.setComponent(id, ANIMATOR, json).catch((e) => log.debug(`animator ${label} failed`, e))
}
