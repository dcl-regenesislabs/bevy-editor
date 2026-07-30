// Where players appear when they enter the scene.
//
// scene.json's spawnPoints decide it, but nothing in the viewport showed them —
// so a creator could put a wall exactly where everyone materialises and only find
// out by walking in. While the scene is stopped (and the ⋯ toggle is on, its
// default) every point shows a ghost persona (body + head) standing at its feet,
// like the Creator Hub's spawn figure — plus a translucent volume box when the
// point is a [min, max] random range rather than a fixed spot. When scene.json
// has no points, boot sends the resolved default spot instead (see
// sendSpawnPoints), so the persona still marks where players land.
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

// The persona: a ghost figure standing where a player will materialise —
// visible whenever the scene is stopped, no toggle needed (Creator Hub does the
// same). Proportions of a rough human: 1.45m body, head on top.
const BODY_HEIGHT = 1.45
const BODY_RADIUS = 0.24
const HEAD_RADIUS = 0.19

const boxes: Entity[] = []
const shown: boolean[] = []
const personas: Entity[] = []
const personaParts: Entity[][] = []
const personaShown: boolean[] = []
let root: Entity | null = null

function range(v: SpawnAxis | undefined): { centre: number; size: number } {
  if (Array.isArray(v)) {
    if (v.length === 0) return { centre: 0, size: POINT_SIZE }
    const [lo, hi] = [Math.min(...v), Math.max(...v)]
    return { centre: (lo + hi) / 2, size: Math.max(POINT_SIZE, hi - lo) }
  }
  return { centre: typeof v === 'number' ? v : 0, size: POINT_SIZE }
}

// One limb of a persona: translucent and faintly emissive, so it reads as a
// marker rather than as scene geometry.
function ghostPart(shape: 'cylinder' | 'sphere', parent: Entity): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent })
  if (shape === 'cylinder') MeshRenderer.setCylinder(e, BODY_RADIUS, BODY_RADIUS * 0.75)
  else MeshRenderer.setSphere(e)
  Material.setPbrMaterial(e, {
    albedoColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b, a: 0.32 },
    emissiveColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b },
    emissiveIntensity: 0.4,
    roughness: 1
  })
  return e
}

export function setupSpawnAreas(): void {
  if (root !== null) return
  const r = engine.addEntity()
  Transform.create(r)
  CameraLayers.create(r, { layers: [RELATION_LAYER] })
  // Personas live under their OWN root, deliberately OUTSIDE the overlay layer:
  // a figure should be occluded by walls exactly like the player it stands for
  // (and plain world rendering sidesteps the TextureCamera composite entirely —
  // one less thing between the marker and the screen). The range boxes stay on
  // the overlay layer, where seeing through walls is the point.
  const pr = engine.addEntity()
  Transform.create(pr)
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
  for (let i = 0; i < MAX_POINTS; i++) {
    const anchor = engine.addEntity()
    Transform.create(anchor, { parent: pr })
    const body = ghostPart('cylinder', anchor)
    const bodyT = Transform.getMutable(body)
    bodyT.position = Vector3.create(0, BODY_HEIGHT / 2, 0)
    bodyT.scale = Vector3.create(1, BODY_HEIGHT, 1)
    const head = ghostPart('sphere', anchor)
    const headT = Transform.getMutable(head)
    headT.position = Vector3.create(0, BODY_HEIGHT + HEAD_RADIUS * 1.15, 0)
    headT.scale = Vector3.create(HEAD_RADIUS * 2, HEAD_RADIUS * 2, HEAD_RADIUS * 2)
    VisibilityComponent.create(body, { visible: false })
    VisibilityComponent.create(head, { visible: false })
    personas.push(anchor)
    personaParts.push([body, head])
    personaShown.push(false)
  }
  root = r
  engine.addSystem(updateSpawnAreas)
}

function showPersona(i: number, on: boolean): void {
  if (personaShown[i] === on) return
  personaShown[i] = on
  for (const part of personaParts[i]) VisibilityComponent.getMutable(part).visible = on
}

function show(i: number, on: boolean): void {
  if (shown[i] === on) return
  shown[i] = on
  VisibilityComponent.getMutable(boxes[i]).visible = on
}

// A range's feet sit at its bottom; a plain coordinate IS the feet.
function feetOf(v: SpawnAxis | undefined): number {
  if (Array.isArray(v)) return v.length === 0 ? 0 : Math.min(...v)
  return typeof v === 'number' ? v : 0
}

// Only a genuine [min, max] range earns a volume box — a single-coordinate
// point is fully told by the persona, and a 1m box around its feet is clutter.
function hasVolume(p: SpawnPointSpec): boolean {
  return [p.position?.x, p.position?.y, p.position?.z].some(
    (v) => Array.isArray(v) && v.length > 0 && Math.max(...v) - Math.min(...v) > 0
  )
}

function placeBox(i: number, p: SpawnPointSpec | undefined): void {
  if (p === undefined) {
    show(i, false)
    return
  }
  const x = range(p.position?.x)
  const y = range(p.position?.y)
  const z = range(p.position?.z)
  const t = Transform.getMutable(boxes[i])
  // already converted to world space page-side (see spawn-points.ts):
  // this scene's transforms are world-space, scene.json's are base-relative
  t.position = Vector3.create(x.centre, y.centre + y.size / 2, z.centre)
  t.scale = Vector3.create(x.size, y.size, z.size)
  show(i, true)
}

function placePersona(i: number, p: SpawnPointSpec | undefined): void {
  if (p === undefined) {
    showPersona(i, false)
    return
  }
  const t = Transform.getMutable(personas[i])
  t.position = Vector3.create(range(p.position?.x).centre, feetOf(p.position?.y), range(p.position?.z).centre)
  showPersona(i, true)
}

function updateSpawnAreas(): void {
  if (root === null) return
  const all = state.spawnPoints.slice(0, MAX_POINTS)
  // one switch for the whole overlay (on by default): personas while the scene
  // is STOPPED — that's when you're placing things where players land; range
  // boxes alongside them. Gone during play, when real avatars exist.
  const overlayOn = state.showSpawnAreas && state.frozen
  const boxPoints = overlayOn ? all.filter(hasVolume) : []
  const personaPoints = overlayOn ? all : []
  for (let i = 0; i < boxes.length; i++) {
    placeBox(i, boxPoints[i])
    placePersona(i, personaPoints[i])
  }
}
