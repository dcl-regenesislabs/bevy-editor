// Where players appear when they enter the scene.
//
// scene.json's spawnPoints decide it, but nothing in the viewport showed them —
// so a creator could put a wall exactly where everyone materialises and only find
// out by walking in. Each point is drawn as a translucent box: a region when the
// author gave ranges, a small marker when they gave a single coordinate.
//
// Rendered on RELATION_LAYER, reusing the camera relations.ts already mirrors to
// the view — no second camera for a handful of boxes. Like everything on that
// layer it composites over the world without depth interleave, so it reads as a
// hint drawn on top rather than geometry sitting in the scene. That's the right
// trade for a region you need to see through walls to find.
import {
  engine,
  Transform,
  MeshRenderer,
  Material,
  VisibilityComponent,
  CameraLayers,
  type Entity
} from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'
import { state } from '../state'
import { RELATION_LAYER } from './relations'

// A spawn point's axis is a single number or a [min, max] range the engine picks
// randomly within. Mirrors packages/desktop/src/scene-meta.ts, which reads them.
export type SpawnAxis = number | number[]
export interface SpawnPointSpec {
  name?: string
  default?: boolean
  position?: { x?: SpawnAxis; y?: SpawnAxis; z?: SpawnAxis }
}

const COLOR = Color4.create(0.2, 0.85, 0.9, 1) // cyan, matching the overlay family
const MAX_POINTS = 8
// a single-coordinate spawn point is a point, not a volume — draw something
// big enough to see, roughly a person's footprint
const POINT_SIZE = 1

const boxes: Entity[] = []
const shown: boolean[] = []
let root: Entity | null = null

function range(v: SpawnAxis | undefined): { centre: number; size: number } {
  if (Array.isArray(v)) {
    if (v.length === 0) return { centre: 0, size: POINT_SIZE }
    const [lo, hi] = [Math.min(...v), Math.max(...v)]
    return { centre: (lo + hi) / 2, size: Math.max(POINT_SIZE, hi - lo) }
  }
  return { centre: typeof v === 'number' ? v : 0, size: POINT_SIZE }
}

export function setupSpawnAreas(): void {
  if (root !== null) return
  const r = engine.addEntity()
  Transform.create(r)
  CameraLayers.create(r, { layers: [RELATION_LAYER] })
  for (let i = 0; i < MAX_POINTS; i++) {
    const e = engine.addEntity()
    Transform.create(e, { parent: r })
    MeshRenderer.setBox(e)
    VisibilityComponent.create(e, { visible: false })
    Material.setPbrMaterial(e, {
      albedoColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b, a: 0.18 },
      emissiveColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b },
      emissiveIntensity: 0.6,
      roughness: 1
    })
    boxes.push(e)
    shown.push(false)
  }
  root = r
  engine.addSystem(updateSpawnAreas)
}

function show(i: number, on: boolean): void {
  if (shown[i] === on) return
  shown[i] = on
  VisibilityComponent.getMutable(boxes[i]).visible = on
}

function updateSpawnAreas(): void {
  if (root === null) return
  const points = state.showSpawnAreas ? state.spawnPoints.slice(0, MAX_POINTS) : []
  for (let i = 0; i < boxes.length; i++) {
    const p = points[i]
    if (p === undefined) {
      show(i, false)
      continue
    }
    const x = range(p.position?.x)
    const y = range(p.position?.y)
    const z = range(p.position?.z)
    const t = Transform.getMutable(boxes[i])
    // already converted to world space page-side (see boot.ts sendSpawnPoints):
    // this scene's transforms are world-space, scene.json's are base-relative
    t.position = Vector3.create(x.centre, y.centre + y.size / 2, z.centre)
    t.scale = Vector3.create(x.size, y.size, z.size)
    show(i, true)
  }
}
