// What the per-scene shell hands every scene-level section.
//
// One section is rendered per entry of `world.scenes`. The shell owns section
// identity, open/closed state, the heading and the empty copy ABOVE the section;
// a panel renders its own body and nothing else. A panel never re-derives
// `scope`, `sceneKey` or `label`, and never reads `world.deployment` —
// `deployment` is `scenes[0]`, so reading it inside a section silently shows the
// oldest scene's data under another scene's name.
import { sceneScopeOf, type SceneScope } from './gatekeeper'
import type { WorldEntry, WorldScene } from './inventory'
import { sceneKeyOf, sceneLabel, sceneTotalOf } from './scene-label'

export interface ScenePanelProps {
  /** The world this scene belongs to. Read `name`, `role`, `settings`, `scenes`. NEVER `deployment`. */
  world: WorldEntry

  /** THE scene this section is about. Always a member of `world.scenes`. */
  scene: WorldScene

  /**
   * Stable id for this section: `world:${world.name}@${scene.x},${scene.y}`.
   * Also the key into `WorldSnapshot.byScene`. Total, unlike entityId, and it
   * survives a republish.
   */
  sceneKey: string

  /**
   * Human name for this scene, carrying its coordinate whenever the world holds
   * more than one. Panels use it in sentences and errors; the heading is the
   * shell's.
   */
  label: string

  /**
   * The comms-gatekeeper scope for THIS scene, or null when the scene carries no
   * entityId and cannot be addressed. A panel that needs it renders its own
   * "can't address this scene" state — the shell does not hide the section.
   */
  scope: SceneScope | null

  /** World name, lowercased — the realm every storage/logs request is keyed by. */
  realm: string

  /** The signed-in wallet, as the shell received it (NOT lowercased — compare with `.toLowerCase()`). */
  wallet: string

  /** Whether this scene declared `authoritativeMultiplayer: true`. The gate for Logs. */
  multiplayerServer: boolean
}

// The one place these props are derived. Every section gets its identity from
// here, so a panel and the map region beside it cannot spell the same scene
// differently.
export function scenePanelProps(world: WorldEntry, scene: WorldScene, wallet: string): ScenePanelProps {
  return {
    world,
    scene,
    sceneKey: sceneKeyOf(world, scene),
    label: sceneLabel(scene, sceneTotalOf(world)),
    scope: sceneScopeOf(world.name, scene),
    realm: world.name.toLowerCase(),
    wallet,
    multiplayerServer: scene.authoritativeMultiplayer
  }
}
