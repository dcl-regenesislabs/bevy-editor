// Sit spots are invisible at runtime (a pointer collider, no model), which makes
// them unplaceable by eye in the editor — especially the standalone Sit Spot /
// Edge Sit Spot prefabs that live on ledges and imported furniture. While the
// scene is stopped, every entity named "…Sit Spot…" gets a ghost seated persona:
// torso and head over the spot, thighs extending along its forward axis — so
// both where the avatar will sit and which way it will face are visible at a
// glance. Same visual family as the spawn-point personas (spawn-area.ts), in the
// prefab accent so the two overlays don't read as the same thing.
import {
  engine,
  Transform,
  MeshRenderer,
  Material,
  VisibilityComponent,
  type Entity
} from '@dcl/sdk/ecs'
import { Vector3, type Color4 } from '@dcl/sdk/math'
import { state } from '../state'
import { entityName } from '../custom-components'
import { worldTransformOf } from '../world-pos'

const COLOR: Color4 = { r: 1.0, g: 0.45, b: 0.23, a: 1 } // prefab accent orange
const MAX_SPOTS = 24
const SPOT_NAME = /sit spot/i

const SEAT_Y = 0.06 // pad sits just above the surface the spot rests on
const TORSO_HEIGHT = 0.62
const HEAD_RADIUS = 0.14
const THIGH_LENGTH = 0.42

const anchors: Entity[] = []
const parts: Entity[][] = []
const shown: boolean[] = []
let root: Entity | null = null

function ghost(parent: Entity, shape: 'box' | 'cylinder' | 'sphere'): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent })
  if (shape === 'box') MeshRenderer.setBox(e)
  else if (shape === 'cylinder') MeshRenderer.setCylinder(e, 0.16, 0.13)
  else MeshRenderer.setSphere(e)
  VisibilityComponent.create(e, { visible: false })
  Material.setPbrMaterial(e, {
    albedoColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b, a: 0.3 },
    emissiveColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b },
    emissiveIntensity: 0.45,
    roughness: 1
  })
  return e
}

export function setupSeatMarkers(): void {
  if (root !== null) return
  const r = engine.addEntity()
  Transform.create(r)
  for (let i = 0; i < MAX_SPOTS; i++) {
    const anchor = engine.addEntity()
    Transform.create(anchor, { parent: r })

    const pad = ghost(anchor, 'box')
    const padT = Transform.getMutable(pad)
    padT.position = Vector3.create(0, SEAT_Y / 2, 0)
    padT.scale = Vector3.create(0.44, SEAT_Y, 0.44)

    // thighs point along +Z — the direction the seated avatar will face
    const thighs = ghost(anchor, 'box')
    const thighsT = Transform.getMutable(thighs)
    thighsT.position = Vector3.create(0, SEAT_Y + 0.07, THIGH_LENGTH / 2 + 0.1)
    thighsT.scale = Vector3.create(0.3, 0.14, THIGH_LENGTH)

    const torso = ghost(anchor, 'cylinder')
    const torsoT = Transform.getMutable(torso)
    torsoT.position = Vector3.create(0, SEAT_Y + TORSO_HEIGHT / 2, -0.06)
    torsoT.scale = Vector3.create(1, TORSO_HEIGHT, 1)

    const head = ghost(anchor, 'sphere')
    const headT = Transform.getMutable(head)
    headT.position = Vector3.create(0, SEAT_Y + TORSO_HEIGHT + HEAD_RADIUS * 1.1, -0.04)
    headT.scale = Vector3.create(HEAD_RADIUS * 2, HEAD_RADIUS * 2, HEAD_RADIUS * 2)

    anchors.push(anchor)
    parts.push([pad, thighs, torso, head])
    shown.push(false)
  }
  root = r
  engine.addSystem(updateSeatMarkers)
}

function show(i: number, on: boolean): void {
  if (shown[i] === on) return
  shown[i] = on
  for (const part of parts[i]) VisibilityComponent.getMutable(part).visible = on
}

function spotIds(): string[] {
  const ids: string[] = []
  for (const id of Object.keys(state.snapshot)) {
    const name = entityName(state.snapshot, id)
    if (name !== undefined && SPOT_NAME.test(name)) ids.push(id)
    if (ids.length >= MAX_SPOTS) break
  }
  return ids
}

function updateSeatMarkers(): void {
  if (root === null) return
  const ids = state.frozen && state.status === 'ready' ? spotIds() : []
  for (let i = 0; i < anchors.length; i++) {
    const id = ids[i]
    if (id === undefined) {
      show(i, false)
      continue
    }
    const world = worldTransformOf(state.snapshot, id)
    if (world === null) {
      show(i, false)
      continue
    }
    const t = Transform.getMutable(anchors[i])
    t.position = world.position
    t.rotation = world.rotation
    show(i, true)
  }
}
