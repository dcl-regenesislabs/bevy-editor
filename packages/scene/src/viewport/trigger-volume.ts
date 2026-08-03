// TriggerArea has no geometry: it fires TriggerAreaResult when something enters
// it and renders nothing. In the editor that made it unplaceable and unverifiable
// — you could select "Trigger area" in the tree and see absolutely nothing in the
// viewport, with no way to tell how big it was or where it sat.
//
// Every zone in the scene is drawn dim so you can see what's already there; the
// selected one is drawn bright. Per the SDK (ADR-258) the area's size and
// rotation come from the entity's OWN Transform, so a unit box/sphere carrying
// the entity's world transform IS the trigger volume — no guessing.
//
// The draw is gated on `ready` only, NOT on `frozen`: a zone you can't see while
// the scene plays is a zone you can't debug walking into.
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
import { TRIGGER_AREA } from '../allowed-components'
import { TRIGGER_SPHERE } from './zone-pick'

const COLOR = Color4.create(1.0, 0.45, 0.23, 1) // prefab/marker accent orange
const MAX_SHOWN = 24

type Tier = 'dim' | 'bright'

// bright = the selected zone (the original look); dim = context, present enough
// to read the layout of a scene full of zones without fogging the viewport.
const TIERS: Record<Tier, { alpha: number; emissive: number }> = {
  bright: { alpha: 0.25, emissive: 0.6 },
  dim: { alpha: 0.08, emissive: 0.15 }
}

interface Slot {
  box: Entity
  sphere: Entity
  shownAs: 'box' | 'sphere' | null
  tier: Tier | null
}

const slots: Slot[] = []
let root: Entity | null = null

function paint(e: Entity, tier: Tier): void {
  const t = TIERS[tier]
  Material.setPbrMaterial(e, {
    albedoColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b, a: t.alpha },
    emissiveColor: { r: COLOR.r, g: COLOR.g, b: COLOR.b },
    emissiveIntensity: t.emissive,
    roughness: 1
  })
}

function volume(parent: Entity, shape: 'box' | 'sphere'): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent })
  if (shape === 'box') MeshRenderer.setBox(e)
  else MeshRenderer.setSphere(e)
  VisibilityComponent.create(e, { visible: false })
  paint(e, 'dim')
  return e
}

export function setupTriggerVolumes(): void {
  if (root !== null) return
  const r = engine.addEntity()
  Transform.create(r)
  for (let i = 0; i < MAX_SHOWN; i++) {
    slots.push({ box: volume(r, 'box'), sphere: volume(r, 'sphere'), shownAs: null, tier: 'dim' })
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

function setTier(slot: Slot, tier: Tier): void {
  if (slot.tier === tier) return
  slot.tier = tier
  paint(slot.box, tier)
  paint(slot.sphere, tier)
}

// Every authored TriggerArea, selected ones first so they always survive the cap.
function shownTriggers(): string[] {
  const selected: string[] = []
  const rest: string[] = []
  for (const [id, comps] of Object.entries(state.snapshot)) {
    if (comps[TRIGGER_AREA] === undefined || Number(id) < 512) continue
    if (state.selected.has(id)) selected.push(id)
    else rest.push(id)
  }
  return [...selected, ...rest].slice(0, MAX_SHOWN)
}

function updateTriggerVolumes(): void {
  if (root === null) return
  const ids = state.status === 'ready' ? shownTriggers() : []
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
    const area = state.snapshot[id]?.[TRIGGER_AREA] as { mesh?: number } | undefined
    const as = area?.mesh === TRIGGER_SPHERE ? 'sphere' : 'box'
    const target = as === 'sphere' ? slots[i].sphere : slots[i].box
    const t = Transform.getMutable(target)
    t.position = world.position
    t.rotation = world.rotation
    // The SDK builds the area from a UNIT shape scaled by the entity's transform,
    // so the world scale is the volume's size with no extra factor.
    t.scale = Vector3.create(world.scale.x, world.scale.y, world.scale.z)
    setTier(slots[i], state.selected.has(id) ? 'bright' : 'dim')
    show(slots[i], as)
  }
}
