// Scene resolution happens scene-side (it needs the player's parcel); the page
// receives the resolved scene over the bus instead.
import { type LiveSceneInfo } from '../../scene/src/bevy-api/interface'

export async function getCurrentInspectableScene(): Promise<
  LiveSceneInfo | undefined
> {
  return undefined
}
