// TriggerArea has no geometry: it fires TriggerAreaResult when something enters
// it and renders nothing. In the editor that made it unplaceable and unverifiable
// — you could select "Trigger area" in the tree and see absolutely nothing in the
// viewport, with no way to tell how big it was or where it sat.
//
// Selecting one now draws its volume. Per the SDK (ADR-258) the area's size and
// rotation come from the entity's OWN Transform, so a unit box/sphere carrying the
// entity's world transform IS the trigger volume — no guessing.
//
// Drawn in the MAIN scene like the seat markers, NOT on RELATION_LAYER — that
// layer only reaches the view through the relations TextureCamera overlay, so
// anything put there is invisible unless that overlay is composited.
import {
  engine,
  Transform,
  MeshRenderer,
  Material,
  VisibilityComponent,
  type Entity
} from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'
import { state } from '../state'
import { worldTransformOf } from '../world-pos'

const COLOR = Color4.create(1.0, 0.45, 0.23, 1) // prefab/marker accent orange
const MAX_SHOWN = 8
const TRIGGER = 'TriggerArea'

// TriggerAreaMeshType: 0 = TAMT_BOX (default), 1 = TAMT_SPHERE.
const SPHERE = 1

interface Slot {
  box: Entity
  sphere: Entity
  shownAs: 'box' | 'sphere' | null
}

const slots: Slot[] = []
let root: Entity | null = null

function volume(parent: Entity, shape: 'box' | 'sphere'): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent })
  if (shape === 'box') MeshRenderer.setBox(e)
  else MeshRenderer.setSphere(e)
  VisibilityComponent.create(e, { visible: false })
  Material.setPbrMaterial(e, {
    albedoColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b, a: 0.25 },
    emissiveColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b },
    emissiveIntensity: 0.6,
    roughness: 1
  })
  return e
}

export function setupTriggerVolumes(): void {
  if (root !== null) return
  const r = engine.addEntity()
  Transform.create(r)
  for (let i = 0; i < MAX_SHOWN; i++) {
    slots.push({ box: volume(r, 'box'), sphere: volume(r, 'sphere'), shownAs: null })
  }
  root = r
  engine.addSystem(updateTriggerVolumes)
}

function show(slot: Slot, as: 'box' | 'sphere' | null): void {
  if (slot.shownAs === as) return
  slot.shownAs = as
  VisibilityComponent.getMutable(slot.box).visible = as === 'box'
  VisibilityComponent.getMutable(slot.sphere).visible = as === 'sphere'
}

// Selected entities that carry a TriggerArea. Selection-scoped on purpose: a
// scene can hold dozens of triggers and drawing them all would be a fog.
function selectedTriggers(): string[] {
  const out: string[] = []
  for (const id of state.selected) {
    if (state.snapshot[id]?.[TRIGGER] !== undefined) out.push(id)
    if (out.length >= MAX_SHOWN) break
  }
  return out
}

function updateTriggerVolumes(): void {
  if (root === null) return
  const ids = state.status === 'ready' ? selectedTriggers() : []
  for (let i = 0; i < slots.length; i++) {
    const id = ids[i]
    if (id === undefined) {
      show(slots[i], null)
      continue
    }
    const world = worldTransformOf(state.snapshot, id)
    if (world === null) {
      show(slots[i], null)
      continue
    }
    const area = state.snapshot[id]?.[TRIGGER] as { mesh?: number } | undefined
    const as = area?.mesh === SPHERE ? 'sphere' : 'box'
    const target = as === 'sphere' ? slots[i].sphere : slots[i].box
    const t = Transform.getMutable(target)
    t.position = world.position
    t.rotation = world.rotation
    // The SDK builds the area from a UNIT shape scaled by the entity's transform,
    // so the world scale is the volume's size with no extra factor.
    t.scale = Vector3.create(world.scale.x, world.scale.y, world.scale.z)
    show(slots[i], as)
  }
}
