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

// Why a resolve attempt found nothing — the difference between "the engine has
// not registered the scene yet" and "it is registered but the player is standing
// somewhere else", which look identical from a spinner.
export interface ResolveDiagnostics {
  parcel: { x: number; y: number }
  live: number // scenes the engine reports, including portables and the editor's own
  summary: string
}

function kindOf(s: LiveSceneInfo): string {
  if (s.isSuper) return 'super'
  if (s.isPortable) return 'portable'
  return 'scene'
}

function summarise(all: LiveSceneInfo[]): string {
  if (all.length === 0) return 'no scenes registered'
  return all
    .map((s) => {
      const flags = `${s.isBroken ? ' BROKEN' : ''}${s.isBlocked ? ' blocked' : ''}`
      return `${s.title === '' ? s.hash.slice(0, 8) : s.title}[${kindOf(s)}, ${s.parcels.length}p${flags}]`
    })
    .join(' ')
}

// The live, non-portable, non-system scene the player is currently standing in,
// or undefined if they are not inside an inspectable parcel scene. This mirrors
// the explorer's own `ContainingScene::get_parcel`, which the inspector console
// commands resolve to by default. The diagnostics come back either way — a miss
// is the case that needs explaining.
export async function resolveInspectableScene(): Promise<{
  scene: LiveSceneInfo | undefined
  diag: ResolveDiagnostics
}> {
  const all = (await BevyApi.liveSceneInfo()) ?? []
  const parcel = getPlayerParcel()
  const scene = all.find(
    (s) =>
      !s.isPortable &&
      !s.isSuper &&
      s.parcels.some((p) => p.x === parcel.x && p.y === parcel.y)
  )
  return { scene, diag: { parcel, live: all.length, summary: summarise(all) } }
}
