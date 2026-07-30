// Hand the scene scene.json's spawn points so it can draw them, converted to
// world space on the way. scene.json authors them relative to the base parcel,
// but the editor scene is a super-user scene whose transforms ARE world space
// (the same frame relations.ts and the gizmo draw in) — so an unconverted point
// would be drawn a whole scene-offset away for any scene not based at 0,0.
//
// Its own module (not boot.ts) because it must be sent TWICE: at boot, and
// again by dev-hmr whenever the editor scene reloads in place — the fresh
// instance starts with an empty spawn list, and a dev session that rebuilds the
// editor scene on every source change would otherwise never show a spawn
// marker again until a full restart.
import { launchParam, baseParcelCorner } from './launch-params'
import { sendToScene } from './bus'

// An axis is either a coordinate or a [min, max] range — both shift by the same
// offset; anything else is left exactly as authored.
function shift(v: unknown, by: number): unknown {
  if (Array.isArray(v)) return v.map((n) => (typeof n === 'number' ? n + by : n))
  if (typeof v === 'number') return v + by
  return v
}

export function sendSpawnPoints(): void {
  const raw = launchParam('spawnPoints')
  if (raw === null) return
  const base = baseParcelCorner()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    if (parsed.length === 0) {
      // no authored spawn points — players still appear somewhere (the resolved
      // default in ?spawn, already world-space). Send that as a synthetic point
      // so the viewport persona can mark it instead of showing nothing.
      const spawn = (launchParam('spawn') ?? '').split(',').map(Number)
      if (spawn.length !== 3 || !spawn.every(Number.isFinite)) return
      void sendToScene({
        type: 'spawn-points',
        points: [{ name: 'default', default: true, position: { x: spawn[0], y: spawn[1], z: spawn[2] } }]
      })
      return
    }
    const points = parsed.map((p) => {
      const point = p as { position?: { x?: unknown; y?: unknown; z?: unknown } }
      if (point.position === undefined) return point
      return {
        ...point,
        position: {
          ...point.position,
          x: shift(point.position.x, base.x),
          z: shift(point.position.z, base.z)
        }
      }
    })
    void sendToScene({ type: 'spawn-points', points })
  } catch (e) {
    console.warn('[editor-ui] could not read spawnPoints from scene.json:', e)
  }
}
