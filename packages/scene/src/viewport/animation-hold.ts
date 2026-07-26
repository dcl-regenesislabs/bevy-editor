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
const STILL = JSON.stringify({ states: [] })

// entities whose Animator we're currently overriding engine-side
const held = new Set<string>()

export function isAnimationHeld(id: string): boolean {
  return held.has(id)
}

// Drop the override from a freshly ingested snapshot so the tree, the inspector
// and the save never see it — the engine echoes our write back in later
// /crdt_snapshots.
//
// Recognised by shape, not by the `held` set: that set belongs to whichever build
// did the writing, and the host page ingests its own snapshots without ever
// writing a hold. An Animator with no states is ours by construction — an
// authored one always names at least one state, since with none it does nothing.
export function stripAnimationHolds(snapshot: Record<string, Record<string, unknown>>): void {
  for (const comps of Object.values(snapshot)) {
    const animator = comps[ANIMATOR] as { states?: unknown[] } | undefined
    if (animator !== undefined && (animator.states?.length ?? 0) === 0) delete comps[ANIMATOR]
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
      write(id, STILL, 'hold')
      held.add(id)
    } else {
      release(id, comps[ANIMATOR])
      held.delete(id)
    }
  }
  // entities that went away (or lost their model) while held
  if (!shouldHold) {
    for (const id of held) {
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
