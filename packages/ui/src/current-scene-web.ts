// Scene resolution happens scene-side (it needs the player's parcel); the page
// receives the resolved scene over the bus instead.
import { type LiveSceneInfo } from '../../scene/src/bevy-api/interface'
import { type ResolveDiagnostics } from '../../scene/src/current-scene'

export async function resolveInspectableScene(): Promise<{
  scene: LiveSceneInfo | undefined
  diag: ResolveDiagnostics
}> {
  return {
    scene: undefined,
    diag: { parcel: { x: 0, y: 0 }, live: 0, summary: 'page-side resolve is a no-op' }
  }
}
