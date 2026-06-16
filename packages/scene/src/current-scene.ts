import { Transform, engine } from '@dcl/sdk/ecs'
import { BevyApi } from './bevy-api'
import { type LiveSceneInfo } from './bevy-api/interface'

// Player parcel from the (world-space) player Transform. 16m per parcel; the z
// axis runs negative-north, matching the explorer's vec3->parcel convention.
export function getPlayerParcel(): { x: number; y: number } {
  const t = Transform.getOrNull(engine.PlayerEntity)
  if (t === null) return { x: 0, y: 0 }
  return {
    x: Math.floor(t.position.x / 16),
    y: Math.floor(t.position.z / 16)
  }
}

// The live, non-portable, non-system scene the player is currently standing in,
// or undefined if they are not inside an inspectable parcel scene. This mirrors
// the explorer's own `ContainingScene::get_parcel`, which the inspector console
// commands resolve to by default.
export async function getCurrentInspectableScene(): Promise<
  LiveSceneInfo | undefined
> {
  const all = (await BevyApi.liveSceneInfo()) ?? []
  const parcel = getPlayerParcel()
  return all.find(
    (s) =>
      !s.isPortable &&
      !s.isSuper &&
      s.parcels.some((p) => p.x === parcel.x && p.y === parcel.y)
  )
}
