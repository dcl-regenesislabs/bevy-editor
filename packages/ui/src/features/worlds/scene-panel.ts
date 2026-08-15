// What the per-scene shell hands every scene-level section, and how the shell
// decides which scenes those are.
//
// A scene-level tab shows one card per entry of `world.scenes` and renders the
// picked scene below it. The shell owns the picker, the heading and the empty
// copy ABOVE the section; a panel renders its own body and nothing else. A panel
// never re-derives `scope`, and never reads `world.deployment` — `deployment` is
// `scenes[0]`, so reading it inside a section silently shows the oldest scene's
// data under another scene's name.
import { sceneScopeOf, type SceneScope } from './gatekeeper'
import type { WorldEntry, WorldScene } from './inventory'

export interface ScenePanelProps {
  /** The world this scene belongs to. Read `name`, `role`, `settings`, `scenes`. NEVER `deployment`. */
  world: WorldEntry

  /** THE scene this section is about. Always a member of `world.scenes`. */
  scene: WorldScene

  /**
   * The comms-gatekeeper scope for THIS scene, or null when the scene carries no
   * entityId and cannot be addressed. A panel that needs it renders its own
   * "can't address this scene" state — the shell does not hide the section.
   */
  scope: SceneScope | null
}

// The one place these props are derived. Every section gets its identity from
// here, so a panel and the card that picked it cannot spell the same scene
// differently.
export function scenePanelProps(world: WorldEntry, scene: WorldScene): ScenePanelProps {
  return { world, scene, scope: sceneScopeOf(world.name, scene) }
}

// Which cards read as picked, given what the tab is holding and which scenes are
// still live. A key naming a scene the world no longer holds is dropped here, on
// every render, rather than being cleaned up on a change nobody may have made.
//
// The two modes are deliberately asymmetric. `many` never back-fills: watching
// nothing is a real answer, so unticking the last card has to leave zero. `one`
// always reads something, so it falls back to the first live scene when the held
// key named a scene that is gone.
export function pickedKeys(live: string[], picked: string[], mode: 'one' | 'many'): string[] {
  const kept = picked.filter((k) => live.includes(k))
  if (mode === 'many' || kept.length > 0) return kept
  return live.slice(0, 1)
}

// The Logs tab keeps its own watch set, and `null` there means "not touched
// yet" — so Logs opens on the scene carried in from the last tab. The first tick
// makes the set the creator's, empty included, which is why the carried-in
// scenes are only ever a base to toggle against and never a floor.
export function nextWatched(watched: string[] | null, carriedIn: string[], key: string): string[] {
  const base = watched ?? carriedIn
  return base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
}
